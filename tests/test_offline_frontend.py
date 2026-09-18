import httpx
import gzip
from starlette.testclient import TestClient

from solaire.web import offline_frontend as frontend


def test_precompressed_hashed_assets_and_uncached_html(tmp_path, monkeypatch):
    (tmp_path / 'assets').mkdir()
    asset = tmp_path / 'assets' / 'entry-abcdefgh.js'
    asset.write_text('hello frontend')
    asset.with_name(asset.name + '.gz').write_bytes(gzip.compress(asset.read_bytes()))
    (tmp_path / 'index.html').write_text('page')
    monkeypatch.setattr(frontend, 'ROOT', tmp_path)
    with TestClient(frontend.app) as client:
        response = client.get('/assets/entry-abcdefgh.js', headers={'Accept-Encoding': 'gzip'})
        assert response.text == 'hello frontend'
        assert response.headers['content-encoding'] == 'gzip'
        assert 'immutable' in response.headers['cache-control']
        assert response.headers['vary'] == 'Accept-Encoding'
        assert 'content-encoding' not in client.get('/assets/entry-abcdefgh.js', headers={'Accept-Encoding': 'gzip;q=0'}).headers
        assert client.get('/index.html').headers['cache-control'] == 'no-cache'


def test_static_assets_spa_missing_files_and_release_identity(tmp_path, monkeypatch):
    (tmp_path / 'index.html').write_text('EducationHelper')
    (tmp_path / 'asset.js').write_text('asset')
    (tmp_path / '.secret').write_text('private')
    monkeypatch.setattr(frontend, 'ROOT', tmp_path)
    monkeypatch.setenv('EH_RELEASE_ID', 'release-test')
    with TestClient(frontend.app) as client:
        assert client.get('/').text == 'EducationHelper'
        assert client.get('/teacher/papers').text == 'EducationHelper'
        assert client.get('/asset.js').text == 'asset'
        assert client.get('/missing.js').status_code == 404
        assert client.get('/.secret').status_code == 404
        assert client.get('/_eh_release').json() == {'release_id': 'release-test'}


def test_proxy_preserves_auth_encoded_paths_body_stream_and_duplicate_headers():
    captured = []
    class Stream(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b'event: done\ndata: {}\n\n'
    async def handle(request):
        captured.append((request, await request.aread()))
        return httpx.Response(200, headers=[('content-type', 'text/event-stream'),
                              ('set-cookie', 'a=1'), ('set-cookie', 'b=2')],
                              stream=Stream())
    with TestClient(frontend.app) as client:
        original = frontend.app.state.client
        frontend.app.state.client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
        response = client.post('/api/resource/%E6%95%B0%E5%AD%A6?x=1', content=b'upload',
                               headers={'authorization': 'Bearer teacher-token'})
        frontend.app.state.client = original
        assert response.content == b'event: done\ndata: {}\n\n'
        assert response.headers.get_list('set-cookie') == ['a=1', 'b=2']
        assert captured[0][0].headers['authorization'] == 'Bearer teacher-token'
        assert captured[0][1] == b'upload'
        assert '%E6%95%B0' in str(captured[0][0].url)


def test_unavailable_backend_has_retryable_service_response():
    async def fail(request):
        raise httpx.ConnectError('offline', request=request)
    with TestClient(frontend.app) as client:
        original = frontend.app.state.client
        frontend.app.state.client = httpx.AsyncClient(transport=httpx.MockTransport(fail))
        assert client.get('/api/health').status_code == 503
        frontend.app.state.client = original


def test_failed_upstream_stream_is_closed_even_after_headers_sent():
    closed = []
    class Broken(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b'partial'
            raise httpx.ReadError('upstream interrupted')
        async def aclose(self):
            closed.append(True)
    async def handle(request):
        return httpx.Response(200, stream=Broken())
    import pytest
    with TestClient(frontend.app) as client:
        original = frontend.app.state.client
        frontend.app.state.client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
        try:
            with pytest.raises(httpx.ReadError):
                client.get('/api/stream')
            assert closed == [True]
        finally:
            frontend.app.state.client = original
