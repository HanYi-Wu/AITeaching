// Cloudflare Worker entry point for or.whenry.cc.cd.
// Keep authenticated API traffic on the origin; cache only fingerprinted build assets.
const ORIGIN = 'https://awa.nat100.top';
const PUBLIC_ASSET = /^\/assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.(?:js|css|svg|woff2?|ttf|png|jpe?g|webp|wasm|mjs)$/i;

export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    const upstream = new URL(incoming.pathname + incoming.search, ORIGIN);
    const cacheable = (request.method === 'GET' || request.method === 'HEAD')
      && PUBLIC_ASSET.test(incoming.pathname);
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
      ? { cf: { cacheEverything: true, cacheTtl: 31536000 } }
      : { cf: { cacheTtl: 0 } });
    const responseHeaders = new Headers(originResponse.headers);
    if (cacheable && originResponse.ok && !responseHeaders.has('set-cookie')) {
      responseHeaders.set('cache-control', 'public, max-age=31536000, immutable');
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
