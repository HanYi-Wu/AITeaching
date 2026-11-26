"""Run a verified candidate on loopback with disposable state before activation."""

from __future__ import annotations

import json
import os
import secrets
import subprocess
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from scripts.build_stamp import validate_frontend_references
from solaire.web.management.update_zip import staged_update


_LAUNCH = """
import os, socket, sys
from pathlib import Path
sys.path.insert(0, str(Path.cwd() / 'src'))
import uvicorn
with socket.socket() as listener:
    listener.bind(('127.0.0.1', 0))
    listener.listen(128)
    address = Path(os.environ['EH_SMOKE_PORT_FILE'])
    pending = address.with_suffix('.pending')
    pending.write_text(str(listener.getsockname()[1]), encoding='ascii')
    pending.replace(address)
    uvicorn.Server(uvicorn.Config('solaire.web.app:app', log_level='error',
                                 access_log=False)).run(sockets=[listener])
"""


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


@contextmanager
def checked_candidate(archive: Path, public_key: Path, installed_version: str,
                      active_release: Path, staging_parent: Path, python: Path,
                      *, frontend_source: Path | None = None, active_backend_version: str | None = None,
                      backend_source: Path | None = None):
    """Only expose a staged candidate after its asset and execution checks pass."""
    with staged_update(archive, public_key, installed_version, active_release, staging_parent,
                       frontend_source=frontend_source, backend_source=backend_source) as staged:
        candidate, manifest, changed = staged
        assets = candidate / "web" / "dist"
        validate_frontend_references((assets / "index.html").read_bytes(), {
            path.relative_to(assets).as_posix() for path in assets.rglob("*") if path.is_file()
        })
        # A frontend-only release keeps the current backend build identity.
        backend_version = manifest["version"] if any(name.startswith("src/") for name in changed) else (active_backend_version or installed_version)
        smoke_candidate(candidate, python, backend_version)
        yield staged


def smoke_candidate(candidate: Path, python: Path, expected_version: str, *, timeout: float = 35) -> None:
    """Fail closed on startup, release identity, or auth failure. Never switch live traffic."""
    candidate = candidate.resolve(strict=True)
    python = python.resolve(strict=True)
    if not (candidate / "src" / "solaire" / "web" / "app.py").is_file():
        raise ValueError("Candidate backend entry point is missing")
    with tempfile.TemporaryDirectory(prefix="eh-smoke-") as sandbox:
        root = Path(sandbox)
        port_file = root / "server.port"
        (root / "workspace").mkdir()
        env = {key: value for key, value in os.environ.items() if key.upper() in {
            "SYSTEMROOT", "WINDIR", "COMSPEC", "LANG", "LC_ALL",
        }}
        env.update({
            "PATH": os.pathsep.join(map(str, (python.parent, python.parent / "Library" / "bin"))) + os.pathsep + os.defpath,
            "APPDATA": sandbox, "LOCALAPPDATA": sandbox,
            "TMP": sandbox, "TEMP": sandbox, "TMPDIR": sandbox,
            "XDG_DATA_HOME": sandbox, "XDG_CONFIG_HOME": sandbox, "XDG_CACHE_HOME": sandbox,
            "EH_DATA_ROOT": str(root / "data"), "EH_UPDATE_CHECK_ENABLED": "0",
            "SOLAIRE_PROJECT_ROOT": str(root / "workspace"), "SOLAIRE_BIND_PROJECT_FROM_ENV": "1",
            "SOLAIRE_PUBLIC_MODE": "1", "EH_SMOKE_PORT_FILE": str(port_file),
        })
        deadline = time.monotonic() + timeout
        opener = build_opener(ProxyHandler({}), _NoRedirect())
        with (root / "startup.log").open("wb") as log:
            process = subprocess.Popen([str(python), "-IB", "-c", _LAUNCH], cwd=candidate,
                                       env=env, stdout=log, stderr=log)
            try:
                while not port_file.exists():
                    if process.poll() is not None or time.monotonic() >= deadline:
                        raise RuntimeError("Candidate did not open a loopback listener")
                    time.sleep(0.05)
                port = int(port_file.read_text(encoding="ascii"))

                def request(path, data=None, token=None):
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise TimeoutError("Candidate smoke deadline expired")
                    headers = {"Content-Type": "application/json"}
                    if token:
                        headers["Authorization"] = f"Bearer {token}"
                    body = None if data is None else json.dumps(data).encode()
                    with opener.open(Request(f"http://127.0.0.1:{port}{path}", body, headers), timeout=min(3, remaining)) as response:
                        return json.loads(response.read(2_000_001))

                while True:
                    try:
                        health = request("/api/health")
                        break
                    except (URLError, TimeoutError):
                        if process.poll() is not None or time.monotonic() >= deadline:
                            raise RuntimeError("Candidate never became healthy") from None
                        time.sleep(0.05)
                if health.get("status") != "ok" or request("/openapi.json").get("info", {}).get("version") != expected_version:
                    raise ValueError("Candidate version or health does not match the signed update")
                credentials = {"username": "smoke_admin", "password": secrets.token_urlsafe(24)}
                request("/api/auth/bootstrap-admin", {**credentials, "display_name": "Upgrade smoke"})
                session = request("/api/auth/login", credentials)
                user = request("/api/auth/me", token=session["token"])["user"]
                if user.get("role") != "admin" or user.get("username") != credentials["username"]:
                    raise ValueError("Candidate login returned the wrong identity")
                try:
                    request("/api/auth/me")
                except HTTPError as error:
                    if error.code not in (401, 403):
                        raise
                else:
                    raise ValueError("Candidate allowed unauthenticated session lookup")
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=3)
