/**
 * Koios status lookups.
 *
 * Public Koios CORS preflight includes Access-Control-Allow-Origin: *, but
 * the actual GET/POST responses do not, so a browser cannot read them.
 * In the app, this module is called against the Cloudflare Worker proxy
 * base (see src/checker.js and /worker). Direct public hosts are for the
 * worker and for tests with a mocked fetch.
 *
 * Listing uses ?limit=50&order=block_height.desc — the Range header is
 * ignored by Koios and would return 1000 rows.
 */
import {
  getNetwork,
  paymentAmountToLovelace,
  findMatchingPayment,
  txBeforeLinkCreation,
  isValidCreatedAt,
  isValidTxHash,
} from './paylink.js';
import { fetchWithBackoff } from './backoff.js';
import { DIRECT_BASES, safeExplorerTxUrl } from './checker.js';

export const TX_PAGE_LIMIT = 50;
export const INFO_BATCH = 10;

function joinUrl(base, path, query) {
  const root = String(base || '').replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : '/' + path;
  return root + p + (query || '');
}

export function addressTxsPath() {
  return '/address_txs?limit=' + TX_PAGE_LIMIT + '&order=block_height.desc';
}

export async function koiosPost(base, path, body, { range, fetchImpl, sleep } = {}) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json',
  };
  if (range) headers.Range = range;
  const res = await fetchWithBackoff(fetchImpl || fetch, joinUrl(base, path), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }, { sleep });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      'Koios ' + path + ' failed (' + res.status + ')' + (text ? ': ' + text.slice(0, 180) : '')
    );
  }
  return res.json();
}

/**
 * Look up a payment by receive address + CIP-20 memo.
 * Options: { baseUrl, fetchImpl, sleep }.
 * Stops walking address_txs once a row is older than request.created.
 */
export async function lookupPayment(request, options = {}) {
  const net = getNetwork(request.network);
  if (!net) throw new Error('Unknown network');
  if (!request.address) throw new Error('Missing receive address');
  const base = (options.baseUrl || net.koios || DIRECT_BASES.koios[net.id]);
  if (!request.memo) {
    return {
      status: 'unpaid',
      txHash: null,
      receivedLovelace: '0',
      memoMatched: false,
      amountMatched: false,
      paid: false,
      explorerUrl: null,
      network: net.id,
      note: 'This link has no memo, so a payment cannot be matched uniquely on-chain.',
    };
  }

  const rows = await koiosPost(
    base,
    addressTxsPath(),
    { _addresses: [request.address] },
    { fetchImpl: options.fetchImpl, sleep: options.sleep }
  );
  const recent = [];
  const list = Array.isArray(rows) ? rows : [];
  for (const row of list) {
    if (txBeforeLinkCreation(row, request.created)) break;
    if (row && row.tx_hash) recent.push(row);
  }

  const hashes = recent.map((r) => r.tx_hash).filter(Boolean);
  const infos = [];
  for (let i = 0; i < hashes.length; i += INFO_BATCH) {
    const chunk = hashes.slice(i, i + INFO_BATCH);
    const batch = await koiosPost(base, '/tx_info', {
      _tx_hashes: chunk,
      _metadata: true,
      _inputs: false,
    }, { fetchImpl: options.fetchImpl, sleep: options.sleep });
    if (Array.isArray(batch)) infos.push(...batch);
  }
  const byHash = new Map(infos.map((t) => [t.tx_hash, t]));
  const ordered = hashes.map((h) => {
    const info = byHash.get(h);
    const row = recent.find((r) => r.tx_hash === h);
    if (!info) return null;
    // Prefer tx_info timestamps; fall back to the address_txs row.
    if (info.tx_timestamp == null && info.block_time == null && row) {
      return { ...info, block_time: row.block_time, block_height: row.block_height };
    }
    if (info.block_height == null && row && row.block_height != null) {
      return { ...info, block_height: row.block_height };
    }
    return info;
  }).filter(Boolean);

  let amountLovelace = null;
  if (request.amount) amountLovelace = paymentAmountToLovelace(request.amount);
  const result = findMatchingPayment(ordered, {
    address: request.address,
    amountLovelace,
    memo: request.memo,
    created: isValidCreatedAt(request.created) ? Number(request.created) : null,
  });
  result.explorerUrl = safeExplorerTxUrl(net.id, result.txHash);
  result.network = net.id;
  result.scanned = hashes.length;
  return result;
}
