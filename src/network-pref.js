/**
 * Network switch persistence. Mainnet is never saved, so a later visit
 * always opens on the payment link's network or Preprod.
 */
import { DEFAULT_NETWORK, getNetwork } from './paylink.js';

export function networkToPersist(id) {
  const net = getNetwork(id);
  if (!net || net.kind === 'mainnet') return null;
  return net.id;
}

export function initialNetwork({ linkNetwork, saved } = {}) {
  if (linkNetwork && getNetwork(linkNetwork)) return linkNetwork;
  if (saved && getNetwork(saved) && getNetwork(saved).kind !== 'mainnet') return saved;
  return DEFAULT_NETWORK;
}
