/**
 * Status-check configuration and failure fallback.
 *
 * Public Koios answers CORS preflight with Access-Control-Allow-Origin: *,
 * but the actual GET/POST responses omit that header, so a browser cannot
 * read them. Lookups therefore go through the optional Cloudflare Worker
 * in /worker (which injects an API key from a secret and always returns
 * CORS headers). Direct Koios/Blockfrost bases are for the worker itself
 * and for tests.
 */
import { DEFAULT_NETWORK, getNetwork } from './paylink.js';

export const CHECKER_UNREACHABLE_MESSAGE =
  "Couldn't reach the network checker, open in Cardanoscan";

export const DIRECT_BASES = {
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

export function normalizeProvider(value) {
  const p = String(value || 'koios').trim().toLowerCase();
  return p === 'blockfrost' ? 'blockfrost' : 'koios';
}

export function trimSlash(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

export function parseCheckerConfig(text) {
  if (text === undefined || text === null || String(text).trim() === '') return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/**
 * Resolve the status-check API base for a network.
 * - proxyBase: Cloudflare Worker origin; calls go to ${proxyBase}/${provider}/${network}
 * - baseUrl: explicit full API base (tests / advanced)
 * - otherwise: documented public host (not usable from a browser today)
 */
export function resolveCheckerConfig(raw, networkId) {
  const network = getNetwork(networkId) ? networkId : DEFAULT_NETWORK;
  const src = raw && typeof raw === 'object' ? raw : {};
  const provider = normalizeProvider(src.provider);
  const proxyBase = trimSlash(src.proxyBase);
  if (proxyBase) {
    return {
      provider,
      network,
      mode: 'proxy',
      baseUrl: proxyBase + '/' + provider + '/' + network,
      proxyBase,
      projectId: '',
    };
  }
  const baseUrl = trimSlash(src.baseUrl) || DIRECT_BASES[provider][network];
  return {
    provider,
    network,
    mode: 'direct',
    baseUrl,
    proxyBase: '',
    projectId: src.projectId || src.blockfrostProjectId || '',
  };
}

export function explorerAddressUrl(network, address) {
  const net = getNetwork(network);
  if (!net || !address || typeof net.explorerAddress !== 'function') return null;
  return net.explorerAddress(address);
}

export function checkerFailure(request, error) {
  const net = getNetwork(request && request.network);
  const url = explorerAddressUrl(request && request.network, request && request.address);
  return {
    status: 'unreachable',
    paid: false,
    txHash: null,
    receivedLovelace: '0',
    memoMatched: false,
    amountMatched: false,
    explorerUrl: url,
    explorerName: net ? net.explorerName : 'Cardanoscan',
    network: request && request.network,
    message: CHECKER_UNREACHABLE_MESSAGE,
    detail: error && error.message ? String(error.message) : '',
  };
}

export function isValidTxHash(hash) {
  return typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash);
}

export function safeExplorerTxUrl(network, txHash) {
  if (!isValidTxHash(txHash)) return null;
  const net = getNetwork(network);
  return net ? net.explorerTx(txHash) : null;
}

export function safeExplorerAddressUrl(network, address) {
  return explorerAddressUrl(network, address);
}
