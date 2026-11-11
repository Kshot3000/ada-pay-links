/**
 * ADA Pay Links — core logic (no network, no wallet, no secrets).
 * Shared by the browser app and the Node test suite.
 *
 * CIP-13 payment URIs: web+cardano:<address>?amount=<ADA>
 * CIP-20 memos: metadata label 674, { msg: [strings of at most 64 UTF-8 bytes] }
 * CIP-19 / CIP-5 addresses: bech32 (not bech32m), length may exceed BIP-173's 90 chars.
 */

export const ADA_DECIMALS = 6;
export const LOVELACE_PER_ADA = 1_000_000n;
export const CIP20_LABEL = 674;
export const CIP20_MAX_BYTES = 64;
export const MAX_MEMO_CHARS = 200;

/** Developer tip address (mainnet). Unlocks nothing; the tool is free. */
export const TIP_ADDRESS =
  'addr1q8hnl6vl5a6k3rw3n5g3jtte696zcl76kfatzv7gpswa9r0dj7fma6klq55y4ffm7tf0em09udnyhuk4ah92pl5x9jpqjae44v';

export const NETWORKS = {
  preprod: {
    id: 'preprod',
    label: 'Preprod testnet',
    kind: 'testnet',
    addressHrp: 'addr_test',
    networkId: 0,
    koios: 'https://preprod.koios.rest/api/v1',
    meshNetwork: 'preprod',
    lucidNetwork: 'Preprod',
    explorerTx: (hash) => 'https://preprod.cardanoscan.io/transaction/' + hash,
    explorerName: 'Cardanoscan (Preprod)',
  },
  preview: {
    id: 'preview',
    label: 'Preview testnet',
    kind: 'testnet',
    addressHrp: 'addr_test',
    networkId: 0,
    koios: 'https://preview.koios.rest/api/v1',
    meshNetwork: 'preview',
    lucidNetwork: 'Preview',
    explorerTx: (hash) => 'https://preview.cardanoscan.io/transaction/' + hash,
    explorerName: 'Cardanoscan (Preview)',
  },
  mainnet: {
    id: 'mainnet',
    label: 'Mainnet',
    kind: 'mainnet',
    addressHrp: 'addr',
    networkId: 1,
    koios: 'https://api.koios.rest/api/v1',
    meshNetwork: 'api',
    lucidNetwork: 'Mainnet',
    explorerTx: (hash) => 'https://cardanoscan.io/transaction/' + hash,
    explorerName: 'Cardanoscan',
  },
};

export const DEFAULT_NETWORK = 'preprod';

/* ---------------- bech32 (BIP-173, no 90-char limit — Cardano CIP-5) ---------------- */

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_MAP = Object.fromEntries([...BECH32_CHARSET].map((c, i) => [c, i]));
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values) {
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) chk ^= GEN[i];
    }
  }
  return chk >>> 0;
}

function hrpExpand(hrp) {
  const out = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

/**
 * Decode a bech32 (BIP-173) string. Returns { hrp, words } or null.
 * Cardano Shelley addresses are bech32 (not bech32m) and often exceed 90 chars.
 */
export function decodeBech32(str) {
  if (typeof str !== 'string' || str.length < 8 || str.length > 128) return null;
  if (str !== str.toLowerCase() && str !== str.toUpperCase()) return null;
  const s = str.toLowerCase();
  const pos = s.lastIndexOf('1');
  if (pos < 1 || pos + 7 > s.length) return null;
  const hrp = s.slice(0, pos);
  // CIP-5 HRPs include underscores (addr_test, stake_test).
  if (!/^[a-z][a-z0-9_]*$/.test(hrp)) return null;
  const data = [];
  for (let i = pos + 1; i < s.length; i++) {
    const v = BECH32_MAP[s[i]];
    if (v === undefined) return null;
    data.push(v);
  }
  if (polymod(hrpExpand(hrp).concat(data)) !== 1) return null;
  return { hrp, words: data.slice(0, -6) };
}

export function isPaymentAddress(str) {
  const d = decodeBech32(str);
  if (!d) return false;
  return d.hrp === 'addr' || d.hrp === 'addr_test';
}

/** 'mainnet' | 'testnet' | null (not a payment address). */
export function addressNetworkKind(str) {
  const d = decodeBech32(str);
  if (!d) return null;
  if (d.hrp === 'addr') return 'mainnet';
  if (d.hrp === 'addr_test') return 'testnet';
  return null;
}

export function getNetwork(id) {
  return NETWORKS[id] || null;
}

export function addressMatchesNetwork(address, networkId) {
  const net = getNetwork(networkId);
  if (!net) return false;
  const d = decodeBech32(address);
  return !!d && d.hrp === net.addressHrp;
}

/* ---------------- amounts ---------------- */

export function isValidAdaAmount(str) {
  if (typeof str !== 'string') return false;
  const s = str.trim();
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(s)) return false;
  return /[1-9]/.test(s);
}

export function isValidUsdAmount(str) {
  if (typeof str !== 'string') return false;
  const s = str.trim();
  // USD may have 2+ cents digits as input; we allow up to 6 then convert.
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(s)) return false;
  return /[1-9]/.test(s);
}

export function normalizeAdaAmount(str) {
  const s = String(str).trim();
  if (!s.includes('.')) return s.replace(/^0+(?=\d)/, '') || '0';
  let [w, f] = s.split('.');
  w = w.replace(/^0+(?=\d)/, '') || '0';
  f = f.replace(/0+$/, '');
  return f ? w + '.' + f : w;
}

export function adaToLovelace(str) {
  if (!isValidAdaAmount(str)) throw new Error('Invalid ADA amount');
  const norm = normalizeAdaAmount(str);
  const [w, f = ''] = norm.split('.');
  const frac = (f + '000000').slice(0, 6);
  return BigInt(w) * LOVELACE_PER_ADA + BigInt(frac);
}

export function lovelaceToAda(lovelace) {
  const v = typeof lovelace === 'bigint' ? lovelace : BigInt(lovelace);
  if (v < 0n) throw new Error('Lovelace cannot be negative');
  const w = v / LOVELACE_PER_ADA;
  const f = v % LOVELACE_PER_ADA;
  if (f === 0n) return w.toString();
  return w.toString() + '.' + f.toString().padStart(6, '0').replace(/0+$/, '');
}

/**
 * Convert a USD amount to ADA at a market rate, rounded to the nearest lovelace.
 * The result is approximate — callers must label it as such.
 */
export function usdToAda(usdStr, adaUsdRate) {
  if (!(typeof adaUsdRate === 'number') || !Number.isFinite(adaUsdRate) || adaUsdRate <= 0) {
    throw new Error('Invalid ADA/USD price');
  }
  if (!isValidUsdAmount(usdStr)) throw new Error('Invalid USD amount');
  const usd = Number(usdStr);
  if (!Number.isFinite(usd) || usd <= 0) throw new Error('Invalid USD amount');
  const lovelace = Math.round((usd / adaUsdRate) * Number(LOVELACE_PER_ADA));
  if (!Number.isFinite(lovelace) || lovelace < 1) {
    throw new Error('USD amount is too small to equal 1 lovelace at this price');
  }
  return lovelaceToAda(BigInt(lovelace));
}

/** Approximate USD value of an ADA amount at a market rate, 2 decimal dollars. */
export function adaToUsd(adaStr, adaUsdRate) {
  if (!(typeof adaUsdRate === 'number') || !Number.isFinite(adaUsdRate) || adaUsdRate <= 0) {
    throw new Error('Invalid ADA/USD price');
  }
  const lovelace = adaToLovelace(adaStr);
  const usd = (Number(lovelace) / Number(LOVELACE_PER_ADA)) * adaUsdRate;
  if (!Number.isFinite(usd)) throw new Error('USD conversion overflow');
  return usd.toFixed(2);
}

/* ---------------- memos (CIP-20) ---------------- */

export function normalizeMemo(str) {
  if (typeof str !== 'string') return '';
  return str.trim();
}

export function isValidMemo(str) {
  const s = normalizeMemo(str);
  if (!s || s.length > MAX_MEMO_CHARS) return false;
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(s)) return false;
  return true;
}

export function utf8Bytes(str) {
  return new TextEncoder().encode(str);
}

/** Split a memo into CIP-20 `msg` lines, each at most 64 UTF-8 bytes. */
export function splitCip20Msg(memo) {
  const s = normalizeMemo(memo);
  if (!isValidMemo(s)) throw new Error('Invalid memo');
  const bytes = utf8Bytes(s);
  if (bytes.length <= CIP20_MAX_BYTES) return [s];
  const lines = [];
  let buf = new Uint8Array(0);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  // Split on Unicode code points so we never cut a multibyte character.
  for (const ch of s) {
    const next = utf8Bytes(ch);
    if (buf.length + next.length > CIP20_MAX_BYTES) {
      lines.push(decoder.decode(buf));
      buf = next;
    } else {
      const merged = new Uint8Array(buf.length + next.length);
      merged.set(buf);
      merged.set(next, buf.length);
      buf = merged;
    }
  }
  if (buf.length) lines.push(decoder.decode(buf));
  return lines;
}

export function generateMemoId() {
  const c = globalThis.crypto;
  if (!c || !c.getRandomValues) throw new Error('WebCrypto unavailable');
  const bytes = new Uint8Array(6);
  c.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return 'APL-' + hex;
}

/* ---------------- CIP-13 URIs ---------------- */

export function buildCip13Uri({ address, amount } = {}) {
  if (!isPaymentAddress(address)) throw new Error('Invalid Cardano payment address');
  let uri = 'web+cardano:' + address;
  if (amount !== undefined && amount !== null && String(amount).trim() !== '') {
    if (!isValidAdaAmount(String(amount))) throw new Error('Invalid ADA amount');
    uri += '?amount=' + normalizeAdaAmount(String(amount));
  }
  return uri;
}

export function parseCip13Uri(uri) {
  if (typeof uri !== 'string') return null;
  const raw = uri.trim();
  const m = /^(web\+cardano|cardano):([^/?#]*)(\?(.*))?$/i.exec(raw);
  if (!m) return null;
  const path = m[2];
  // Reject authority forms such as web+cardano://stake?...
  if (path.startsWith('//') || path === '') return null;
  const address = path;
  if (!isPaymentAddress(address)) return null;
  const query = m[4] || '';
  let amount = null;
  if (query) {
    const seen = new Set();
    try {
      for (const pair of query.split('&')) {
        if (!pair) continue;
        const eq = pair.indexOf('=');
        const k = decodeURIComponent(eq >= 0 ? pair.slice(0, eq) : pair);
        const v = eq >= 0 ? decodeURIComponent(pair.slice(eq + 1)) : '';
        if (seen.has(k)) return null;
        seen.add(k);
        if (k === 'amount') amount = v;
        // Unknown keys are allowed by BIP-21-style URIs; we ignore them.
      }
    } catch {
      return null;
    }
  }
  if (amount !== null) {
    if (!isValidAdaAmount(amount)) return null;
    amount = normalizeAdaAmount(amount);
  }
  return { address, amount };
}

/* ---------------- hosted pay-page links ---------------- */

const PAGE_KEYS = ['network', 'address', 'amount', 'memo', 'label'];

export function buildPayPageQuery({ network, address, amount, memo, label } = {}) {
  const net = getNetwork(network);
  if (!net) throw new Error('Unknown network');
  if (!isPaymentAddress(address)) throw new Error('Invalid Cardano payment address');
  if (!addressMatchesNetwork(address, network)) {
    throw new Error(
      net.kind === 'mainnet'
        ? 'Mainnet was selected, but this is a testnet address (addr_test1…)'
        : 'A testnet was selected, but this is a mainnet address (addr1…)'
    );
  }
  const qs = new URLSearchParams();
  qs.set('network', net.id);
  qs.set('address', address);
  if (amount !== undefined && amount !== null && String(amount).trim() !== '') {
    if (!isValidAdaAmount(String(amount))) throw new Error('Invalid ADA amount');
    qs.set('amount', normalizeAdaAmount(String(amount)));
  }
  const m = normalizeMemo(memo || '');
  if (!isValidMemo(m)) throw new Error('A memo / invoice id is required so the payment can be matched');
  qs.set('memo', m);
  if (label) qs.set('label', String(label).trim().slice(0, 60));
  return qs.toString();
}

export function buildPayPageUrl(base, request) {
  if (typeof base !== 'string' || !base) throw new Error('Missing pay-page base URL');
  const q = buildPayPageQuery(request);
  const sep = base.includes('?') ? '&' : (base.endsWith('?') ? '' : '?');
  return base + sep + q;
}

export function parsePayPageUrl(url) {
  if (typeof url !== 'string') return null;
  let u;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const q = u.searchParams;
  if (!q.has('address')) return null;
  for (const key of PAGE_KEYS) {
    if (q.getAll(key).length > 1) return null;
  }
  const network = q.get('network') || DEFAULT_NETWORK;
  if (!getNetwork(network)) return null;
  const address = q.get('address') || '';
  if (!isPaymentAddress(address)) return null;
  if (!addressMatchesNetwork(address, network)) return null;
  const amount = q.has('amount') ? q.get('amount') : null;
  if (amount !== null && amount !== '') {
    if (!isValidAdaAmount(amount)) return null;
  }
  const memo = q.has('memo') ? q.get('memo') : null;
  if (memo !== null && memo !== '' && !isValidMemo(memo)) return null;
  return {
    network,
    address,
    amount: amount && isValidAdaAmount(amount) ? normalizeAdaAmount(amount) : null,
    memo: memo ? normalizeMemo(memo) : null,
    label: q.get('label') || null,
  };
}

/** Parse either a CIP-13 URI or a hosted pay-page URL. */
export function parsePaymentLink(text) {
  if (typeof text !== 'string') return null;
  const s = text.trim();
  const page = parsePayPageUrl(s);
  if (page) return page;
  const cip = parseCip13Uri(s);
  if (!cip) return null;
  return {
    network: null, // CIP-13 does not encode the network
    address: cip.address,
    amount: cip.amount,
    memo: null,
    label: null,
  };
}

export function describeRequest(req) {
  const net = req.network ? getNetwork(req.network) : null;
  const parts = [];
  if (net) parts.push(net.label);
  if (req.amount) parts.push(req.amount + ' ADA');
  else parts.push('open amount');
  if (req.memo) parts.push('memo ' + req.memo);
  if (req.label) parts.push(req.label);
  return parts.join(' · ');
}

/* ---------------- payment matching ---------------- */

export function extractCip20Messages(metadata) {
  if (!metadata) return [];
  let entry = null;
  if (Array.isArray(metadata)) {
    const row = metadata.find((x) => {
      if (!x || typeof x !== 'object') return false;
      return String(x.label ?? x.metalabel ?? x.key) === String(CIP20_LABEL);
    });
    entry = row && (row.json_metadata || row.json || row.metadata || row.value);
  } else if (typeof metadata === 'object') {
    entry = metadata[String(CIP20_LABEL)] ?? metadata[CIP20_LABEL];
  }
  if (!entry) return [];
  // Some indexers wrap the JSON: { json: { msg: [...] } } or { msg: [...] }
  const body = entry.msg !== undefined || entry.MSG !== undefined ? entry : entry.json || entry.json_metadata || entry;
  const msg = body && (body.msg ?? body.MSG);
  if (typeof msg === 'string') return [msg];
  if (Array.isArray(msg)) return msg.filter((x) => typeof x === 'string');
  return [];
}

export function memoMatches(messages, memo) {
  const want = normalizeMemo(memo);
  if (!want) return false;
  const lines = (messages || []).map(normalizeMemo);
  if (lines.some((l) => l === want)) return true;
  if (normalizeMemo(lines.join('')) === want) return true;
  return false;
}

function outputAddress(o) {
  if (!o || typeof o !== 'object') return '';
  if (o.payment_addr && typeof o.payment_addr === 'object' && o.payment_addr.bech32) {
    return o.payment_addr.bech32;
  }
  return o.address || '';
}

export function lovelaceReceivedByAddress(tx, address) {
  const outs = (tx && Array.isArray(tx.outputs) ? tx.outputs : []) || [];
  let total = 0n;
  for (const o of outs) {
    if (outputAddress(o) === address) {
      try {
        total += BigInt(o.value ?? 0);
      } catch {
        // skip malformed value
      }
    }
  }
  return total;
}

/**
 * Judge one Koios-style tx_info row against a payment request.
 * amountLovelace may be null for an open-amount link (any positive ADA with the memo).
 */
export function matchPayment(tx, { address, amountLovelace, memo } = {}) {
  const received = lovelaceReceivedByAddress(tx, address);
  const messages = extractCip20Messages(tx && tx.metadata);
  const memoOk = memoMatches(messages, memo);
  const need = amountLovelace === undefined || amountLovelace === null || amountLovelace === ''
    ? 1n
    : BigInt(amountLovelace);
  const amountOk = received >= need;
  return {
    txHash: (tx && tx.tx_hash) || null,
    receivedLovelace: received.toString(),
    memoMatched: memoOk,
    amountMatched: amountOk,
    paid: !!(memoOk && amountOk && received > 0n),
  };
}

/**
 * Walk a list of txs (newest first is typical) and return the first paid match,
 * or an underpaid memo match, or unpaid.
 */
export function findMatchingPayment(txs, request) {
  const list = Array.isArray(txs) ? txs : [];
  let close = null;
  for (const tx of list) {
    const r = matchPayment(tx, request);
    if (r.paid) return { status: 'paid', ...r };
    if (r.memoMatched && !close) close = r;
  }
  if (close) return { status: 'underpaid', ...close };
  return {
    status: 'unpaid',
    txHash: null,
    receivedLovelace: '0',
    memoMatched: false,
    amountMatched: false,
    paid: false,
  };
}

export function tipCip13Uri() {
  return buildCip13Uri({ address: TIP_ADDRESS });
}
