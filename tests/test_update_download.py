import hashlib

import httpx
import pytest

from tools.release_verify import update_download


@pytest.mark.parametrize("approved", [True, False])
def test_update_download_follows_only_approved_release_hosts(monkeypatch, tmp_path, approved):
    client = httpx.AsyncClient
    payload = b"verified later by signature"
    seen = []
    host = "release-assets.githubusercontent.com" if approved else "untrusted.example"

    class Content(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield payload

    def respond(request):
        seen.append(request.url.host)
        if request.url.host == "github.com":
            return httpx.Response(302, headers={"Location": f"https://{host}/asset"})
        return httpx.Response(200, stream=Content())

    monkeypatch.setattr(update_download.httpx, "AsyncClient", lambda **kwargs: client(transport=httpx.MockTransport(respond), **kwargs))
    destination = tmp_path / "update.zip"
    asset = {"tag": "v1.7.5", "size": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}
    if approved:
        update_download.download_github_update(asset, destination, "1.7.5")
        assert destination.read_bytes() == payload
        assert seen == ["github.com", host]
    else:
        with pytest.raises(ValueError, match="redirect"):
            update_download.download_github_update(asset, destination, "1.7.5")
        assert seen == ["github.com"] and not destination.exists()
