import {
  NETWORKS,
  DEFAULT_NETWORK,
  TIP_ADDRESS,
  getNetwork,
  isPaymentAddress,
  addressMatchesNetwork,
  isValidAdaAmount,
  normalizeAdaAmount,
  generateMemoId,
  isValidMemo,
  buildCip13Uri,
  buildPayPageUrl,
  parsePayPageUrl,
  parsePaymentLink,
  describeRequest,
  tipCip13Uri,
} from './paylink.js';
import { lookupPayment } from './koios.js';
import { fetchAdaUsdRate } from './price.js';
import { usdToAda } from './paylink.js';
import { installedWallets, payWithWallet } from './wallet.js';

const $ = (id) => document.getElementById(id);
const STORAGE_SAVED = 'ada-pay-links.saved';
const STORAGE_NET = 'ada-pay-links.network';

function qrInto(el, text) {
  el.innerHTML = '';
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    el.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 12, scalable: true });
  } catch {
    el.innerHTML = '<p class="error">QR rendering failed — use the link text instead.</p>';
  }
}

function copyText(text, btn) {
  const done = () => {
    if (!btn) return;
    const old = btn.textContent;
    btn.textContent = 'Copied ✓';
    setTimeout(() => { btn.textContent = old; }, 1500);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, done);
  } else {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    document.body.removeChild(ta);
    done();
  }
}

function currentNetwork() {
  return $('network').value || DEFAULT_NETWORK;
}

function setNetwork(id, { persist = true } = {}) {
  if (!getNetwork(id)) id = DEFAULT_NETWORK;
  $('network').value = id;
  if (persist) {
    try { localStorage.setItem(STORAGE_NET, id); } catch { /* ignore */ }
  }
  const net = getNetwork(id);
  const banner = $('net-banner');
  if (net.kind === 'mainnet') {
    banner.classList.add('mainnet');
    banner.textContent = 'Mainnet is selected, but this project is still in testing and is not audited. Only send real ADA if you accept that risk. Double-check the receive address.';
  } else {
    banner.classList.remove('mainnet');
    banner.textContent = 'This is a testnet build, in testing and unaudited. Use ' + net.label + '. Do not send real mainnet funds unless you fully understand the risk.';
  }
}

function payPageBase() {
  return window.location.origin + window.location.pathname;
}

function formatStatus(result) {
  const ada = result.receivedLovelace
    ? (Number(result.receivedLovelace) / 1_000_000).toString()
    : '0';
  if (result.status === 'paid') {
    return {
      className: 'status ok',
      text: 'Paid ✓',
      detail:
        'At least the requested ADA arrived at the receive address with a matching CIP-20 memo' +
        (result.txHash ? ' in transaction ' + result.txHash : '') +
        (result.explorerUrl ? '. ' : '.') +
        (result.explorerUrl ? '<a href="' + result.explorerUrl + '" rel="noopener" target="_blank">View on ' + (getNetwork(result.network)?.explorerName || 'explorer') + '</a>' : ''),
    };
  }
  if (result.status === 'underpaid') {
    return {
      className: 'status warn',
      text: 'Memo found, amount short',
      detail:
        'A transaction with this memo paid ' + ada + ' ADA, which is less than requested' +
        (result.explorerUrl ? '. <a href="' + result.explorerUrl + '" rel="noopener" target="_blank">View transaction</a>' : '.'),
    };
  }
  return {
    className: 'status',
    text: 'Unpaid',
    detail: result.note || 'No matching transaction was found in the recent history for this address and memo on ' + (getNetwork(result.network)?.label || 'the selected network') + '.',
  };
}

function showLookup(result, statusEl, detailEl) {
  const view = formatStatus(result);
  statusEl.className = view.className;
  statusEl.textContent = view.text;
  detailEl.innerHTML = view.detail;
}

/* ---------- tip box (on by default, unlocks nothing) ---------- */
$('tip-addr').textContent = TIP_ADDRESS;
$('tip-open').href = tipCip13Uri();
$('tip-copy').addEventListener('click', function () {
  copyText(TIP_ADDRESS, this);
});

/* ---------- network switch ---------- */
try {
  const saved = localStorage.getItem(STORAGE_NET);
  if (saved && getNetwork(saved)) $('network').value = saved;
} catch { /* ignore */ }
setNetwork(currentNetwork(), { persist: false });
$('network').addEventListener('change', () => setNetwork(currentNetwork()));

/* ---------- USD conversion ---------- */
$('f-convert').addEventListener('click', async () => {
  $('f-fx').textContent = 'Fetching a public market price…';
  $('gen-error').textContent = '';
  try {
    const usd = $('f-usd').value.trim();
    const { rate, source } = await fetchAdaUsdRate();
    const ada = usdToAda(usd, rate);
    $('f-amount').value = ada;
    $('f-fx').textContent =
      '≈ ' + ada + ' ADA at $' + rate + ' / ADA from ' + source +
      '. Approximate, not a quote. The payment link stores this ADA amount, not the USD figure.';
  } catch (e) {
    $('f-fx').textContent = '';
    $('gen-error').textContent = e.message || String(e);
  }
});

/* ---------- generator ---------- */
let lastGenerated = null;

$('gen-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  $('gen-error').textContent = '';
  try {
    const network = currentNetwork();
    const address = $('f-address').value.trim();
    if (!isPaymentAddress(address)) throw new Error('Enter a valid Cardano payment address (addr1… or addr_test1…).');
    if (!addressMatchesNetwork(address, network)) {
      throw new Error(
        getNetwork(network).kind === 'mainnet'
          ? 'Mainnet is selected, but that address is for testnet (addr_test1…).'
          : 'A testnet is selected, but that address is for mainnet (addr1…). Switch the network, or paste a testnet address.'
      );
    }
    const amountRaw = $('f-amount').value;
    const amount = amountRaw.trim() ? normalizeAdaAmount(amountRaw) : null;
    if (amountRaw.trim() && !isValidAdaAmount(amountRaw)) {
      throw new Error('Enter a valid ADA amount with at most 6 decimal places, or leave it blank for an open-amount link.');
    }
    let memo = $('f-memo').value.trim();
    if (!memo) memo = generateMemoId();
    if (!isValidMemo(memo)) throw new Error('Enter a shorter memo / invoice id (max 200 characters).');
    const label = $('f-label').value.trim() || undefined;
    const request = { network, address, amount, memo, label };
    const pageUrl = buildPayPageUrl(payPageBase(), request);
    const cip13 = buildCip13Uri({ address, amount });
    lastGenerated = { url: pageUrl, cip13, request, createdAt: Date.now() };
    $('r-url').textContent = pageUrl;
    $('r-cip13').textContent = cip13;
    $('r-memo').textContent = memo;
    $('r-page').href = pageUrl;
    $('r-embed').textContent =
      '<a href="' + pageUrl + '" target="_blank" rel="noopener">Pay with ADA</a>';
    qrInto($('r-qr'), pageUrl);
    $('gen-result').classList.remove('hidden');
    $('gen-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    $('gen-error').textContent = e.message || String(e);
  }
});

$('r-copy').addEventListener('click', function () {
  if (lastGenerated) copyText(lastGenerated.url, this);
});
$('r-copy-embed').addEventListener('click', function () {
  copyText($('r-embed').textContent, this);
});
$('r-save').addEventListener('click', () => {
  if (!lastGenerated) return;
  const list = loadSaved();
  list.unshift(lastGenerated);
  try { localStorage.setItem(STORAGE_SAVED, JSON.stringify(list.slice(0, 50))); } catch { /* ignore */ }
  renderSaved();
});

/* ---------- saved ---------- */
function loadSaved() {
  let raw;
  try { raw = JSON.parse(localStorage.getItem(STORAGE_SAVED) || '[]'); }
  catch { return []; }
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) => item && typeof item.url === 'string' && parsePayPageUrl(item.url));
}

function renderSaved() {
  const list = loadSaved();
  const ul = $('saved-list');
  ul.innerHTML = '';
  $('saved-empty').style.display = list.length ? 'none' : '';
  list.forEach((item, i) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = item.url;
    a.textContent = item.url;
    a.className = 'mono break';
    const del = document.createElement('button');
    del.textContent = 'Delete';
    del.className = 'btn ghost small-btn';
    del.addEventListener('click', () => {
      const next = loadSaved();
      next.splice(i, 1);
      try { localStorage.setItem(STORAGE_SAVED, JSON.stringify(next)); } catch { /* ignore */ }
      renderSaved();
    });
    li.appendChild(a);
    li.appendChild(del);
    ul.appendChild(li);
  });
}
renderSaved();

/* ---------- verifier ---------- */
$('v-link').addEventListener('input', () => {
  const parsed = parsePaymentLink($('v-link').value.trim());
  const needsMemo = parsed && !parsed.memo;
  $('v-memo-wrap').classList.toggle('hidden', !needsMemo);
});

$('ver-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  $('ver-status').className = 'status';
  $('ver-status').textContent = 'Checking on-chain…';
  $('ver-detail').textContent = '';
  try {
    const parsed = parsePaymentLink($('v-link').value.trim());
    if (!parsed) throw new Error('Paste a pay-page link or a web+cardano: URI.');
    if (!parsed.network) parsed.network = currentNetwork();
    if (!parsed.memo) parsed.memo = $('v-memo').value.trim();
    if (!parsed.memo) throw new Error('A memo is required to match the payment. CIP-13 URIs do not carry one, so paste it here.');
    if (!addressMatchesNetwork(parsed.address, parsed.network)) {
      throw new Error('The address does not match the selected network.');
    }
    const result = await lookupPayment(parsed);
    showLookup(result, $('ver-status'), $('ver-detail'));
  } catch (e) {
    $('ver-status').className = 'status';
    $('ver-status').textContent = 'Lookup failed';
    $('ver-detail').textContent = e.message || String(e);
  }
});

/* ---------- pay view (shared link) ---------- */
function showDesk() {
  $('payview').classList.add('hidden');
  $('desk').classList.remove('hidden');
}

function renderPayView(request) {
  setNetwork(request.network || currentNetwork(), { persist: false });
  $('desk').classList.add('hidden');
  $('payview').classList.remove('hidden');
  const pageUrl = buildPayPageUrl(payPageBase(), request);
  const cip13 = buildCip13Uri({ address: request.address, amount: request.amount });
  $('pv-title').textContent = request.label ? 'Pay ' + request.label : 'Payment request';
  $('pv-detail').textContent = describeRequest(request);
  $('pv-addr').textContent = request.address;
  $('pv-page').textContent = pageUrl;
  $('pv-cip13').textContent = cip13;
  $('pv-open').href = cip13;
  qrInto($('pv-qr'), pageUrl);
  $('pv-copy').onclick = function () { copyText(pageUrl, this); };
  $('pv-amount-wrap').classList.toggle('hidden', !!request.amount);
  if (request.amount) $('pv-amount').value = request.amount;

  const wallets = installedWallets();
  const box = $('pv-wallets');
  box.innerHTML = '';
  $('pv-nowallet').classList.toggle('hidden', wallets.length > 0);
  wallets.forEach((w) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.textContent = 'Pay with ' + w.name;
    btn.addEventListener('click', async () => {
      $('pv-pay-status').className = 'status';
      $('pv-pay-status').textContent = 'Connecting ' + w.name + '… confirm the transaction in your wallet.';
      try {
        const amount = request.amount || $('pv-amount').value.trim();
        const { txHash } = await payWithWallet({
          walletId: w.id,
          network: request.network,
          address: request.address,
          amount,
          memo: request.memo,
        });
        const net = getNetwork(request.network);
        $('pv-pay-status').className = 'status ok';
        $('pv-pay-status').innerHTML =
          'Submitted. Transaction ' + txHash +
          (net ? ' — <a href="' + net.explorerTx(txHash) + '" rel="noopener" target="_blank">view on ' + net.explorerName + '</a>' : '') +
          '. It may take a few moments to show as paid.';
      } catch (e) {
        $('pv-pay-status').className = 'status';
        $('pv-pay-status').textContent = e.message || String(e);
      }
    });
    box.appendChild(btn);
  });

  $('pv-verify').onclick = async () => {
    $('pv-status').className = 'status';
    $('pv-status').textContent = 'Checking on-chain…';
    $('pv-ver-detail').textContent = '';
    try {
      const result = await lookupPayment(request);
      showLookup(result, $('pv-status'), $('pv-ver-detail'));
    } catch (e) {
      $('pv-status').textContent = 'Lookup failed';
      $('pv-ver-detail').textContent = e.message || String(e);
    }
  };
}

$('pv-create-link').addEventListener('click', (ev) => {
  ev.preventDefault();
  const u = new URL(window.location.href);
  u.search = '';
  window.history.pushState({}, '', u);
  showDesk();
});

function bootFromQuery() {
  const parsed = parsePayPageUrl(window.location.href);
  if (parsed && parsed.address && parsed.memo) {
    renderPayView(parsed);
  } else {
    showDesk();
  }
}
bootFromQuery();
window.addEventListener('popstate', bootFromQuery);
