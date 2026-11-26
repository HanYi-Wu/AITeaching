"""Production static frontend and streaming API proxy; no Node/npm at runtime."""
import os
import hmac
import mimetypes
import re
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import anyio
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response, StreamingResponse
from starlette.routing import Route

from solaire.common.runtime_config import load_runtime_config
from solaire.web.frontend_release import frontend_snapshot
from solaire.web.backend_release import backend_slot

load_runtime_config()

ROOT = Path(os.environ.get('EH_WEB_ROOT', 'web/dist')).resolve()
_store = os.environ.get('EH_FRONTEND_RELEASE_STORE', '')
FRONTEND_RELEASE_STORE = Path(_store).absolute() if _store else None
BACKEND = os.environ.get('EH_BACKEND_URL', 'http://127.0.0.1:8000')
_backend_store = os.environ.get('EH_BACKEND_RELEASE_STORE', '')
BACKEND_RELEASE_STORE = Path(_backend_store).absolute() if _backend_store else None
_standby = os.environ.get('EH_BACKEND_STANDBY_URL', '')
# The alternate service never comes from request data or the signed archive.
BACKEND_STANDBY = _standby if re.fullmatch(r'http://127\.0\.0\.1:[1-9][0-9]{0,4}', _standby) else None
_DRAIN_TOKEN = os.environ.get('EH_UPDATE_DRAIN_TOKEN', '')
_inflight = {'primary': 0, 'standby': 0}
HOP = {'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
       'te', 'trailer', 'transfer-encoding', 'upgrade'}


@asynccontextmanager
async def lifespan(app):
    async with httpx.AsyncClient(trust_env=False, timeout=httpx.Timeout(180, connect=5)) as client:
        app.state.client = client
        yield


def _current_backend_slot():
    return backend_slot(BACKEND_RELEASE_STORE) if BACKEND_RELEASE_STORE and BACKEND_STANDBY else 'primary'


class BackendRequestTracking:
    """Pin a request to one slot and count its entire ASGI response lifetime."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        path = scope.get('path', '')
        if scope['type'] != 'http' or (path != '/api' and not path.startswith('/api/')):
            return await self.app(scope, receive, send)
        slot = _current_backend_slot()
        scope['eh_backend_slot'] = slot
        _inflight[slot] += 1
        try:
            await self.app(scope, receive, send)
        finally:
            _inflight[slot] -= 1


async def backend_drain(request: Request):
    token = request.headers.get('x-eh-drain-token', '')
    if (not BACKEND_RELEASE_STORE or not BACKEND_STANDBY or not _DRAIN_TOKEN or not _DRAIN_TOKEN.isascii() or not request.client
            or request.client.host != '127.0.0.1' or not token.isascii() or not hmac.compare_digest(token, _DRAIN_TOKEN)):
        return Response(status_code=404, headers={'Cache-Control': 'no-store'})
    return JSONResponse({'active_slot': _current_backend_slot(), 'inflight': dict(_inflight)}, headers={'Cache-Control': 'no-store'})


async def proxy(request: Request):
    upstream_base = BACKEND
    if BACKEND_STANDBY and request.scope.get('eh_backend_slot') == 'standby':
        upstream_base = BACKEND_STANDBY
    connection_headers = {h.strip().lower() for h in request.headers.get('connection', '').split(',')}
    excluded = HOP | connection_headers | {'host', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto'}
    headers = [(k, v) for k, v in request.headers.raw if k.decode().lower() not in excluded]
    headers.extend([(b'x-forwarded-host', request.headers.get('host', '').encode()),
                    (b'x-forwarded-for', (request.client.host if request.client else '127.0.0.1').encode()),
                    (b'x-forwarded-proto', request.url.scheme.encode())])
    path = request.scope.get('raw_path', request.url.path.encode())
    url = upstream_base.rstrip('/').encode() + path
    if request.url.query:
        url += b'?' + request.url.query.encode()
    upstream = request.app.state.client.build_request(
        request.method, url.decode('ascii'), headers=headers, content=request.stream())
    try:
        result = await request.app.state.client.send(upstream, stream=True)
    except httpx.HTTPError:
        return JSONResponse({'detail': '服务正在重启，请稍后重试'}, status_code=503)
    async def body():
        try:
            async for chunk in result.aiter_raw():
                yield chunk
        finally:
            # Disconnects and upstream timeouts must release the pooled connection.
            with anyio.CancelScope(shield=True):
                await result.aclose()
    response = StreamingResponse(body(), status_code=result.status_code)
    dynamic = {h.strip().lower() for h in result.headers.get('connection', '').split(',')}
    response.raw_headers = [(k, v) for k, v in result.headers.raw
                            if k.decode().lower() not in HOP | dynamic]
    return response


async def static(request: Request):
    relative = request.path_params.get('path', '')
    published, compatibility = frontend_snapshot(FRONTEND_RELEASE_STORE) if FRONTEND_RELEASE_STORE else (None, None)
    root = published[0] if published else ROOT
    if relative == '_eh_release':
        info = {'release_id': os.environ.get('EH_RELEASE_ID', '')}
        if published:
            info.update(frontend_release_id=published[1], frontend_version=published[2])
        return JSONResponse(info, headers={'Cache-Control': 'no-store'})
    target = (root / relative).resolve()
    if not target.is_relative_to(root) or any(p.startswith('.') for p in Path(relative).parts):
        return Response(status_code=404)
    if not target.is_file() and compatibility and relative.startswith('assets/') and re.search(r'-[\w-]{8,}\.', target.name):
        other_root = compatibility[0]
        fallback = (other_root / relative).resolve()
        if fallback.is_relative_to(other_root) and fallback.is_file():
            root, target = other_root, fallback
    if target.is_file():
        headers = {'Cache-Control': 'public, max-age=31536000, immutable'
                   if relative.startswith('assets/') and re.search(r'-[\w-]{8,}\.', target.name)
                   else 'no-cache',
                   'Vary': 'Accept-Encoding'}
        if relative == 'classroom-tools.html':
            headers['Content-Disposition'] = 'attachment'
            headers['Content-Security-Policy'] = 'sandbox allow-scripts'
        accepted = request.headers.get('accept-encoding', '')
        encodings = {}
        for part in accepted.split(','):
            fields = [field.strip() for field in part.split(';')]
            if fields[0] not in {'br', 'gzip'}:
                continue
            try:
                encodings[fields[0]] = float(next((field[2:] for field in fields[1:] if field.startswith('q=')), '1'))
            except ValueError:
                pass
        for encoding in ('br', 'gzip'):
            compressed = target.with_name(target.name + ('.br' if encoding == 'br' else '.gz'))
            if encodings.get(encoding, 0) > 0 and compressed.is_file() and compressed.resolve().is_relative_to(root):
                headers['Content-Encoding'] = encoding
                return FileResponse(compressed, media_type=mimetypes.guess_type(str(target))[0], headers=headers)
        return FileResponse(target, headers=headers)
    if '.' in Path(relative).name:
        return Response(status_code=404)
    return FileResponse(root / 'index.html', headers={'Cache-Control': 'no-cache'})


app = Starlette(lifespan=lifespan, routes=[
    Route('/_eh_backend_drain', backend_drain, methods=['GET']),
    Route('/api', proxy, methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']),
    Route('/api/{path:path}', proxy, methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']),
    Route('/{path:path}', static, methods=['GET', 'HEAD']),
])
app.add_middleware(BackendRequestTracking)
