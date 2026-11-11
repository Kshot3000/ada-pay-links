/**
 * Blockfrost status lookups. Used when the checker provider is "blockfrost",
 * usually through the Cloudflare Worker (the project id stays in a Worker
 * secret, never in this repo).
 */
import {
  getNetwork,
  paymentAmountToLovelace,
  findMatchingPayment,
  txBeforeLinkCreation,
  isValidCreatedAt,
} from './paylink.js';
import { fetchWithBackoff } from './backoff.js';
import { DIRECT_BASES, safeExplorerTxUrl } from './checker.js';

const PAGE_SIZE = 50;

export function lovelaceFromBlockfrostAmount(amount) {
  if (!Array.isArray(amount)) return 0n;
  const row = amount.find((a) => a && a.unit === 'lovelace');
  try {
    return row ? BigInt(row.quantity) : 0n;
  } catch {
    return 0n;
  }
}

export function blockfrostTxToKoiosShape(hash, utxos, metadata, extra = {}) {
  const outputs = ((utxos && utxos.outputs) || []).map((o) => ({
    address: o.address,
    payment_addr: { bech32: o.address },
    value: lovelaceFromBlockfrostAmount(o.amount).toString(),
  }));
  return {
    tx_hash: hash,
    outputs,
    metadata: metadata || null,
    block_time: extra.block_time,
    block_height: extra.block_height,
    tx_timestamp: extra.block_time,
  };
}

async function bfGet(base, path, { fetchImpl, projectId, sleep } = {}) {
  const headers = { accept: 'application/json' };
  if (projectId) headers.project_id = projectId;
  const res = await fetchWithBackoff(
    fetchImpl || fetch,
    String(base).replace(/\/+$/, '') + path,
    { method: 'GET', headers },
    { sleep }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      'Blockfrost ' + path + ' failed (' + res.status + ')' + (text ? ': ' + text.slice(0, 180) : '')
    );
  }
  return res.json();
}

export async function lookupPaymentBlockfrost(request, options = {}) {
  const net = getNetwork(request.network);
  if (!net) throw new Error('Unknown network');
  if (!request.address) throw new Error('Missing receive address');
  const base = options.baseUrl || DIRECT_BASES.blockfrost[net.id];
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
  const rows = await bfGet(
    base,
    '/addresses/' + encodeURIComponent(request.address) + '/transactions?order=desc&count=' + PAGE_SIZE,
    options
  );
  const list = Array.isArray(rows) ? rows : [];
  const recent = [];
  for (const row of list) {
    const shaped = {
      tx_hash: row.tx_hash,
      block_time: row.block_time,
      block_height: row.block_height,
    };
    if (txBeforeLinkCreation(shaped, request.created)) break;
    if (shaped.tx_hash) recent.push(shaped);
  }

  const infos = [];
  for (const row of recent) {
    const [utxos, metadata] = await Promise.all([
      bfGet(base, '/txs/' + row.tx_hash + '/utxos', options),
      bfGet(base, '/txs/' + row.tx_hash + '/metadata', options).catch(() => []),
    ]);
    infos.push(blockfrostTxToKoiosShape(row.tx_hash, utxos, metadata, row));
  }

  let amountLovelace = null;
  if (request.amount) amountLovelace = paymentAmountToLovelace(request.amount);
  const result = findMatchingPayment(infos, {
    address: request.address,
    amountLovelace,
    memo: request.memo,
    created: isValidCreatedAt(request.created) ? Number(request.created) : null,
  });
  result.explorerUrl = safeExplorerTxUrl(net.id, result.txHash);
  result.network = net.id;
  result.scanned = recent.length;
  return result;
}
