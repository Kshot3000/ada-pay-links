import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PREFERRED_WALLETS,
  SKIP_WALLETS,
  installedWallets,
  utxoTxHashes,
  testnetAmbiguityWarning,
  probeWalletOnLinkNetwork,
} from '../src/wallet.js';
import { describeWalletError, isUserDeclined, CANCELLED_MESSAGE } from '../src/wallet-errors.js';

const HASH = 'ab'.repeat(32);

describe('wallet listing', () => {
  it('lists Lace and Eternl first, detects other CIP-30 wallets, and never lists Nami', () => {
    assert.deepEqual(PREFERRED_WALLETS.map((w) => w.id), ['lace', 'eternl']);
    assert.equal(SKIP_WALLETS.has('nami'), true);
    const found = installedWallets({
      nami: { name: 'Nami', enable: async () => {} },
      lace: { name: 'Lace', enable: async () => {} },
      eternl: { name: 'Eternl', enable: async () => {} },
      vespr: { name: 'VESPR', enable: async () => {} },
      experimental: { anything: true },
    });
    assert.deepEqual(found.map((w) => w.id), ['lace', 'eternl', 'vespr']);
    assert.equal(found.some((w) => w.id === 'nami'), false);
    assert.deepEqual(installedWallets(null), []);
  });
});

describe('testnet ambiguity', () => {
  it('always names the testnet the link expects', () => {
    const pre = testnetAmbiguityWarning('preprod');
    assert.match(pre, /Preprod/);
    assert.match(pre, /Preview/);
    const prev = testnetAmbiguityWarning('preview');
    assert.match(prev, /Preview testnet/);
    assert.equal(testnetAmbiguityWarning('mainnet'), null);
  });

  it('extracts UTxO tx hashes and warns when the tx is missing on the link network', async () => {
    assert.deepEqual(
      utxoTxHashes([{ input: { txHash: HASH } }, { txHash: HASH }]),
      [HASH]
    );
    const skipped = await probeWalletOnLinkNetwork([{ input: { txHash: HASH } }], {
      network: 'preprod',
      config: {},
    });
    assert.equal(skipped.checked, false);

    const fetchImpl = async () => new Response(JSON.stringify([]), { status: 200 });
    const probed = await probeWalletOnLinkNetwork([{ input: { txHash: HASH } }], {
      network: 'preprod',
      config: { proxyBase: 'https://checker.example.workers.dev' },
      fetchImpl,
      sleep: async () => {},
    });
    assert.equal(probed.checked, true);
    assert.equal(probed.found, false);
    assert.equal(probed.txHash, HASH);
  });
});

describe('CIP-30 error text', () => {
  it('shows a cancelled message for user-declined sign errors and never [object Object]', () => {
    assert.equal(CANCELLED_MESSAGE, 'You cancelled in the wallet');
    assert.equal(
      describeWalletError({ code: 2, info: 'user declined', name: 'TxSignError' }),
      CANCELLED_MESSAGE
    );
    assert.equal(
      describeWalletError({ code: 2, info: 'User declined', name: 'DataSignError' }),
      CANCELLED_MESSAGE
    );
    assert.equal(isUserDeclined({ code: 3, info: 'Refused' }), true);
    assert.equal(describeWalletError({ code: 3, info: 'Refused' }), CANCELLED_MESSAGE);
    assert.equal(String(describeWalletError({ code: 1, info: 'Invalid request' })).includes('[object Object]'), false);
    assert.equal(describeWalletError({ code: 1, info: 'Invalid request' }), 'Invalid request');
    assert.equal(describeWalletError({}), 'The wallet reported an error.');
    assert.notEqual(describeWalletError({ code: 1 }), '[object Object]');
  });
});
