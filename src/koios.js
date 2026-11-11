/**
 * Keyless Koios lookups. No API key, no backend, no custody.
 * CORS is open on the public Koios hosts we use.
 */
import {
  getNetwork,
  adaToLovelace,
  findMatchingPayment,
} from './paylink.js';

const TX_RANGE = '0-49';
const INFO_BATCH = 10;

export async function koiosPost(base, path, body, { range } = {}) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json',
  };
  if (range) headers.Range = range;
  const res = await fetch(base + path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      'Koios ' + path + ' failed (' + res.status + ')' + (text ? ': ' + text.slice(0, 180) : '')
    );
  }
  return res.json();
}

/**
 * Look up a payment on the selected network by receive address + CIP-20 memo.
 * Returns findMatchingPayment's result plus explorerUrl and network.
 */
export async function lookupPayment(request) {
  const net = getNetwork(request.network);
  if (!net) throw new Error('Unknown network');
  if (!request.address) throw new Error('Missing receive address');
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
    net.koios,
    '/address_txs',
    { _addresses: [request.address] },
    { range: TX_RANGE }
  );
  const hashes = Array.isArray(rows) ? rows.map((r) => r.tx_hash).filter(Boolean) : [];
  const infos = [];
  for (let i = 0; i < hashes.length; i += INFO_BATCH) {
    const chunk = hashes.slice(i, i + INFO_BATCH);
    const batch = await koiosPost(net.koios, '/tx_info', {
      _tx_hashes: chunk,
      _metadata: true,
      _inputs: false,
    });
    if (Array.isArray(batch)) infos.push(...batch);
  }
  const byHash = new Map(infos.map((t) => [t.tx_hash, t]));
  const ordered = hashes.map((h) => byHash.get(h)).filter(Boolean);
  const amountLovelace = request.amount ? adaToLovelace(request.amount) : null;
  const result = findMatchingPayment(ordered, {
    address: request.address,
    amountLovelace,
    memo: request.memo,
  });
  result.explorerUrl = result.txHash ? net.explorerTx(result.txHash) : null;
  result.network = net.id;
  result.scanned = hashes.length;
  return result;
}
