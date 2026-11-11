import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseProxyPath,
  withCors,
  injectUpstreamHeaders,
  corsPreflight,
  CORS_HEADERS,
} from '../worker/src/logic.js';

describe('worker proxy routing', () => {
  it('allows Koios lookup and Mesh-complete paths on each network', () => {
    const tip = parseProxyPath('/koios/preprod/tip');
    assert.equal(tip.upstream, 'https://preprod.koios.rest/api/v1/tip');
    const txs = parseProxyPath('/koios/preview/address_txs');
    assert.equal(txs.upstream, 'https://preview.koios.rest/api/v1/address_txs');
    const params = parseProxyPath('/koios/mainnet/epoch_params');
    assert.equal(params.upstream, 'https://api.koios.rest/api/v1/epoch_params');
    const info = parseProxyPath('/koios/preprod/tx_info');
    assert.equal(info.path, '/tx_info');
  });

  it('allows Blockfrost payment and lookup paths and rejects anything else', () => {
    const ok = parseProxyPath('/blockfrost/preprod/addresses/addr_test1abc/utxos');
    assert.ok(ok.upstream.includes('/addresses/addr_test1abc/utxos'));
    const rejected = parseProxyPath('/koios/preprod/ogmios');
    assert.equal(rejected.status, 403);
    const badNet = parseProxyPath('/koios/guild/tip');
    assert.equal(badNet.status, 404);
  });

  it('injects secrets into upstream headers and always returns CORS, including on preflight', () => {
    const headers = injectUpstreamHeaders('koios', { KOIOS_API_TOKEN: 'secret-token' }, {
      Authorization: 'Bearer leaked',
      'Content-Type': 'application/json',
    });
    assert.equal(headers.Authorization, 'Bearer secret-token');
    assert.equal(JSON.stringify(headers).includes('leaked'), false);
    const bf = injectUpstreamHeaders('blockfrost', { BLOCKFROST_PROJECT_ID: 'proj' }, {});
    assert.equal(bf.project_id, 'proj');
    const pre = corsPreflight();
    assert.equal(pre.headers['Access-Control-Allow-Origin'], '*');
    assert.equal(withCors()['Access-Control-Allow-Origin'], CORS_HEADERS['Access-Control-Allow-Origin']);
  });
});
