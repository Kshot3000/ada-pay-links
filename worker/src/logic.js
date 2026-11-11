/** Pure Worker routing/CORS helpers, testable in Node. */

export const ALLOWED_PROVIDERS = ['koios', 'blockfrost'];
export const ALLOWED_NETWORKS = ['preprod', 'preview', 'mainnet'];

/** Default browser origins allowed to call the proxy. Overridden by ALLOWED_ORIGINS. */
export const DEFAULT_ALLOWED_ORIGINS = [
  'https://kshot3000.github.io',
  'http://localhost',
  'http://127.0.0.1',
];

export const UPSTREAM = {
  koios: {
    preprod: 'https://preprod.koios.rest/api/v1',
    preview: 'https://preview.koios.rest/api/v1',
    mainnet: 'https://api.koios.rest/api/v1',
  },
  blockfrost: {
    preprod: 'https://cardano-preprod.blockfrost.io/api/v0',
    preview: 'https://cardano-preview.blockfrost.io/api/v0',
    mainnet: 'https://cardano-mainnet.blockfrost.io/api/v0',
  },
};

export const KOIOS_PATHS = new Set([
  '/address_txs',
  '/tx_info',
  '/tx_metadata',
  '/tip',
  '/epoch_params',
  '/address_info',
  '/account_info',
  '/block_info',
]);

export const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS, POST',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Range, Authorization, project_id',
  'Access-Control-Expose-Headers': 'Content-Type, Content-Range',
  'Access-Control-Max-Age': '600',
};

export function isSubmitPath(path) {
  const pathOnly = String(path || '').split('?')[0] || '/';
  const lower = pathOnly.toLowerCase();
  if (lower === '/submittx' || lower === '/tx/submit') return true;
  if (/(^|\/)submit(tx)?$/i.test(lower)) return true;
  return false;
}

export function isAllowedBlockfrostPath(path) {
  if (isSubmitPath(path)) return false;
  if (/^\/addresses\/[A-Za-z0-9_]+\/transactions$/.test(path)) return true;
  if (/^\/addresses\/[A-Za-z0-9_]+\/utxos$/.test(path)) return true;
  if (/^\/txs\/[0-9a-fA-F]{64}$/.test(path)) return true;
  if (/^\/txs\/[0-9a-fA-F]{64}\/(utxos|metadata)$/.test(path)) return true;
  if (path === '/epochs/latest/parameters') return true;
  if (/^\/epochs\/[0-9]+\/parameters$/.test(path)) return true;
  if (path === '/blocks/latest') return true;
  return false;
}

export function parseProxyPath(pathname) {
  const parts = String(pathname || '').replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts.length < 2) return { error: 'Not found', status: 404 };
  const [provider, network, ...rest] = parts;
  if (!ALLOWED_PROVIDERS.includes(provider)) return { error: 'Unknown provider', status: 404 };
  if (!ALLOWED_NETWORKS.includes(network)) return { error: 'Unknown network', status: 404 };
  const path = '/' + rest.join('/');
  const pathOnly = path.split('?')[0] || '/';
  if (isSubmitPath(pathOnly)) return { error: 'Path not allowed', status: 403 };
  if (provider === 'koios') {
    const koiosPath = pathOnly === '/' ? '/tip' : pathOnly;
    if (!KOIOS_PATHS.has(koiosPath)) return { error: 'Path not allowed', status: 403 };
  } else if (!isAllowedBlockfrostPath(pathOnly)) {
    return { error: 'Path not allowed', status: 403 };
  }
  const upstreamBase = UPSTREAM[provider][network];
  const suffix = path === '/' ? '' : path;
  return { provider, network, path: pathOnly, upstream: upstreamBase + suffix };
}

export function parseAllowedOrigins(env) {
  const raw = env && env.ALLOWED_ORIGINS;
  if (raw != null && String(raw).trim() !== '') {
    return String(raw)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return DEFAULT_ALLOWED_ORIGINS.slice();
}

function tryCanonicalOrigin(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.protocol + '//' + url.host;
  } catch {
    return null;
  }
}

function isLocalDevHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

export function originAllowedByList(origin, allowedList) {
  const requestOrigin = tryCanonicalOrigin(origin);
  if (!requestOrigin) return false;
  const requestUrl = new URL(requestOrigin);
  for (const entry of allowedList || []) {
    const allowedOrigin = tryCanonicalOrigin(entry);
    if (!allowedOrigin) continue;
    if (allowedOrigin === requestOrigin) return true;
    const allowedUrl = new URL(allowedOrigin);
    // An allowlist entry of http://localhost (no port) also covers http://localhost:<port>.
    if (
      isLocalDevHost(allowedUrl.hostname) &&
      allowedUrl.hostname === requestUrl.hostname &&
      allowedUrl.protocol === requestUrl.protocol &&
      allowedUrl.port === ''
    ) {
      return true;
    }
  }
  return false;
}

export function isAllowedOrigin(origin, env) {
  return originAllowedByList(origin, parseAllowedOrigins(env));
}

/**
 * Rejects proxy and preflight requests from origins that are not allowlisted.
 * Returns a 403 descriptor when the request must not be forwarded upstream.
 */
export function gateOrigin(origin, env) {
  if (isAllowedOrigin(origin, env)) {
    return { allowed: true, origin: tryCanonicalOrigin(origin) };
  }
  return { allowed: false, error: 'Origin not allowed', status: 403 };
}

export function withCors(headers, origin, env) {
  const cors = { ...CORS_HEADERS };
  const gate = gateOrigin(origin, env);
  if (gate.allowed) {
    cors['Access-Control-Allow-Origin'] = gate.origin;
    cors.Vary = 'Origin';
  }
  return { ...cors, ...(headers || {}) };
}

export function injectUpstreamHeaders(provider, env, incoming) {
  const out = {};
  const src = incoming || {};
  for (const key of Object.keys(src)) {
    const lower = key.toLowerCase();
    if (lower === 'authorization' || lower === 'project_id' || lower === 'host') continue;
    out[key] = src[key];
  }
  if (provider === 'koios' && env && env.KOIOS_API_TOKEN) {
    out.Authorization = 'Bearer ' + env.KOIOS_API_TOKEN;
  }
  if (provider === 'blockfrost' && env && env.BLOCKFROST_PROJECT_ID) {
    out.project_id = env.BLOCKFROST_PROJECT_ID;
  }
  return out;
}

export function corsPreflight(origin, env) {
  const gate = gateOrigin(origin, env);
  if (!gate.allowed) {
    return { status: 403, headers: { 'Content-Type': 'application/json' }, body: { error: gate.error }, allowed: false };
  }
  return { status: 204, headers: withCors({}, origin, env), body: null, allowed: true };
}
