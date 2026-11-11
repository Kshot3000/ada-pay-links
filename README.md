# ADA Pay Links

**Create pay-with-ADA payment links and QR codes, take a payment from a CIP-30
wallet, and verify it on-chain. Free, open source, zero backend, no custodian.**

**Status: testnet first, in testing, unaudited.** The default network is Cardano
**Preprod**. Preview is also supported. Mainnet is in the network switch so the
code path exists, but this project is not ready for production mainnet use.
Do not treat a "paid" result on mainnet as the last word, and do not send
funds you cannot afford to lose.

This is a Cardano port of [solana-pay-link-desk](https://github.com/Kshot3000/solana-pay-link-desk).
A hosted $9 setup kit may come later; this repository is the free tool.

## What it does

1. **Create** — a merchant enters their own Cardano receive address, an amount
   in ADA (or a USD amount converted through a free public price API, clearly
   labeled as approximate), and a memo / invoice id. The desk builds:
   - a shareable **pay-page link** (`index.html?network=…&address=…&amount=…&memo=…`)
   - a **CIP-13** URI (`web+cardano:<address>?amount=<ADA>`) for compatible wallets
   - a **QR code** of the pay-page link, rendered locally in the browser
2. **Pay** — the payer opens the link, connects **Lace, Eternl, or Nami**
   (CIP-30) via [Mesh](https://meshjs.dev/), and sends ADA. The memo is written
   as **CIP-20** transaction metadata (label `674`, `msg` array). This page
   never holds keys or funds.
3. **Verify** — payment status is looked up through public **Koios** (no API
   key) by receive address + CIP-20 memo, then checked against the requested
   ADA amount. A "paid" result includes a transaction explorer link.

Saved links live only in the merchant's browser local storage.

## Networks

| Network | Address prefix | Koios (keyless) | Explorer |
|---|---|---|---|
| Preprod (default) | `addr_test1…` | `https://preprod.koios.rest/api/v1` | Cardanoscan Preprod |
| Preview | `addr_test1…` | `https://preview.koios.rest/api/v1` | Cardanoscan Preview |
| Mainnet (not ready) | `addr1…` | `https://api.koios.rest/api/v1` | Cardanoscan |

Preprod and Preview both use `addr_test1…` addresses, and CIP-30 wallets report
both as network id `0`. The network switch is therefore the source of truth —
the payer must set their wallet to the same network as the link. A mainnet
address is rejected on a testnet, and the other way around.

## Honest limitations

- **CIP-13 does not carry a memo or a network.** Scanning a CIP-13 QR / opening
  `web+cardano:` in a wallet pre-fills the address and amount only. Invoice
  matching needs the pay page (or a manually attached CIP-20 memo). The QR
  encodes the pay-page URL for that reason.
- **USD amounts are approximate.** The rate comes from CoinGecko, with Coinbase
  as a fallback. It is labeled as approximate and is not a quote. The link
  always stores ADA, never USD.
- **Koios is a public indexer.** Lookups cover recent transactions at the
  address (the first page of history). There is no backend to watch the chain
  forever, and public rate limits apply.
- **"Paid" means:** a successful on-chain transaction sent at least the
  requested ADA to the receive address and carried a CIP-20 memo equal to the
  link's memo. It does not identify the payer, and it is not a legal receipt.
- **No custody, no secrets.** There is no server, no seed phrase, no Blockfrost
  key, and no hardcoded merchant payout wallet. The merchant always pastes
  their own receive address.
- **In testing.** Wallet combinations, fee / min-UTxO edge cases, and long
  address histories have not been hardened for mainnet merchants.

## Tip / Support the dev

A **Tip** (also labeled **Support the dev**) is shown in the footer and is on
by default, including if this UI is later packaged in an Android build. Tips
are optional mainnet ADA and **unlock nothing** — the tool stays free. This is
not labeled "Donate", and it is not a payout address for payments you collect.

```
addr1q8hnl6vl5a6k3rw3n5g3jtte696zcl76kfatzv7gpswa9r0dj7fma6klq55y4ffm7tf0em09udnyhuk4ah92pl5x9jpqjae44v
```

## Run locally

```sh
npm install
npm test
npm run dev
```

The dev server is Vite. There is no backend to start.

```sh
npm run build
npm run preview
```

`npm run build` writes a static site to `dist/`, which can be deployed to
GitHub Pages (Settings → Pages, from the `dist/` output). Enable Pages only
after this pull request is reviewed and merged. Run `npm test` and
`npm run build` locally (or in Actions, once a token with the `workflow`
scope can add a CI file).

## Tests

```sh
node --test test/paylink.test.mjs
```

Coverage is the pure logic in `src/paylink.js`:

- bech32 payment-address checks (including the tip address on mainnet only)
- ADA ↔ lovelace conversion and rejection of unrepresentable amounts
- approximate USD → ADA conversion, rounded to the nearest lovelace
- CIP-13 URI build / parse, including rejection of stake URIs and duplicate amounts
- pay-page URL build / parse and network / address mismatch rejection
- CIP-20 memo splitting (64-byte lines) and payment matching against Koios-shaped
  transaction records (paid / underpaid / unpaid, including split memos)

Wallet signing, Koios, and price HTTP calls are not mocked end-to-end in CI;
those need a real testnet wallet.

## Tech

- Vanilla HTML / CSS / JS with Vite. No framework, no tracking, no secrets.
- `src/paylink.js` — address, URI, amount, and matching logic, shared with the
  Node test suite.
- `src/koios.js` — keyless public indexer lookups.
- `src/wallet.js` — CIP-30 payments via Mesh and Koios (no API key).
- QR rendering: vendored [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)
  (MIT, © Kazuhiko Arase) in `public/vendor/qrcode.js`.

## What's left before a mainnet launch

- Real-wallet testing on Preprod (and Preview) with Lace, Eternl, and Nami:
  connect, pay with memo, and confirm the status check finds the transaction.
- Handle wallet / min-UTxO / fee errors more clearly, and poll for confirmation
  instead of a one-shot lookup.
- Decide whether mainnet stays opt-in behind a stronger warning once testers
  have used the testnets.
- Watch Koios rate limits and have a documented fallback indexer if the public
  host is down (still keyless, still no backend if possible).
- An independent review or audit if anyone will rely on "paid" for real value.
- Native assets / stablecoins are out of scope for this MVP (CIP-13 is ADA-only
  today).
- The $9 setup kit, hosted branding, and a Shopify-friendly flow are not in
  this repository.

## License

MIT. Built by [@kshot9000](https://x.com/kshot9000) (GitHub: [Kshot3000](https://github.com/Kshot3000)).
