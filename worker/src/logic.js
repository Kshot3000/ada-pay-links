/** Pure Worker routing/CORS helpers, testable in Node. */

export const ALLOWED_PROVIDERS = ['koios', 'blockfrost'];
export const ALLOWED_NETWORKS = ['preprod', 'preview', 'mainnet'];

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
  '/submittx',
]);

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS, POST',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Range, Authorization, project_id',
  'Access-Control-Expose-Headers': 'Content-Type, Content-Range',
  'Access-Control-Max-Age': '600',
};

export function isAllowedBlockfrostPath(path) {
  if (/^\/addresses\/[A-Za-z0-9_]+\/transactions$/.test(path)) return true;
  if (/^\/addresses\/[A-Za-z0-9_]+\/utxos$/.test(path)) return true;
  if (/^\/txs\/[0-9a-fA-F]{64}$/.test(path)) return true;
  if (/^\/txs\/[0-9a-fA-F]{64}\/(utxos|metadata)$/.test(path)) return true;
  if (path === '/epochs/latest/parameters') return true;
  if (/^\/epochs\/[0-9]+\/parameters$/.test(path)) return true;
  if (path === '/blocks/latest') return true;
  if (path === '/tx/submit') return true;
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

export function withCors(headers) {
  return { ...CORS_HEADERS, ...(headers || {}) };
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

export function corsPreflight() {
  return { status: 204, headers: withCors(), body: null };
}
