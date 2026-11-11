/**
 * CIP-30 wallet errors are often plain { code, info } objects, not Error.
 * Never display "[object Object]" or Mesh's raw JSON enable wrapper.
 */
export const CANCELLED_MESSAGE = 'You cancelled in the wallet';
export const CONNECT_FAILED_MESSAGE =
  "Couldn't connect to the wallet. Check that it is unlocked and try again.";

function asText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function looksLikeRawJson(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (t.includes('[BrowserWallet]')) return true;
  if (t.includes('An error occurred during enable')) return true;
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) return true;
  return false;
}

function parseMaybeJson(raw) {
  const t = String(raw || '').trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

/**
 * Mesh 1.9.1 wraps BrowserWallet.enable failures as
 * Error("[BrowserWallet] An error occurred during enable: " + JSON.stringify(error)).
 * JSON.stringify drops Error.message, so a real Error becomes "{}".
 */
function unwrapMeshError(err) {
  if (err == null) return err;
  const text = typeof err === 'string' ? err : asText(err && err.message);
  const match = String(text).match(
    /\[BrowserWallet\] An error occurred during (enable|sign|submit):\s*([\s\S]*)$/i
  ) || String(text).match(/An error occurred during (enable|sign|submit):\s*([\s\S]*)$/i);
  if (!match) return err;
  const stage = match[1].toLowerCase();
  const parsed = parseMaybeJson(match[2]);
  if (parsed && typeof parsed === 'object') {
    return { ...parsed, _meshStage: stage, _wrapped: err };
  }
  return { _meshStage: stage, _wrapped: err, message: '' };
}

function isConnectStage(err, opts) {
  if (opts && opts.stage === 'connect') return true;
  const unwrapped = unwrapMeshError(err);
  if (unwrapped && unwrapped._meshStage === 'enable') return true;
  const text = typeof err === 'string' ? err : asText(err && err.message);
  return /during enable/i.test(text) || /failed to (connect|enable)/i.test(text);
}

function collectText(err) {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  const parts = [
    asText(err.info),
    asText(err.message),
    asText(err.name),
    asText(err.error),
    asText(err.reason),
  ];
  if (err.info && typeof err.info === 'object') {
    parts.push(asText(err.info.info), asText(err.info.message));
  }
  return parts.filter(Boolean).join(' ');
}

function codeOf(err) {
  if (err == null || typeof err !== 'object') return null;
  const c = err.code ?? (err.info && err.info.code);
  const n = Number(c);
  return Number.isInteger(n) ? n : null;
}

export function isUserDeclined(err) {
  const inner = unwrapMeshError(err);
  const code = codeOf(inner);
  const text = collectText(inner);
  const lower = text.toLowerCase();
  const name = asText(inner && inner.name) || asText(inner && inner.errorName);
  // CIP-30 DataSignError / TxSignError: code 2 = user declined.
  if (code === 2 && /datasignerror|txsignerror|signerror|user.?declin|declin|cancel/i.test(name + ' ' + text)) {
    return true;
  }
  // CIP-30 APIError: code 3 = refused (user rejected enable / connection).
  if (code === 3) return true;
  if (/user.?declin|user.?cancel|user.?refus|cancelled by the user|canceled by the user/.test(lower)) {
    return true;
  }
  return false;
}

export function describeWalletError(err, opts) {
  if (err == null) return 'The wallet reported an error.';
  const inner = unwrapMeshError(err);
  const connect = isConnectStage(err, opts);
  if (isUserDeclined(inner) || isUserDeclined(err)) return CANCELLED_MESSAGE;
  if (connect) return CONNECT_FAILED_MESSAGE;
  const text = collectText(inner);
  if (text && text !== '[object Object]' && !looksLikeRawJson(text)) return text;
  if (typeof err === 'string' && err.trim() && err !== '[object Object]' && !looksLikeRawJson(err)) {
    return err;
  }
  return 'The wallet reported an error.';
}
