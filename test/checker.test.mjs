import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIRECT_BASES,
  CHECKER_UNREACHABLE_MESSAGE,
  normalizeProvider,
  trimSlash,
  parseCheckerConfig,
  resolveCheckerConfig,
  checkerFailure,
  isValidTxHash,
  safeExplorerTxUrl,
} from '../src/checker.js';
import { checkPaymentStatus } from '../src/payment.js';
import { initialNetwork, networkToPersist } from '../src/network-pref.js';

const TESTNET_ADDR =
  'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjqp';

describe('checker config', () => {
  it('defaults to public Koios on preprod', () => {
    const cfg = resolveCheckerConfig({}, 'preprod');
    assert.equal(cfg.provider, 'koios');
    assert.equal(cfg.mode, 'direct');
    assert.equal(cfg.baseUrl, DIRECT_BASES.koios.preprod);
  });

  it('resolves Blockfrost hosts per network', () => {
    assert.equal(normalizeProvider('Blockfrost'), 'blockfrost');
    assert.equal(
      resolveCheckerConfig({ provider: 'blockfrost' }, 'mainnet').baseUrl,
      DIRECT_BASES.blockfrost.mainnet
    );
  });

  it('builds a Worker proxy base of /provider/network and trims slashes', () => {
    const cfg = resolveCheckerConfig({ provider: 'koios', proxyBase: 'https://checker.example.workers.dev/' }, 'preview');
    assert.equal(cfg.mode, 'proxy');
    assert.equal(cfg.baseUrl, 'https://checker.example.workers.dev/koios/preview');
    assert.equal(trimSlash('https://x.example/'), 'https://x.example');
  });

  it('parses JSON config and ignores junk', () => {
    assert.deepEqual(parseCheckerConfig('{"provider":"blockfrost"}'), { provider: 'blockfrost' });
    assert.deepEqual(parseCheckerConfig('nope'), {});
    assert.deepEqual(parseCheckerConfig(''), {});
  });
});

describe('checker fallback', () => {
  it('returns the Cardanoscan fallback message and address link when the checker cannot be reached', () => {
    const result = checkerFailure(
      { network: 'preprod', address: TESTNET_ADDR, memo: 'INV-1' },
      new Error('CORS')
    );
    assert.equal(result.status, 'unreachable');
    assert.equal(result.paid, false);
    assert.equal(result.message, CHECKER_UNREACHABLE_MESSAGE);
    assert.equal(result.message, "Couldn't reach the network checker, open in Cardanoscan");
    assert.equal(result.explorerUrl, 'https://preprod.cardanoscan.io/address/' + TESTNET_ADDR);
  });

  it('checkPaymentStatus uses the fallback in a browser-like (no proxy, no allowDirect) setting', async () => {
    const result = await checkPaymentStatus(
      { network: 'preprod', address: TESTNET_ADDR, memo: 'INV-1', amount: '2' },
      { config: {}, allowDirect: false }
    );
    assert.equal(result.status, 'unreachable');
    assert.equal(result.message, CHECKER_UNREACHABLE_MESSAGE);
  });

  it('only treats 64 lowercase hex characters as a safe tx hash', () => {
    const hash = 'a'.repeat(64);
    assert.equal(isValidTxHash(hash), true);
    assert.equal(isValidTxHash('A'.repeat(64)), false);
    assert.equal(isValidTxHash('javascript:alert(1)'), false);
    assert.equal(safeExplorerTxUrl('preprod', hash), 'https://preprod.cardanoscan.io/transaction/' + hash);
    assert.equal(safeExplorerTxUrl('preprod', '<script>'), null);
  });
});

describe('network preference', () => {
  it('never persists mainnet and defaults a visit to the link network or Preprod', () => {
    assert.equal(networkToPersist('mainnet'), null);
    assert.equal(networkToPersist('preprod'), 'preprod');
    assert.equal(networkToPersist('preview'), 'preview');
    assert.equal(initialNetwork({ linkNetwork: 'preview', saved: 'mainnet' }), 'preview');
    assert.equal(initialNetwork({ saved: 'mainnet' }), 'preprod');
    assert.equal(initialNetwork({ saved: 'preview' }), 'preview');
    assert.equal(initialNetwork({}), 'preprod');
  });
});
