import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatLookupStatus, receivedAdaLabel, renderLookupStatus } from '../src/ui-status.js';
import { CHECKER_UNREACHABLE_MESSAGE } from '../src/checker.js';

const HASH = 'ab'.repeat(32);
const TESTNET_ADDR =
  'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjqp';

function fakeDoc() {
  const created = [];
  const doc = {
    createElement(name) {
      const el = {
        tagName: name,
        href: '',
        rel: '',
        target: '',
        textContent: '',
      };
      created.push(el);
      return el;
    },
    createTextNode(text) {
      return { textContent: text };
    },
  };
  const statusEl = { className: '', textContent: '' };
  const kids = [];
  const detailEl = {
    textContent: '',
    appendChild(node) { kids.push(node); },
  };
  return { doc, statusEl, detailEl, created, kids };
}

describe('status formatting', () => {
  it('formats received lovelace with integer math, not floats', () => {
    assert.equal(receivedAdaLabel('2500000'), '2.5');
    assert.equal(receivedAdaLabel('1000000'), '1');
  });

  it('shows the Cardanoscan fallback wording for an unreachable checker', () => {
    const view = formatLookupStatus({
      status: 'unreachable',
      network: 'preprod',
      address: TESTNET_ADDR,
      message: CHECKER_UNREACHABLE_MESSAGE,
      explorerUrl: 'https://preprod.cardanoscan.io/address/' + TESTNET_ADDR,
    });
    assert.equal(view.text, "Couldn't reach the network checker, open in Cardanoscan");
    assert.equal(view.explorerLabel, 'open in Cardanoscan');
    assert.ok(view.explorerUrl.endsWith('/address/' + TESTNET_ADDR));
  });

  it('only attaches an explorer link for a 64-hex tx hash and builds it with the DOM, not innerHTML', () => {
    const view = formatLookupStatus({
      status: 'paid',
      network: 'preprod',
      txHash: HASH,
      receivedLovelace: '2000000',
    });
    assert.equal(view.explorerUrl, 'https://preprod.cardanoscan.io/transaction/' + HASH);
    const unsafe = formatLookupStatus({
      status: 'paid',
      network: 'preprod',
      txHash: '"><img src=x onerror=alert(1)>',
      receivedLovelace: '2000000',
    });
    assert.equal(unsafe.explorerUrl, null);
    assert.equal(unsafe.detailText.includes('<img'), false);

    const { doc, statusEl, detailEl, created, kids } = fakeDoc();
    renderLookupStatus({
      status: 'paid',
      network: 'preprod',
      txHash: HASH,
      receivedLovelace: '2000000',
    }, statusEl, detailEl, doc);
    assert.equal(statusEl.textContent, 'Paid ✓');
    assert.equal(created[0].tagName, 'a');
    assert.equal(created[0].href, 'https://preprod.cardanoscan.io/transaction/' + HASH);
    assert.equal(created[0].textContent, 'View on Cardanoscan (Preprod)');
    assert.ok(kids.length >= 1);
    assert.equal(Object.prototype.hasOwnProperty.call(detailEl, 'innerHTML'), false);
  });
});
