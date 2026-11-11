import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIP_ADDRESS,
  NETWORKS,
  DEFAULT_NETWORK,
  CIP20_MAX_BYTES,
  decodeBech32,
  isPaymentAddress,
  addressNetworkKind,
  addressMatchesNetwork,
  isValidAdaAmount,
  isWellFormedAdaAmount,
  isAllowedPaymentAmount,
  isValidUsdAmount,
  normalizeAdaAmount,
  adaToLovelace,
  lovelaceToAda,
  usdToAda,
  adaToUsd,
  isValidMemo,
  normalizeMemo,
  splitCip20Msg,
  generateMemoId,
  generateMemoSuffix,
  finalizeMemo,
  capLabel,
  decodePaymentAddress,
  walletNetworkMismatch,
  MAINNET_WARNING,
  MAINNET_PAY_CONFIRM,
  buildCip13Uri,
  parseCip13Uri,
  buildPayPageQuery,
  buildPayPageUrl,
  parsePayPageUrl,
  parsePaymentLink,
  extractCip20Messages,
  memoMatches,
  lovelaceReceivedByAddress,
  matchPayment,
  findMatchingPayment,
  tipCip13Uri,
} from '../src/paylink.js';

// Public CIP-19 documentation examples (not anyone's personal wallet).
const TESTNET_ADDR =
  'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjqp';

// Test-only bech32 encoder (BIP-173) so we can mint a valid stake_test string
// from a known payment address payload. Not used by the app.
const _CS = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const _GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
function _polymod(values) {
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= _GEN[i];
  }
  return chk >>> 0;
}
function _hrpExpand(hrp) {
  const out = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}
function encodeBech32(hrp, words) {
  const data = words.concat([0, 0, 0, 0, 0, 0]);
  const mod = _polymod(_hrpExpand(hrp).concat(data)) ^ 1;
  const chk = [];
  for (let i = 0; i < 6; i++) chk[i] = (mod >> (5 * (5 - i))) & 31;
  return hrp + '1' + words.concat(chk).map((w) => _CS[w]).join('');
}

describe('bech32 and addresses', () => {
  it('decodes and accepts the developer tip address as a mainnet payment address', () => {
    const d = decodeBech32(TIP_ADDRESS);
    assert.ok(d, 'tip address failed bech32 checksum');
    assert.equal(d.hrp, 'addr');
    assert.equal(isPaymentAddress(TIP_ADDRESS), true);
    assert.equal(addressNetworkKind(TIP_ADDRESS), 'mainnet');
    assert.equal(addressMatchesNetwork(TIP_ADDRESS, 'mainnet'), true);
    assert.equal(addressMatchesNetwork(TIP_ADDRESS, 'preprod'), false);
    assert.equal(addressMatchesNetwork(TIP_ADDRESS, 'preview'), false);
  });

  it('accepts a well-known testnet documentation address and rejects it on mainnet', () => {
    assert.equal(isPaymentAddress(TESTNET_ADDR), true);
    assert.equal(addressNetworkKind(TESTNET_ADDR), 'testnet');
    assert.equal(addressMatchesNetwork(TESTNET_ADDR, 'preprod'), true);
    assert.equal(addressMatchesNetwork(TESTNET_ADDR, 'preview'), true);
    assert.equal(addressMatchesNetwork(TESTNET_ADDR, 'mainnet'), false);
  });

  it('rejects mixed case, truncated, stake, and junk addresses', () => {
    const mixed = TESTNET_ADDR.slice(0, 10).toUpperCase() + TESTNET_ADDR.slice(10);
    assert.equal(isPaymentAddress(mixed), false);
    assert.equal(isPaymentAddress(TESTNET_ADDR.slice(0, -1)), false);
    assert.equal(isPaymentAddress('not-an-address'), false);
    assert.equal(isPaymentAddress(''), false);
    assert.equal(isPaymentAddress(null), false);
    // Flip one character in the checksum / data and expect failure.
    const flipped = TESTNET_ADDR.slice(0, -2) + (TESTNET_ADDR.at(-2) === 'q' ? 'p' : 'q') + TESTNET_ADDR.at(-1);
    assert.equal(isPaymentAddress(flipped), false);
  });

  it('does not treat a checksum-valid stake address as a payment address', () => {
    const payment = decodeBech32(TESTNET_ADDR);
    const stake = encodeBech32('stake_test', payment.words);
    assert.ok(decodeBech32(stake), 'helper should produce a valid stake_test bech32 string');
    assert.equal(isPaymentAddress(stake), false);
    assert.equal(addressNetworkKind(stake), null);
  });
});

describe('ADA amount conversion', () => {
  it('accepts well-formed positive ADA amounts with at most 6 decimals', () => {
    assert.equal(isWellFormedAdaAmount('1'), true);
    assert.equal(isWellFormedAdaAmount('0.000001'), true);
    assert.equal(isWellFormedAdaAmount('25.50'), true);
    assert.equal(isWellFormedAdaAmount('1000000'), true);
  });

  it('rejects payment amounts under 1 ADA or over the 45 billion ADA supply', () => {
    assert.equal(isAllowedPaymentAmount('1'), true);
    assert.equal(isValidAdaAmount('1'), true);
    assert.equal(isAllowedPaymentAmount('0.999999'), false);
    assert.equal(isAllowedPaymentAmount('0.000001'), false);
    assert.equal(isAllowedPaymentAmount('45000000000'), true);
    assert.equal(isAllowedPaymentAmount('45000000000.000001'), false);
    assert.throws(() => buildCip13Uri({ address: TESTNET_ADDR, amount: '0.5' }), /at least 1|Invalid ADA amount/);
  });

  it('rejects zero, negative, too many decimals, commas, and scientific notation', () => {
    for (const bad of ['', '0', '0.0', '0.000000', '-1', '+1', '1.', '.5', '1.0000001', '1,000', '1e2', '  ', '01.2', 'abc']) {
      assert.equal(isValidAdaAmount(bad), false, bad);
    }
  });

  it('normalizes trailing zeros and converts ADA ↔ lovelace exactly', () => {
    assert.equal(normalizeAdaAmount('1.500000'), '1.5');
    assert.equal(normalizeAdaAmount('2.0'), '2');
    assert.equal(adaToLovelace('1'), 1_000_000n);
    assert.equal(adaToLovelace('0.000001'), 1n);
    assert.equal(adaToLovelace('2.5'), 2_500_000n);
    assert.equal(adaToLovelace('25.50'), 25_500_000n);
    assert.equal(lovelaceToAda(1n), '0.000001');
    assert.equal(lovelaceToAda(1_000_000n), '1');
    assert.equal(lovelaceToAda(2_500_000n), '2.5');
    assert.equal(lovelaceToAda(adaToLovelace('123.456789')), '123.456789');
  });

  it('throws on invalid ADA → lovelace conversion', () => {
    assert.throws(() => adaToLovelace('0'), /Invalid ADA amount/);
    assert.throws(() => adaToLovelace('1.0000001'), /Invalid ADA amount/);
  });
});

describe('USD amount conversion (approximate)', () => {
  it('converts USD to ADA at a rate, rounded to the nearest lovelace', () => {
    // $10 at $0.50 / ADA = 20 ADA exactly.
    assert.equal(usdToAda('10', 0.5), '20');
    // $1 at $0.1751 / ADA ≈ 5.711022 ADA (1 / 0.1751 * 1e6, rounded).
    const ada = usdToAda('1', 0.1751);
    const lovelace = adaToLovelace(ada);
    const expected = BigInt(Math.round((1 / 0.1751) * 1_000_000));
    assert.equal(lovelace, expected);
    // Reverse is labeled approximate and reported to 2 decimal dollars.
    assert.equal(adaToUsd('20', 0.5), '10.00');
    assert.equal(adaToUsd('1', 0.1751), '0.18'); // 0.1751 rounds to 0.18
  });

  it('rejects bad rates and amounts', () => {
    assert.equal(isValidUsdAmount('9.99'), true);
    assert.equal(isValidUsdAmount('0'), false);
    assert.throws(() => usdToAda('10', 0), /Invalid ADA\/USD price/);
    assert.throws(() => usdToAda('10', -1), /Invalid ADA\/USD price/);
    assert.throws(() => usdToAda('0', 0.5), /Invalid USD amount/);
    assert.throws(() => usdToAda('nope', 0.5), /Invalid USD amount/);
    // A tiny USD amount at a huge ADA price may not reach 1 lovelace.
    assert.throws(() => usdToAda('0.000001', 100000), /too small/);
  });
});

describe('CIP-13 URI building and parsing', () => {
  it('builds a payment URI with decimal ADA (not lovelace)', () => {
    const uri = buildCip13Uri({ address: TESTNET_ADDR, amount: '2.50' });
    assert.equal(uri, 'web+cardano:' + TESTNET_ADDR + '?amount=2.5');
    const parsed = parseCip13Uri(uri);
    assert.deepEqual(parsed, { address: TESTNET_ADDR, amount: '2.5' });
  });

  it('builds an open-amount URI and round-trips it', () => {
    const uri = buildCip13Uri({ address: TESTNET_ADDR });
    assert.equal(uri, 'web+cardano:' + TESTNET_ADDR);
    assert.deepEqual(parseCip13Uri(uri), { address: TESTNET_ADDR, amount: null });
  });

  it('accepts a cardano: alias on parse but always emits web+cardano:', () => {
    const parsed = parseCip13Uri('cardano:' + TESTNET_ADDR + '?amount=1');
    assert.deepEqual(parsed, { address: TESTNET_ADDR, amount: '1' });
    assert.ok(buildCip13Uri(parsed).startsWith('web+cardano:'));
  });

  it('rejects stake authority URIs, invalid amounts, and duplicated amount params', () => {
    assert.equal(parseCip13Uri('web+cardano://stake?COSD'), null);
    assert.equal(parseCip13Uri('web+cardano:' + TESTNET_ADDR + '?amount=0'), null);
    assert.equal(parseCip13Uri('web+cardano:' + TESTNET_ADDR + '?amount=1&amount=9'), null);
    assert.equal(parseCip13Uri('web+cardano:not-an-address?amount=1'), null);
    assert.throws(() => buildCip13Uri({ address: 'nope', amount: '1' }), /Invalid Cardano payment address/);
    assert.throws(() => buildCip13Uri({ address: TESTNET_ADDR, amount: '0' }), /Invalid ADA amount/);
    assert.throws(() => buildCip13Uri({ address: TESTNET_ADDR, amount: '1.0000001' }), /Invalid ADA amount/);
  });

  it('builds a mainnet tip URI with no amount (unlocks nothing)', () => {
    const uri = tipCip13Uri();
    assert.equal(uri, 'web+cardano:' + TIP_ADDRESS);
    assert.deepEqual(parseCip13Uri(uri), { address: TIP_ADDRESS, amount: null });
  });
});

describe('pay-page link building and parsing', () => {
  const base = 'https://example.com/ada-pay-links/';
  const req = {
    network: 'preprod',
    address: TESTNET_ADDR,
    amount: '5.00',
    memo: 'INV-42',
    label: 'Test Shop',
  };

  it('round-trips a hosted pay-page URL, including normalized amount', () => {
    const url = buildPayPageUrl(base, req);
    assert.ok(url.startsWith(base + '?'));
    const parsed = parsePayPageUrl(url);
    assert.equal(parsed.network, 'preprod');
    assert.equal(parsed.address, TESTNET_ADDR);
    assert.equal(parsed.amount, '5');
    assert.equal(parsed.memo, 'INV-42');
    assert.equal(parsed.label, 'Test Shop');
    assert.equal(typeof parsed.created, 'number');
    assert.ok(parsed.created > 0);
  });

  it('parses the same request from parsePaymentLink as from parsePayPageUrl', () => {
    const url = buildPayPageUrl(base, req);
    assert.deepEqual(parsePaymentLink(url), parsePayPageUrl(url));
  });

  it('defaults the network to preprod when a pay-page link omits it, if the address is testnet', () => {
    const url = 'https://example.com/?address=' + TESTNET_ADDR + '&memo=INV-1&amount=1';
    const parsed = parsePayPageUrl(url);
    assert.equal(parsed.network, DEFAULT_NETWORK);
    assert.equal(parsed.memo, 'INV-1');
    assert.equal(parsed.amount, '1');
  });

  it('rejects a mainnet address on preprod and a testnet address on mainnet', () => {
    assert.throws(
      () => buildPayPageQuery({ network: 'preprod', address: TIP_ADDRESS, memo: 'x' }),
      /mainnet address/
    );
    assert.throws(
      () => buildPayPageQuery({ network: 'mainnet', address: TESTNET_ADDR, memo: 'x' }),
      /testnet address/
    );
    assert.equal(
      parsePayPageUrl('https://example.com/?network=preprod&address=' + TIP_ADDRESS + '&memo=x'),
      null
    );
  });

  it('requires a memo when building, and rejects duplicate query keys', () => {
    assert.throws(
      () => buildPayPageQuery({ network: 'preprod', address: TESTNET_ADDR }),
      /memo/
    );
    assert.equal(
      parsePayPageUrl('https://example.com/?address=' + TESTNET_ADDR + '&memo=a&memo=b'),
      null
    );
    assert.equal(
      parsePayPageUrl('https://example.com/?address=' + TESTNET_ADDR + '&amount=1&amount=2&memo=a'),
      null
    );
  });

  it('parsePaymentLink reads CIP-13 URIs, which carry no network or memo', () => {
    const parsed = parsePaymentLink(buildCip13Uri({ address: TESTNET_ADDR, amount: '3' }));
    assert.deepEqual(parsed, {
      network: null,
      address: TESTNET_ADDR,
      amount: '3',
      memo: null,
      label: null,
      created: null,
    });
  });
});

describe('memo / CIP-20 helpers', () => {
  it('accepts ordinary invoice ids and rejects empty or overlong memos', () => {
    assert.equal(isValidMemo('INV-42'), true);
    assert.equal(isValidMemo('  hi  '), true);
    assert.equal(normalizeMemo('  hi  '), 'hi');
    assert.equal(isValidMemo(''), false);
    assert.equal(isValidMemo('x'.repeat(201)), false);
  });

  it('splits a memo into CIP-20 lines of at most 64 UTF-8 bytes', () => {
    const short = splitCip20Msg('Order #1234');
    assert.deepEqual(short, ['Order #1234']);
    const long = 'A'.repeat(100);
    const lines = splitCip20Msg(long);
    assert.ok(lines.length >= 2);
    assert.equal(lines.join(''), long);
    for (const line of lines) {
      assert.ok(Buffer.from(line, 'utf8').length <= CIP20_MAX_BYTES);
    }
    // Multibyte characters must not be cut in half.
    const smile = '🙂'.repeat(40); // 4 bytes each = 160 bytes
    const parts = splitCip20Msg(smile);
    assert.equal(parts.join(''), smile);
    for (const line of parts) assert.ok(Buffer.from(line, 'utf8').length <= CIP20_MAX_BYTES);
  });

  it('generates unique APL- memo ids', () => {
    const a = generateMemoId();
    const b = generateMemoId();
    assert.match(a, /^APL-[0-9a-f]{12}$/);
    assert.match(b, /^APL-[0-9a-f]{12}$/);
    assert.notEqual(a, b);
  });
});

describe('payment matching (address + CIP-20 memo + amount)', () => {
  function tx({ hash = 'aabb', address = TESTNET_ADDR, value = '5000000', metadata = null } = {}) {
    return {
      tx_hash: hash,
      metadata,
      outputs: [
        {
          payment_addr: { bech32: address },
          value: String(value),
        },
      ],
    };
  }

  const req = { address: TESTNET_ADDR, amountLovelace: 5_000_000n, memo: 'INV-42' };

  it('marks a payment paid when the address received at least the amount and the memo matches', () => {
    const result = matchPayment(
      tx({ metadata: { '674': { msg: ['INV-42'] } } }),
      req
    );
    assert.equal(result.paid, true);
    assert.equal(result.memoMatched, true);
    assert.equal(result.amountMatched, true);
    assert.equal(result.receivedLovelace, '5000000');
    assert.equal(result.txHash, 'aabb');
  });

  it('matches a memo split across CIP-20 msg lines and numeric label 674', () => {
    const memo = 'A'.repeat(80);
    const lines = splitCip20Msg(memo);
    const result = matchPayment(
      tx({ value: '1000000', metadata: { 674: { msg: lines } } }),
      { address: TESTNET_ADDR, amountLovelace: 1_000_000n, memo }
    );
    assert.equal(result.paid, true);
  });

  it('accepts Blockfrost-style metadata arrays and Koios-style objects', () => {
    const a = extractCip20Messages({ '674': { msg: ['INV-42'] } });
    const b = extractCip20Messages([{ label: 674, json_metadata: { msg: ['INV-42'] } }]);
    const c = extractCip20Messages({ '674': { json: { msg: 'INV-42' } } });
    assert.deepEqual(a, ['INV-42']);
    assert.deepEqual(b, ['INV-42']);
    assert.deepEqual(c, ['INV-42']);
    assert.equal(memoMatches(a, 'INV-42'), true);
    assert.equal(memoMatches(a, 'INV-99'), false);
    assert.equal(memoMatches(['  INV-42  '], 'INV-42'), true);
  });

  it('sums multiple outputs to the merchant and ignores outputs to other addresses', () => {
    const t = {
      tx_hash: 'cc',
      metadata: { '674': { msg: ['INV-42'] } },
      outputs: [
        { payment_addr: { bech32: TESTNET_ADDR }, value: '2000000' },
        { address: TESTNET_ADDR, value: '3000000' },
        { payment_addr: { bech32: TIP_ADDRESS }, value: '999999999' },
      ],
    };
    assert.equal(lovelaceReceivedByAddress(t, TESTNET_ADDR).toString(), '5000000');
    assert.equal(matchPayment(t, req).paid, true);
  });

  it('does not mark paid when the memo is missing or different', () => {
    assert.equal(matchPayment(tx({ metadata: null }), req).paid, false);
    assert.equal(
      matchPayment(tx({ metadata: { '674': { msg: ['OTHER'] } } }), req).paid,
      false
    );
  });

  it('does not mark paid when the amount is short, even with the right memo', () => {
    const result = matchPayment(
      tx({ value: '4999999', metadata: { '674': { msg: ['INV-42'] } } }),
      req
    );
    assert.equal(result.paid, false);
    assert.equal(result.memoMatched, true);
    assert.equal(result.amountMatched, false);
  });

  it('findMatchingPayment returns paid, underpaid, or unpaid in that priority', () => {
    const unpaid = findMatchingPayment([tx({ hash: '1', metadata: null })], req);
    assert.equal(unpaid.status, 'unpaid');
    assert.equal(unpaid.paid, false);

    const under = findMatchingPayment(
      [
        tx({ hash: '1', metadata: null }),
        tx({ hash: '2', value: '1', metadata: { '674': { msg: ['INV-42'] } } }),
      ],
      req
    );
    assert.equal(under.status, 'underpaid');
    assert.equal(under.txHash, '2');
    assert.equal(under.paid, false);

    const paid = findMatchingPayment(
      [
        tx({ hash: '1', value: '1', metadata: { '674': { msg: ['INV-42'] } } }),
        tx({ hash: '9', value: '5000000', metadata: { '674': { msg: ['INV-42'] } } }),
      ],
      req
    );
    // First paid match wins; the underpaid earlier tx must not hide a later paid one
    // wait: first memo match is underpaid (hash 1), then paid (hash 9).
    // We should prefer paid over a earlier underpaid. The loop continues until paid.
    assert.equal(paid.status, 'paid');
    assert.equal(paid.txHash, '9');
  });

  it('treats an open-amount request as paid for at least 1 ADA with the memo', () => {
    const short = findMatchingPayment(
      [tx({ value: '1', metadata: { '674': { msg: ['TIP'] } } })],
      { address: TESTNET_ADDR, amountLovelace: null, memo: 'TIP' }
    );
    assert.equal(short.status, 'underpaid');
    const result = findMatchingPayment(
      [tx({ value: '1000000', metadata: { '674': { msg: ['TIP'] } } })],
      { address: TESTNET_ADDR, amountLovelace: null, memo: 'TIP' }
    );
    assert.equal(result.status, 'paid');
    assert.equal(result.receivedLovelace, '1000000');
  });

  it('matches a long memo as a consecutive run of CIP-20 lines even if the wallet appends another line', () => {
    const memo = 'A'.repeat(80);
    const lines = splitCip20Msg(memo);
    assert.ok(lines.length >= 2);
    assert.equal(
      memoMatches([...lines, 'Sent from Eternl'], memo),
      true
    );
    assert.equal(
      memoMatches(['Sent from Eternl', ...lines], memo),
      true
    );
    assert.equal(memoMatches(['INV-42', 'extra'], 'INV-42-not-this'), false);
  });

  it('ignores a matching memo and amount when the transaction is older than the link created time', () => {
    const result = findMatchingPayment(
      [tx({ hash: 'aa', value: '5000000', metadata: { '674': { msg: ['INV-42'] } } })],
      { address: TESTNET_ADDR, amountLovelace: 5_000_000n, memo: 'INV-42', created: 2_000_000_000 }
    );
    // tx() has no block_time, so it is not treated as too old
    assert.equal(result.status, 'paid');
    const old = {
      tx_hash: 'bb',
      block_time: 1_000,
      metadata: { '674': { msg: ['INV-42'] } },
      outputs: [{ payment_addr: { bech32: TESTNET_ADDR }, value: '5000000' }],
    };
    const skipped = findMatchingPayment(
      [old],
      { address: TESTNET_ADDR, amountLovelace: 5_000_000n, memo: 'INV-42', created: 2_000 }
    );
    assert.equal(skipped.status, 'unpaid');
    assert.equal(matchPayment(old, { address: TESTNET_ADDR, amountLovelace: 5_000_000n, memo: 'INV-42', created: 2_000 }).tooOld, true);
  });

  it('caps labels at 60 characters and does not emit a trailing ?& in pay-page URLs', () => {
    const url = buildPayPageUrl('https://example.com/ada-pay-links?', {
      network: 'preprod',
      address: TESTNET_ADDR,
      amount: '1',
      memo: 'INV-1',
      label: 'x'.repeat(80),
      created: 1700000000,
    });
    assert.equal(url.includes('?&'), false);
    assert.equal(url.startsWith('https://example.com/ada-pay-links?'), true);
    const parsed = parsePayPageUrl(url);
    assert.equal(parsed.label.length, 60);
    assert.equal(parsed.created, 1700000000);
    assert.equal(capLabel('y'.repeat(80)).length, 60);
  });

  it('decodes CIP-19 network byte and payload length, not only the HRP prefix', () => {
    const main = decodePaymentAddress(TIP_ADDRESS);
    assert.equal(main.networkId, 1);
    assert.equal(main.type, 0);
    assert.equal(main.bytes.length, 57);
    const test = decodePaymentAddress(TESTNET_ADDR);
    assert.equal(test.networkId, 0);
    assert.equal(test.bytes.length, 57);
  });

  it('blocks a wallet whose CIP-30 network id or address prefix does not match the link', () => {
    assert.equal(
      walletNetworkMismatch({ walletNetworkId: 0, changeAddress: TESTNET_ADDR, network: 'mainnet' }).includes('testnet'),
      true
    );
    assert.equal(
      walletNetworkMismatch({ walletNetworkId: 1, changeAddress: TIP_ADDRESS, network: 'preprod' }).includes('mainnet'),
      true
    );
    assert.equal(
      walletNetworkMismatch({ walletNetworkId: 1, changeAddress: TIP_ADDRESS, network: 'mainnet' }),
      null
    );
    assert.equal(
      walletNetworkMismatch({ walletNetworkId: 0, changeAddress: TIP_ADDRESS, network: 'preprod' }).includes('addr vs addr_test'),
      true
    );
    assert.equal(MAINNET_WARNING, 'Mainnet: real ADA, unaudited software');
    assert.equal(MAINNET_PAY_CONFIRM, 'This sends real ADA');
  });

  it('appends a short unique suffix to auto and required memos', () => {
    const a = finalizeMemo('INV-42');
    const b = finalizeMemo('INV-42');
    assert.match(a, /^INV-42-[0-9a-f]{6}$/);
    assert.notEqual(a, b);
    const auto = finalizeMemo('');
    assert.match(auto, /^APL-[0-9a-f]{12}-[0-9a-f]{6}$/);
    assert.equal(generateMemoSuffix().length, 6);
  });
});
