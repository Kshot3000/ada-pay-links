/**
 * CIP-30 wallet connect + ADA payment with a CIP-20 memo.
 * Uses Mesh against public Koios (no API key, no custody).
 * The transaction is signed in the user's wallet; this page never sees a seed or private key.
 */
import { getNetwork, adaToLovelace, splitCip20Msg, CIP20_LABEL, isValidAdaAmount } from './paylink.js';

export const PREFERRED_WALLETS = [
  { id: 'lace', name: 'Lace' },
  { id: 'eternl', name: 'Eternl' },
  { id: 'nami', name: 'Nami' },
];

export function installedWallets() {
  const c = typeof window !== 'undefined' ? window.cardano : null;
  if (!c) return [];
  const seen = new Set();
  const list = [];
  for (const w of PREFERRED_WALLETS) {
    if (c[w.id] && typeof c[w.id].enable === 'function') {
      list.push({ id: w.id, name: c[w.id].name || w.name });
      seen.add(w.id);
    }
  }
  for (const id of Object.keys(c)) {
    if (seen.has(id)) continue;
    const w = c[id];
    if (w && typeof w.enable === 'function') {
      list.push({ id, name: w.name || id });
    }
  }
  return list;
}

export async function payWithWallet({ walletId, network, address, amount, memo }) {
  const net = getNetwork(network);
  if (!net) throw new Error('Unknown network');
  if (!isValidAdaAmount(String(amount || ''))) {
    throw new Error('Enter a valid ADA amount to pay');
  }
  if (!memo) throw new Error('This payment link has no memo; refusing to send a payment that cannot be matched');

  const mesh = await import('@meshsdk/core');
  const BrowserWallet = mesh.BrowserWallet;
  const MeshTxBuilder = mesh.MeshTxBuilder;
  const KoiosProvider = mesh.KoiosProvider;
  if (!BrowserWallet || !MeshTxBuilder || !KoiosProvider) {
    throw new Error('Mesh SDK failed to load. Try a refresh, or open the CIP-13 link in a compatible wallet instead.');
  }

  const provider = new KoiosProvider(net.meshNetwork);
  const wallet = await BrowserWallet.enable(walletId);
  const walletNet = await wallet.getNetworkId();
  if (walletNet !== net.networkId) {
    throw new Error(
      'The connected wallet is on ' +
        (walletNet === 1 ? 'mainnet' : 'a testnet') +
        ', but this payment is for ' +
        net.label +
        '. Switch the network in Lace, Eternl, or Nami and try again. Preprod and Preview are both testnets — the wallet cannot tell them apart, so double-check you picked the same one as this page.'
    );
  }

  const lovelace = adaToLovelace(String(amount)).toString();
  const msg = splitCip20Msg(memo);
  const utxos = await wallet.getUtxos();
  const changeAddress = await wallet.getChangeAddress();
  if (!utxos || !utxos.length) {
    throw new Error('The wallet has no UTxOs on ' + net.label + '. Fund it with test ADA first (a faucet), then retry.');
  }

  const txBuilder = new MeshTxBuilder({ fetcher: provider, submitter: provider });
  const unsigned = await txBuilder
    .txOut(address, [{ unit: 'lovelace', quantity: lovelace }])
    .metadataValue(CIP20_LABEL, { msg })
    .changeAddress(changeAddress)
    .selectUtxosFrom(utxos)
    .complete();
  const signed = await wallet.signTx(unsigned);
  // Prefer the wallet's own submit so we do not depend on Koios submit limits.
  const txHash = await wallet.submitTx(signed);
  return { txHash, network: net.id };
}
