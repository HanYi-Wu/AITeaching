"""Production static frontend and streaming API proxy; no Node/npm at runtime."""
import os
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import anyio
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response, StreamingResponse
from starlette.routing import Route

ROOT = Path(os.environ.get('EH_WEB_ROOT', 'web/dist')).resolve()
BACKEND = os.environ.get('EH_BACKEND_URL', 'http://127.0.0.1:8000')
HOP = {'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
       'te', 'trailer', 'transfer-encoding', 'upgrade'}


@asynccontextmanager
async def lifespan(app):
    async with httpx.AsyncClient(trust_env=False, timeout=httpx.Timeout(180, connect=5)) as client:
        app.state.client = client
        yield


async def proxy(request: Request):
    connection_headers = {h.strip().lower() for h in request.headers.get('connection', '').split(',')}
    excluded = HOP | connection_headers | {'host', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto'}
    headers = [(k, v) for k, v in request.headers.raw if k.decode().lower() not in excluded]
    headers.extend([(b'x-forwarded-host', request.headers.get('host', '').encode()),
                    (b'x-forwarded-for', (request.client.host if request.client else '127.0.0.1').encode()),
                    (b'x-forwarded-proto', request.url.scheme.encode())])
    path = request.scope.get('raw_path', request.url.path.encode())
    url = BACKEND.rstrip('/').encode() + path
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
    if relative == '_eh_release':
        return JSONResponse({'release_id': os.environ.get('EH_RELEASE_ID', '')})
    target = (ROOT / relative).resolve()
    if not target.is_relative_to(ROOT) or any(p.startswith('.') for p in Path(relative).parts):
        return Response(status_code=404)
    if target.is_file():
        return FileResponse(target)
    if '.' in Path(relative).name:
        return Response(status_code=404)
    return FileResponse(ROOT / 'index.html', headers={'Cache-Control': 'no-cache'})


app = Starlette(lifespan=lifespan, routes=[
    Route('/api', proxy, methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']),
    Route('/api/{path:path}', proxy, methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']),
    Route('/{path:path}', static, methods=['GET', 'HEAD']),
])
