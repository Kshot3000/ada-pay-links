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
export const MAX_LABEL_CHARS = 60;
/** Minimum payable amount (about one min-UTxO of ADA). */
export const MIN_ADA = '1';
/** Current maximum ADA supply. */
export const MAX_ADA = '45000000000';
export const MIN_ADA_LOVELACE = 1_000_000n;
export const MAX_ADA_LOVELACE = 45_000_000_000n * LOVELACE_PER_ADA;

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
    explorerAddress: (addr) => 'https://preprod.cardanoscan.io/address/' + addr,
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
    explorerAddress: (addr) => 'https://preview.cardanoscan.io/address/' + addr,
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
    explorerAddress: (addr) => 'https://cardanoscan.io/address/' + addr,
    explorerName: 'Cardanoscan',
  },
};

export const DEFAULT_NETWORK = 'preprod';

/** Shown whenever Mainnet is selected. Mainnet is supported, but the software is unaudited. */
export const MAINNET_WARNING = 'Mainnet: real ADA, unaudited software';
export const MAINNET_PAY_CONFIRM = 'This sends real ADA';


/**
 * Block a CIP-30 wallet that is on the wrong network.
 * CIP-30 only reports network id 0 (testnet) or 1 (mainnet), so Preprod vs Preview
 * cannot be distinguished this way — address prefixes (addr vs addr_test) still are.
 * Returns an error message, or null if the wallet may proceed.
 */
export function walletNetworkMismatch({ walletNetworkId, changeAddress, network } = {}) {
  const net = getNetwork(network);
  if (!net) return 'Unknown network';
  const id = Number(walletNetworkId);
  if (!Number.isInteger(id) || (id !== 0 && id !== 1)) {
    return 'The wallet did not report a valid CIP-30 network id. Switch to ' + net.label + ' and try again.';
  }
  if (id !== net.networkId) {
    if (net.kind === 'mainnet') {
      return 'This wallet is on a testnet, but this payment is for Mainnet. Switch the wallet to Mainnet and try again.';
    }
    return (
      'This wallet is on mainnet, but this payment is for ' +
      net.label +
      '. Switch the wallet to ' +
      net.label +
      ' and try again. Preprod and Preview are both testnets — CIP-30 cannot tell them apart, so confirm the wallet is on the same testnet as this page.'
    );
  }
  if (changeAddress && isPaymentAddress(changeAddress) && !addressMatchesNetwork(changeAddress, network)) {
    return (
      'The connected wallet address does not match ' +
      net.label +
      ' (addr vs addr_test). Switch the wallet network and try again.'
    );
  }
  return null;
}

export function assertWalletNetwork(opts) {
  const msg = walletNetworkMismatch(opts);
  if (msg) throw new Error(msg);
}


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

function convertBits(data, fromBits, toBits, pad) {
  let acc = 0;
  let bits = 0;
  const maxv = (1 << toBits) - 1;
  const out = [];
  for (const value of data) {
    if (value < 0 || value >> fromBits) return null;
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) out.push((acc << (toBits - bits)) & maxv);
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv)) {
    return null;
  }
  return out;
}

/**
 * Decode a Shelley payment address and check CIP-19 header + payload length.
 * Returns { hrp, type, networkId, bytes } or null. Stake/reward addresses are rejected.
 */
export function decodePaymentAddress(str) {
  const d = decodeBech32(str);
  if (!d) return null;
  if (d.hrp !== 'addr' && d.hrp !== 'addr_test') return null;
  const bytes = convertBits(d.words, 5, 8, false);
  if (!bytes || bytes.length < 29) return null;
  const header = bytes[0];
  const type = header >> 4;
  const networkId = header & 0x0f;
  if (d.hrp === 'addr' && networkId !== 1) return null;
  if (d.hrp === 'addr_test' && networkId !== 0) return null;
  // CIP-19 payment types: 0-3 base (57 bytes), 4-5 pointer (>= 32), 6-7 enterprise (29).
  // Type 14 is a reward/stake account — not a payment address.
  if (type >= 0 && type <= 3) {
    if (bytes.length !== 57) return null;
  } else if (type === 4 || type === 5) {
    if (bytes.length < 32 || bytes.length > 64) return null;
  } else if (type === 6 || type === 7) {
    if (bytes.length !== 29) return null;
  } else {
    return null;
  }
  return { hrp: d.hrp, type, networkId, bytes };
}

export function isPaymentAddress(str) {
  return !!decodePaymentAddress(str);
}

/** 'mainnet' | 'testnet' | null (not a payment address). */
export function addressNetworkKind(str) {
  const d = decodePaymentAddress(str);
  if (!d) return null;
  if (d.hrp === 'addr' && d.networkId === 1) return 'mainnet';
  if (d.hrp === 'addr_test' && d.networkId === 0) return 'testnet';
  return null;
}

export function addressMatchesNetwork(address, networkId) {
  const net = getNetwork(networkId);
  if (!net) return false;
  const d = decodePaymentAddress(address);
  if (!d) return false;
  if (d.hrp !== net.addressHrp) return false;
  return net.kind === 'mainnet' ? d.networkId === 1 : d.networkId === 0;
}

export function getNetwork(id) {
  return NETWORKS[id] || null;
}

/* ---------------- amounts ---------------- */

/** Well-formed positive ADA with at most 6 decimal places (any size). */
export function isWellFormedAdaAmount(str) {
  if (typeof str !== 'string') return false;
  const s = str.trim();
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(s)) return false;
  return /[1-9]/.test(s);
}

/**
 * A payable ADA amount: well-formed, at least 1 ADA, and at most the 45 billion
 * ADA total supply.
 */
export function isAllowedPaymentAmount(str) {
  if (!isWellFormedAdaAmount(str)) return false;
  try {
    const lovelace = adaAmountToLovelace(str);
    return lovelace >= MIN_ADA_LOVELACE && lovelace <= MAX_ADA_LOVELACE;
  } catch {
    return false;
  }
}

export function isValidAdaAmount(str) {
  return isAllowedPaymentAmount(str);
}

function adaAmountToLovelace(str) {
  const norm = normalizeAdaAmount(str);
  const [w, f = ''] = norm.split('.');
  const frac = (f + '000000').slice(0, 6);
  return BigInt(w) * LOVELACE_PER_ADA + BigInt(frac);
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
  if (!isWellFormedAdaAmount(str)) throw new Error('Invalid ADA amount');
  return adaAmountToLovelace(str);
}

export function paymentAmountToLovelace(str) {
  if (!isAllowedPaymentAmount(str)) {
    throw new Error('ADA amount must be at least 1 and at most 45,000,000,000');
  }
  return adaAmountToLovelace(str);
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
  // Use integer rounding in lovelace. The USD and rate are Number values;
  // we still clamp the result to the allowed payment range with BigInt.
  const raw = (usd / adaUsdRate) * Number(LOVELACE_PER_ADA);
  if (!Number.isFinite(raw) || raw < 1) {
    throw new Error('USD amount is too small to equal 1 lovelace at this price');
  }
  const lovelace = BigInt(Math.round(raw));
  if (lovelace < MIN_ADA_LOVELACE || lovelace > MAX_ADA_LOVELACE) {
    throw new Error('ADA amount must be at least 1 and at most 45,000,000,000');
  }
  return lovelaceToAda(lovelace);
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

/** Short random suffix so a reused invoice id cannot match an older payment. */
export function generateMemoSuffix() {
  const c = globalThis.crypto;
  if (!c || !c.getRandomValues) throw new Error('WebCrypto unavailable');
  const bytes = new Uint8Array(3);
  c.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Auto-generate a memo if needed, then append a short unique suffix.
 * Required and auto memos both get the suffix.
 */
export function finalizeMemo(userMemo) {
  const base = normalizeMemo(userMemo || '') || generateMemoId();
  const suffix = generateMemoSuffix();
  let memo = base + '-' + suffix;
  if (memo.length > MAX_MEMO_CHARS) {
    const keep = MAX_MEMO_CHARS - 1 - suffix.length;
    if (keep < 1) throw new Error('Memo is too long');
    memo = base.slice(0, keep) + '-' + suffix;
  }
  if (!isValidMemo(memo)) throw new Error('Invalid memo / invoice id');
  return memo;
}

export function isValidTxHash(hash) {
  return typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash);
}

export function isValidCreatedAt(value) {
  if (value === undefined || value === null || value === '') return false;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n > 0 && n < 1e12;
}

export function nowCreatedAt() {
  return Math.floor(Date.now() / 1000);
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

const PAGE_KEYS = ['network', 'address', 'amount', 'memo', 'label', 'created'];

export function capLabel(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, MAX_LABEL_CHARS);
}

export function buildPayPageQuery({ network, address, amount, memo, label, created } = {}) {
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
    if (!isValidAdaAmount(String(amount))) {
      throw new Error('ADA amount must be at least 1 and at most 45,000,000,000');
    }
    qs.set('amount', normalizeAdaAmount(String(amount)));
  }
  const m = normalizeMemo(memo || '');
  if (!isValidMemo(m)) throw new Error('A memo / invoice id is required so the payment can be matched');
  qs.set('memo', m);
  const lab = capLabel(label);
  if (lab) qs.set('label', lab);
  const createdAt = isValidCreatedAt(created) ? Number(created) : nowCreatedAt();
  qs.set('created', String(createdAt));
  return qs.toString();
}

export function buildPayPageUrl(base, request) {
  if (typeof base !== 'string' || !base) throw new Error('Missing pay-page base URL');
  const q = buildPayPageQuery(request);
  const trimmed = String(base).replace(/\?+$/, '');
  const sep = trimmed.includes('?') ? '&' : '?';
  return trimmed + sep + q;
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
  const createdRaw = q.has('created') ? q.get('created') : null;
  const created = isValidCreatedAt(createdRaw) ? Number(createdRaw) : null;
  const label = capLabel(q.get('label'));
  return {
    network,
    address,
    amount: amount && isValidAdaAmount(amount) ? normalizeAdaAmount(amount) : null,
    memo: memo ? normalizeMemo(memo) : null,
    label: label || null,
    created,
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
    created: null,
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
  // Exact full-memo match over a consecutive run of CIP-20 lines. A memo
  // longer than 64 bytes is split across lines; a wallet may also append
  // an extra line (e.g. "Sent from Eternl"). Joining the whole array
  // would miss a real payment, so we test every consecutive run.
  for (let i = 0; i < lines.length; i++) {
    let acc = '';
    for (let j = i; j < lines.length; j++) {
      acc += lines[j];
      if (acc === want) return true;
      if (acc.length > want.length) break;
    }
  }
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
export function txOccurredAt(tx) {
  if (!tx || typeof tx !== 'object') return null;
  const v = tx.tx_timestamp ?? tx.block_time ?? tx.block_time_unix;
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function txBlockHeight(tx) {
  if (!tx || typeof tx !== 'object') return null;
  const v = tx.block_height ?? tx.block_no;
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

/** True when this tx was already on-chain before the payment link was created. */
export function txBeforeLinkCreation(tx, created) {
  if (!isValidCreatedAt(created)) return false;
  const when = txOccurredAt(tx);
  if (when === null) return false;
  return when < Number(created);
}

export function matchPayment(tx, { address, amountLovelace, memo, created } = {}) {
  const tooOld = txBeforeLinkCreation(tx, created);
  const received = tooOld ? 0n : lovelaceReceivedByAddress(tx, address);
  const messages = tooOld ? [] : extractCip20Messages(tx && tx.metadata);
  const memoOk = !tooOld && memoMatches(messages, memo);
  const need = amountLovelace === undefined || amountLovelace === null || amountLovelace === ''
    ? MIN_ADA_LOVELACE
    : BigInt(amountLovelace);
  const amountOk = received >= need;
  const hash = tx && isValidTxHash(tx.tx_hash) ? tx.tx_hash : (tx && tx.tx_hash) || null;
  return {
    txHash: hash,
    receivedLovelace: received.toString(),
    memoMatched: memoOk,
    amountMatched: amountOk,
    paid: !!(memoOk && amountOk && received > 0n),
    tooOld,
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
    // Newest first is typical. Once we pass the link's creation time, stop.
    if (txBeforeLinkCreation(tx, request && request.created)) break;
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
