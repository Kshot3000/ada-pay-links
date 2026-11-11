/**
 * Pure status-view helpers. The app builds DOM with createElement/textContent
 * from this data — no innerHTML of tx hashes or URLs.
 */
import {
  CHECKER_UNREACHABLE_MESSAGE,
  isValidTxHash,
  safeExplorerTxUrl,
  safeExplorerAddressUrl,
} from './checker.js';
import { getNetwork, lovelaceToAda } from './paylink.js';

export function receivedAdaLabel(receivedLovelace) {
  try {
    return lovelaceToAda(BigInt(receivedLovelace || 0));
  } catch {
    return '0';
  }
}

/**
 * Describe a lookup result for the UI. explorerUrl is only set when the
 * tx hash is 64 lowercase hex (or, for unreachable, when we have an address).
 */
export function formatLookupStatus(result) {
  const r = result || {};
  const net = getNetwork(r.network);
  const ada = receivedAdaLabel(r.receivedLovelace);

  if (r.status === 'unreachable') {
    return {
      className: 'status warn',
      text: CHECKER_UNREACHABLE_MESSAGE,
      detailText: '',
      explorerUrl: safeExplorerAddressUrl(r.network, r.address || r.receiveAddress) || r.explorerUrl || null,
      explorerLabel: 'open in Cardanoscan',
    };
  }

  const txUrl = isValidTxHash(r.txHash) ? (safeExplorerTxUrl(r.network, r.txHash) || null) : null;

  if (r.status === 'paid') {
    return {
      className: 'status ok',
      text: 'Paid ✓',
      detailText:
        'At least the requested ADA arrived at the receive address with a matching CIP-20 memo' +
        (isValidTxHash(r.txHash) ? ' in transaction ' + r.txHash : '') +
        '.',
      explorerUrl: txUrl,
      explorerLabel: 'View on ' + (net ? net.explorerName : 'Cardanoscan'),
    };
  }

  if (r.status === 'underpaid') {
    return {
      className: 'status warn',
      text: 'Memo found, amount short',
      detailText: 'A transaction with this memo paid ' + ada + ' ADA, which is less than requested.',
      explorerUrl: txUrl,
      explorerLabel: 'View transaction',
    };
  }

  return {
    className: 'status',
    text: 'Unpaid',
    detailText:
      r.note ||
      'No matching transaction was found in the recent history for this address and memo on ' +
        (net ? net.label : 'the selected network') +
        '.',
    explorerUrl: null,
    explorerLabel: '',
  };
}

/** Fill a status + detail element without assigning innerHTML from chain data. */
export function renderLookupStatus(result, statusEl, detailEl, doc) {
  const view = formatLookupStatus(result);
  statusEl.className = view.className;
  statusEl.textContent = view.text;
  detailEl.textContent = view.detailText;
  if (view.explorerUrl) {
    const a = (doc || document).createElement('a');
    a.href = view.explorerUrl;
    a.rel = 'noopener';
    a.target = '_blank';
    a.textContent = view.explorerLabel || 'open in Cardanoscan';
    if (view.detailText) detailEl.appendChild((doc || document).createTextNode(' '));
    detailEl.appendChild(a);
  }
  return view;
}
