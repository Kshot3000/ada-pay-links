import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseProxyPath,
  withCors,
  injectUpstreamHeaders,
  corsPreflight,
  CORS_HEADERS,
  DEFAULT_ALLOWED_ORIGINS,
  isAllowedOrigin,
  gateOrigin,
  isSubmitPath,
} from '../worker/src/logic.js';
import worker from '../worker/src/index.js';

const PAGES = 'https://kshot3000.github.io';
const LOCAL = 'http://localhost:5173';
const OTHER = 'https://evil.example';

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

  it('rejects transaction-submit paths; wallets submit themselves', () => {
    assert.equal(isSubmitPath('/submittx'), true);
    assert.equal(isSubmitPath('/tx/submit'), true);
    assert.equal(isSubmitPath('/tx/submit?foo=1'), true);
    const koios = parseProxyPath('/koios/preprod/submittx');
    assert.equal(koios.status, 403);
    assert.equal(koios.error, 'Path not allowed');
    const bf = parseProxyPath('/blockfrost/mainnet/tx/submit');
    assert.equal(bf.status, 403);
    assert.equal(bf.error, 'Path not allowed');
    assert.equal(parseProxyPath('/koios/preview/tx/submit').status, 403);
    assert.equal(parseProxyPath('/blockfrost/preprod/submittx').status, 403);
  });

  it('injects secrets into upstream headers and returns CORS only for allowlisted origins', () => {
    const headers = injectUpstreamHeaders('koios', { KOIOS_API_TOKEN: 'secret-token' }, {
      Authorization: 'Bearer leaked',
      'Content-Type': 'application/json',
    });
    assert.equal(headers.Authorization, 'Bearer secret-token');
    assert.equal(JSON.stringify(headers).includes('leaked'), false);
    const bf = injectUpstreamHeaders('blockfrost', { BLOCKFROST_PROJECT_ID: 'proj' }, {});
    assert.equal(bf.project_id, 'proj');

    const pre = corsPreflight(PAGES);
    assert.equal(pre.status, 204);
    assert.equal(pre.headers['Access-Control-Allow-Origin'], PAGES);
    assert.equal(withCors({}, PAGES)['Access-Control-Allow-Origin'], PAGES);
    assert.equal('Access-Control-Allow-Origin' in CORS_HEADERS, false);

    const denied = corsPreflight(OTHER);
    assert.equal(denied.status, 403);
    assert.equal(denied.allowed, false);
    assert.equal(denied.body.error, 'Origin not allowed');
    assert.equal(withCors({}, OTHER)['Access-Control-Allow-Origin'], undefined);
  });
});

describe('worker origin allowlist', () => {
  it('defaults to the GitHub Pages origin and localhost for dev', () => {
    assert.ok(DEFAULT_ALLOWED_ORIGINS.includes(PAGES));
    assert.ok(DEFAULT_ALLOWED_ORIGINS.includes('http://localhost'));
    assert.equal(isAllowedOrigin(PAGES), true);
    assert.equal(isAllowedOrigin(LOCAL), true);
    assert.equal(isAllowedOrigin('http://localhost'), true);
    assert.equal(isAllowedOrigin('http://127.0.0.1:4173'), true);
    assert.equal(isAllowedOrigin(OTHER), false);
    assert.equal(isAllowedOrigin(''), false);
    assert.equal(isAllowedOrigin(undefined), false);
    assert.equal(gateOrigin(OTHER).status, 403);
    assert.equal(gateOrigin(PAGES).allowed, true);
  });

  it('replaces the default list when ALLOWED_ORIGINS is set', () => {
    const env = { ALLOWED_ORIGINS: 'https://pay.example,https://desk.example' };
    assert.equal(isAllowedOrigin('https://pay.example', env), true);
    assert.equal(isAllowedOrigin(PAGES, env), false);
    assert.equal(isAllowedOrigin(LOCAL, env), false);
  });
});

describe('worker fetch origin gate', () => {
  let originalFetch;
  let upstreamCalls;

  before(() => {
    originalFetch = globalThis.fetch;
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  function stubUpstream() {
    upstreamCalls = [];
    globalThis.fetch = async (url, init) => {
      upstreamCalls.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
  }

  const env = { KOIOS_API_TOKEN: 'secret-token' };

  it('returns 403 and does not proxy when Origin is not allowlisted', async () => {
    stubUpstream();
    const res = await worker.fetch(new Request('https://checker.example/koios/preprod/tip', {
      headers: { Origin: OTHER },
    }), env);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, 'Origin not allowed');
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
    assert.equal(upstreamCalls.length, 0);
  });

  it('returns 403 and does not proxy when Origin is missing', async () => {
    stubUpstream();
    const res = await worker.fetch(new Request('https://checker.example/koios/preprod/tip'), env);
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'Origin not allowed');
    assert.equal(upstreamCalls.length, 0);
  });

  it('proxies allowlisted origins and echoes the request Origin', async () => {
    stubUpstream();
    const res = await worker.fetch(new Request('https://checker.example/koios/preprod/tip', {
      headers: { Origin: PAGES },
    }), env);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), PAGES);
    assert.equal(upstreamCalls.length, 1);
    assert.match(String(upstreamCalls[0].url), /preprod\.koios\.rest\/api\/v1\/tip$/);
  });

  it('rejects disallowed-origin preflight without forwarding', async () => {
    stubUpstream();
    const res = await worker.fetch(new Request('https://checker.example/koios/preprod/tip', {
      method: 'OPTIONS',
      headers: { Origin: OTHER },
    }), env);
    assert.equal(res.status, 403);
    assert.equal(upstreamCalls.length, 0);
  });
});
