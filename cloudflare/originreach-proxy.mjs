// Cloudflare Worker entry point for or.whenry.cc.cd.
// Keep authenticated API traffic on the origin; cache only fingerprinted build assets.
const ORIGIN = 'https://awa.nat100.top';
const PUBLIC_ASSET = /^\/assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.(?:js|css|svg|woff2?|ttf|png|jpe?g|webp|wasm|mjs)$/i;

export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    const upstream = new URL(incoming.pathname + incoming.search, ORIGIN);
    const immutableAsset = PUBLIC_ASSET.test(incoming.pathname);
    const document = incoming.pathname === '/' || incoming.pathname === '/index.html';
    const icon = incoming.pathname === '/favicon.svg';
    const ttl = immutableAsset ? 31536000 : icon ? 3600 : 60;
    const cacheable = (request.method === 'GET' || request.method === 'HEAD')
      && (immutableAsset || document || icon);
    const headers = new Headers(request.headers);
    headers.delete('host');
    if (cacheable) {
      headers.delete('cookie');
      headers.delete('authorization');
    }
    const originRequest = new Request(upstream, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'manual',
    });
    const originResponse = await fetch(originRequest, cacheable
      ? { cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': ttl, '300-599': 0 } } }
      : { cf: { cacheTtl: 0 } });
    const responseHeaders = new Headers(originResponse.headers);
    responseHeaders.set('x-originreach-edge', '1');
    if (cacheable && originResponse.ok && !responseHeaders.has('set-cookie')) {
      responseHeaders.set('cache-control', immutableAsset
        ? 'public, max-age=31536000, immutable'
        : document ? 'public, max-age=0, s-maxage=60' : 'public, max-age=3600');
    } else {
      responseHeaders.set('cache-control', 'private, no-store');
    }
    const location = responseHeaders.get('location');
    if (location) {
      const redirect = new URL(location, upstream);
      if (redirect.origin === new URL(ORIGIN).origin) {
        redirect.protocol = incoming.protocol;
        redirect.host = incoming.host;
        responseHeaders.set('location', redirect.toString());
      }
    }
    return new Response(originResponse.body, {
      status: originResponse.status,
      statusText: originResponse.statusText,
      headers: responseHeaders,
    });
  },
};
