import asyncio

import httpx

from solaire.web.management import update_discovery


def test_update_discovery_caches_release_and_reports_failure(monkeypatch):
    client = httpx.AsyncClient
    requests = []

    def reply(request):
        requests.append(request)
        if len(requests) == 1:
            return httpx.Response(200, json={"tag_name": "v99.0.0", "assets": [{"state": "uploaded", "size": 32,
                "browser_download_url": "https://github.com/HanYi-Wu/AITeaching/releases/download/v99.0.0/OriginReach-update-v99.0.0.zip"}]}, headers={"ETag": '"release"'})
        if len(requests) == 2:
            return httpx.Response(304)
        return httpx.Response(503)

    monkeypatch.setattr(update_discovery.httpx, "AsyncClient", lambda **kw: client(transport=httpx.MockTransport(reply), **kw))

    async def exercise():
        discovery = update_discovery.ReleaseDiscovery()
        await discovery.check()
        assert discovery.snapshot()["status"] == "available"
        assert discovery.snapshot()["online_package_available"] is True
        await discovery.check()
        assert requests[1].headers["If-None-Match"] == '"release"'
        assert discovery.status == "available"
        await discovery.check()
        assert discovery.status == "unreachable"
        assert discovery.snapshot()["online_package_available"] is False
        assert discovery.latest == "99.0.0"

    asyncio.run(exercise())
