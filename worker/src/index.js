/**
 * Tiny Cloudflare Worker that proxies Koios or Blockfrost and injects an
 * API token from a Worker secret. Secrets are never committed.
 *
 * Public Koios omits Access-Control-Allow-Origin on actual GET/POST
 * responses (preflight succeeds, the browser then hides the body). This
 * worker always sets CORS headers on every response, including errors,
 * but only for allowlisted Origins. Other origins get 403 and are not
 * proxied, so they cannot burn the upstream API quota.
 */
import { parseProxyPath, withCors, injectUpstreamHeaders, corsPreflight, gateOrigin } from './logic.js';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      const pre = corsPreflight(origin, env);
      if (!pre.allowed) {
        return json({ error: pre.body.error }, 403, origin, env);
      }
      return new Response(null, { status: pre.status, headers: pre.headers });
    }
    if (request.method === 'GET' && new URL(request.url).pathname === '/') {
      return json({ ok: true, service: 'ada-pay-links-checker' }, 200, origin, env);
    }
    if (request.method !== 'GET' && request.method !== 'POST' && request.method !== 'HEAD') {
      return json({ error: 'Method not allowed' }, 405, origin, env);
    }

    const originGate = gateOrigin(origin, env);
    if (!originGate.allowed) {
      return json({ error: originGate.error }, originGate.status, origin, env);
    }

    const url = new URL(request.url);
    const parsed = parseProxyPath(url.pathname);
    if (parsed.error) return json({ error: parsed.error }, parsed.status || 404, origin, env);

    const provider = env.CHECKER_PROVIDER || parsed.provider;
    if (provider !== parsed.provider) {
      return json({ error: 'Provider mismatch' }, 400, origin, env);
    }
    const hasSecret =
      (parsed.provider === 'koios' && env.KOIOS_API_TOKEN) ||
      (parsed.provider === 'blockfrost' && env.BLOCKFROST_PROJECT_ID);
    if (!hasSecret) {
      return json({ error: 'Checker secret is not configured' }, 503, origin, env);
    }

    const incoming = {};
    request.headers.forEach((value, key) => {
      incoming[key] = value;
    });
    const headers = injectUpstreamHeaders(parsed.provider, env, incoming);
    if (!headers['content-type'] && !headers['Content-Type'] && request.method === 'POST') {
      headers['Content-Type'] = 'application/json';
    }

    const upstreamUrl = parsed.upstream + url.search;
    let upstream;
    try {
      upstream = await fetch(upstreamUrl, {
        method: request.method,
        headers,
        body: request.method === 'POST' ? await request.arrayBuffer() : undefined,
      });
    } catch {
      return json({ error: 'Upstream request failed' }, 502, origin, env);
    }

    const outHeaders = withCors({
      'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
    }, origin, env);
    const range = upstream.headers.get('Content-Range');
    if (range) outHeaders['Content-Range'] = range;
    return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
  },
};

function json(body, status, origin, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: withCors({ 'Content-Type': 'application/json' }, origin, env),
  });
}
