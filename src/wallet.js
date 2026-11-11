/**
 * CIP-30 wallet connect + ADA payment with a CIP-20 memo.
 * Lace and Eternl are listed first; any other CIP-30 wallet is detected
 * generically. Nami is omitted — it was folded into Lace and is unmaintained.
 *
 * Signing happens in the user's wallet. This page never sees a seed or key
 * and never holds funds.
 */
import {
  getNetwork,
  paymentAmountToLovelace,
  splitCip20Msg,
  CIP20_LABEL,
  isValidAdaAmount,
  isPaymentAddress,
  addressMatchesNetwork,
  assertWalletNetwork,
  isValidTxHash,
} from './paylink.js';
import { resolveCheckerConfig } from './checker.js';
import { koiosPost } from './koios.js';
import { describeWalletError } from './wallet-errors.js';

export const PREFERRED_WALLETS = [
  { id: 'lace', name: 'Lace' },
  { id: 'eternl', name: 'Eternl' },
];

/** Nami was folded into Lace and is unmaintained — never list it. */
export const SKIP_WALLETS = new Set(['nami']);

export function installedWallets(cardano) {
  const c = cardano !== undefined ? cardano : (typeof window !== 'undefined' ? window.cardano : null);
  if (!c || typeof c !== 'object') return [];
  const seen = new Set();
  const list = [];
  for (const w of PREFERRED_WALLETS) {
    if (c[w.id] && typeof c[w.id].enable === 'function') {
      list.push({ id: w.id, name: c[w.id].name || w.name });
      seen.add(w.id);
    }
  }
  for (const id of Object.keys(c)) {
    if (seen.has(id) || SKIP_WALLETS.has(id)) continue;
    const w = c[id];
    if (w && typeof w.enable === 'function') {
      list.push({ id, name: w.name || id });
    }
  }
  return list;
}

export function utxoTxHashes(utxos) {
  const hashes = [];
  for (const u of utxos || []) {
    const h = (u && u.input && (u.input.txHash || u.input.tx_hash)) || (u && (u.txHash || u.tx_hash));
    if (typeof h === 'string' && /^[0-9a-fA-F]{64}$/.test(h)) hashes.push(h.toLowerCase());
  }
  return [...new Set(hashes)];
}

export const TESTNET_UNCHECKED_CONFIRM = "We couldn't check which test network your wallet is on";

export function testnetAmbiguityWarning(network, { checked } = {}) {
  const net = getNetwork(network);
  if (!net || net.kind !== 'testnet') return null;
  const reminder =
    'This payment is for ' +
    net.label +
    '. CIP-30 wallets use the same network id for Preprod and Preview, so confirm the wallet is set to ' +
    net.label +
    ' before signing.';
  if (checked === false) {
    return TESTNET_UNCHECKED_CONFIRM + '. ' + reminder;
  }
  return reminder;
}

/**
 * Ask the link's network (via the Worker proxy) whether a wallet UTxO's
 * transaction exists there. If it does not, the wallet is likely on the
 * other testnet.
 */
export async function probeWalletOnLinkNetwork(utxos, { network, config, fetchImpl, sleep } = {}) {
  const hashes = utxoTxHashes(utxos);
  const resolved = resolveCheckerConfig(config, network);
  if (resolved.mode !== 'proxy' || !hashes.length) {
    return { checked: false, found: null, txHash: hashes[0] || null };
  }
  const txHash = hashes[0];
  try {
    const rows = await koiosPost(
      resolved.baseUrl,
      '/tx_info',
      { _tx_hashes: [txHash], _metadata: false, _inputs: false },
      { fetchImpl, sleep }
    );
    const found = Array.isArray(rows) && rows.some((r) => r && String(r.tx_hash).toLowerCase() === txHash);
    return { checked: true, found, txHash };
  } catch {
    return { checked: false, found: null, txHash };
  }
}

export async function inspectWalletForPayment({ wallet, network, config, fetchImpl, sleep } = {}) {
  const net = getNetwork(network);
  if (!net) throw new Error('Unknown network');
  let walletNet;
  let changeAddress;
  try {
    walletNet = await wallet.getNetworkId();
    changeAddress = await wallet.getChangeAddress();
  } catch (e) {
    throw new Error(describeWalletError(e));
  }
  assertWalletNetwork({ walletNetworkId: walletNet, changeAddress, network });
  const inspection = {
    walletNetworkId: walletNet,
    changeAddress,
    expectedNetwork: net.id,
    expectedLabel: net.label,
    testnetAmbiguous: net.kind === 'testnet',
    warning: testnetAmbiguityWarning(network),
    mismatchLikely: false,
  };
  if (net.kind === 'testnet') {
    let utxos = [];
    try {
      utxos = await wallet.getUtxos();
    } catch {
      utxos = [];
    }
    const probe = await probeWalletOnLinkNetwork(utxos, { network, config, fetchImpl, sleep });
    if (probe.checked && probe.found === false) {
      inspection.mismatchLikely = true;
      inspection.warning =
        "This wallet's recent transactions were not found on " +
        net.label +
        '. It may be on the other testnet (Preprod vs Preview). A payment sent on the wrong testnet will not show as paid here.';
    } else if (!probe.checked) {
      inspection.warning = testnetAmbiguityWarning(network, { checked: false });
    }
  }
  return inspection;
}

export function meshProviderUrl(network, config) {
  const resolved = resolveCheckerConfig(config, network);
  if (resolved.mode === 'proxy' && resolved.provider === 'koios') return resolved.baseUrl;
  return null;
}

export async function payWithWallet({ walletId, network, address, amount, memo, config, fetchImpl, confirmMainnet, onTestnetWarning }) {
  const net = getNetwork(network);
  if (!net) throw new Error('Unknown network');
  if (!isPaymentAddress(address) || !addressMatchesNetwork(address, network)) {
    throw new Error('The receive address does not match ' + net.label + ' (addr vs addr_test).');
  }
  if (!isValidAdaAmount(String(amount || ''))) {
    throw new Error('Enter a valid ADA amount of at least 1 and at most 45,000,000,000');
  }
  if (!memo) throw new Error('This payment link has no memo; refusing to send a payment that cannot be matched');
  if (net.kind === 'mainnet') {
    const ok = typeof confirmMainnet === 'function' ? confirmMainnet() : true;
    if (!ok) throw new Error('Mainnet payment cancelled.');
  }

  const mesh = await import('@meshsdk/core');
  const BrowserWallet = mesh.BrowserWallet;
  const MeshTxBuilder = mesh.MeshTxBuilder;
  const KoiosProvider = mesh.KoiosProvider;
  if (!BrowserWallet || !MeshTxBuilder || !KoiosProvider) {
    throw new Error('Mesh SDK failed to load. Try a refresh, or open the CIP-13 link in a compatible wallet instead.');
  }

  const proxyUrl = meshProviderUrl(network, config);
  const provider = proxyUrl ? new KoiosProvider(proxyUrl) : new KoiosProvider(net.meshNetwork);

  let wallet;
  try {
    wallet = await BrowserWallet.enable(walletId);
  } catch (e) {
    throw new Error(describeWalletError(e, { stage: 'connect' }));
  }

  const inspection = await inspectWalletForPayment({ wallet, network, config, fetchImpl });
  if (inspection.warning && typeof onTestnetWarning === 'function') {
    const proceed = onTestnetWarning(inspection);
    if (!proceed) throw new Error('Payment cancelled.');
  }


  const lovelace = paymentAmountToLovelace(String(amount)).toString();
  const msg = splitCip20Msg(memo);
  let utxos;
  let changeAddress;
  try {
    utxos = await wallet.getUtxos();
    changeAddress = await wallet.getChangeAddress();
  } catch (e) {
    throw new Error(describeWalletError(e));
  }
  if (!utxos || !utxos.length) {
    const fundHint =
      net.kind === 'mainnet'
        ? 'The wallet has no UTxOs on Mainnet. This page never holds your funds or any team funds. Fund your own wallet, then retry.'
        : 'The wallet has no UTxOs on ' + net.label + '. Fund it with test ADA first (a faucet), then retry.';
    throw new Error(fundHint);
  }

  try {
    const txBuilder = new MeshTxBuilder({ fetcher: provider, submitter: provider });
    const unsigned = await txBuilder
      .txOut(address, [{ unit: 'lovelace', quantity: lovelace }])
      .metadataValue(CIP20_LABEL, { msg })
      .changeAddress(changeAddress)
      .selectUtxosFrom(utxos)
      .complete();
    const signed = await wallet.signTx(unsigned);
    const txHash = await wallet.submitTx(signed);
    const hash = typeof txHash === 'string' ? txHash.toLowerCase() : txHash;
    return { txHash: isValidTxHash(hash) ? hash : txHash, network: net.id, inspection };
  } catch (e) {
    throw new Error(describeWalletError(e));
  }
}
