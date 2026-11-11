import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addressTxsPath, lookupPayment, koiosPost, TX_PAGE_LIMIT } from '../src/koios.js';

const TESTNET_ADDR =
  'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjqp';
const HASH = 'ab'.repeat(32);

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('koios listing and backoff', () => {
  it('lists transactions with limit=50 and newest-first order, not a Range header', () => {
    const path = addressTxsPath();
    assert.equal(path, '/address_txs?limit=50&order=block_height.desc');
    assert.equal(TX_PAGE_LIMIT, 50);
  });

  it('retries on HTTP 429 then succeeds', async () => {
    let hits = 0;
    const fetchImpl = async () => {
      hits += 1;
      if (hits < 3) return jsonResponse({ error: 'rate' }, 429);
      return jsonResponse([{ tx_hash: HASH, block_height: 10, block_time: 50 }]);
    };
    const rows = await koiosPost('https://example.test', addressTxsPath(), { _addresses: [TESTNET_ADDR] }, {
      fetchImpl,
      sleep: async () => {},
    });
    assert.equal(hits, 3);
    assert.equal(rows[0].tx_hash, HASH);
  });

  it('stops scanning address_txs once a row is older than created, and matches a later payment', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, body: init && init.body });
      if (String(url).includes('address_txs')) {
        return jsonResponse([
          { tx_hash: HASH, block_height: 20, block_time: 5000 },
          { tx_hash: 'cd'.repeat(32), block_height: 10, block_time: 100 },
        ]);
      }
      return jsonResponse([
        {
          tx_hash: HASH,
          tx_timestamp: 5000,
          block_height: 20,
          metadata: { '674': { msg: ['INV-42-aa11bb'] } },
          outputs: [{ payment_addr: { bech32: TESTNET_ADDR }, value: '2000000' }],
        },
      ]);
    };
    const result = await lookupPayment(
      { network: 'preprod', address: TESTNET_ADDR, amount: '2', memo: 'INV-42-aa11bb', created: 1000 },
      { baseUrl: 'https://example.test/v1', fetchImpl, sleep: async () => {} }
    );
    assert.equal(result.status, 'paid');
    assert.equal(result.txHash, HASH);
    assert.ok(calls.some((c) => String(c.url).includes('limit=50&order=block_height.desc')));
    const infoCall = calls.find((c) => String(c.url).endsWith('/tx_info'));
    const hashes = JSON.parse(infoCall.body)._tx_hashes;
    assert.deepEqual(hashes, [HASH]);
    assert.equal(result.explorerUrl, 'https://preprod.cardanoscan.io/transaction/' + HASH);
  });
});
