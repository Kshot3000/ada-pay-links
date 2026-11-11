/**
 * CIP-30 wallet errors are often plain { code, info } objects, not Error.
 * Never display "[object Object]".
 */
export const CANCELLED_MESSAGE = 'You cancelled in the wallet';

function asText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
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
  const code = codeOf(err);
  const text = collectText(err);
  const lower = text.toLowerCase();
  const name = asText(err && err.name) || asText(err && err.errorName);
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

export function describeWalletError(err) {
  if (err == null) return 'The wallet reported an error.';
  if (isUserDeclined(err)) return CANCELLED_MESSAGE;
  const text = collectText(err);
  if (text && text !== '[object Object]') return text;
  if (typeof err === 'string' && err.trim() && err !== '[object Object]') return err;
  if (typeof err === 'object') {
    try {
      const json = JSON.stringify(err);
      if (json && json !== '{}' && json !== 'null' && json !== '[object Object]') {
        return 'Wallet error: ' + json;
      }
    } catch {
      /* ignore */
    }
  }
  return 'The wallet reported an error.';
}
