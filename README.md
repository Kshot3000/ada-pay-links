# ADA Pay Links

**Create pay-with-ADA payment links and QR codes, take a payment from a CIP-30
wallet, and verify it on-chain. Free, open source, zero backend, no custodian,
no team funds.**

**Status: in testing, unaudited.** The default network is Cardano **Preprod**.
Preview is supported. **Mainnet is a supported option** and sends real ADA;
the UI warns `Mainnet: real ADA, unaudited software` and asks `This sends real ADA`
before a mainnet payment. Mainnet is never remembered in localStorage — each
visit opens on the payment link's network, or Preprod. Do not send funds you
cannot afford to lose.

This is a Cardano port of [solana-pay-link-desk](https://github.com/Kshot3000/solana-pay-link-desk).
A hosted $9 setup kit may come later; this repository is the free tool.

## What it does

1. **Create** — a merchant enters their own Cardano receive address, an amount
   in ADA of at least 1 and at most 45 billion (or a USD amount converted
   through a free public price API, clearly labeled as approximate), and a
   memo / invoice id. The desk builds:
   - a shareable **pay-page link** (`?network=…&address=…&amount=…&memo=…&created=…`)
   - a **CIP-13** URI (`web+cardano:<address>?amount=<ADA>`) for compatible wallets
   - a **QR code** of the pay-page link, rendered locally in the browser
   A short random suffix is added to every memo, and a `created` timestamp is
   stored, so an older payment cannot match a new link.
2. **Pay** — the payer opens the link, connects **Lace, Eternl, or another
   CIP-30 wallet** via [Mesh](https://meshjs.dev/), and sends ADA. The memo is
   written as **CIP-20** transaction metadata (label `674`, `msg` array). This
   page never holds keys or funds. Nami is not listed (it was folded into Lace
   and is unmaintained).
3. **Verify** — payment status is looked up through a **Koios or Blockfrost**
   API **via an optional Cloudflare Worker proxy** by receive address + CIP-20
   memo, then checked against the requested ADA amount and the link's creation
   time. A "paid" result includes a transaction explorer link. If the checker
   cannot be reached, the UI says "Couldn't reach the network checker, open in
   Cardanoscan".

Saved links live only in the merchant's browser local storage.

## Networks

| Network | Address prefix | CIP-30 network id | Default checker host |
|---|---|---|---|
| Preprod (default) | `addr_test1…` (network byte 0) | `0` | `https://preprod.koios.rest/api/v1` |
| Preview | `addr_test1…` (network byte 0) | `0` | `https://preview.koios.rest/api/v1` |
| Mainnet | `addr1…` (network byte 1) | `1` | `https://api.koios.rest/api/v1` |

Preprod and Preview both use `addr_test1…` and CIP-30 network id `0`. The
network switch is the source of truth. The pay page always names the testnet
the link expects. When the Worker proxy is configured, the desk also looks up
one of the wallet's UTxO transaction hashes on that network and warns if it is
not found (a Preview wallet paying a Preprod link, or the other way around).
A mainnet wallet is blocked from paying a testnet link, and the other way
around, using both `getNetworkId()` and the address header / `addr` vs
`addr_test` prefix.

## Why the Worker proxy exists

Public Koios answers a CORS **preflight** (`OPTIONS`) with
`Access-Control-Allow-Origin: *`, but the **actual GET and POST responses omit
that header**. A browser therefore cannot read the body — this was confirmed
with Origin `https://kshot3000.github.io` against `https://preprod.koios.rest`.
The optional Worker in `/worker` injects a Koios or Blockfrost API token from a
**secret** (never committed) and always returns CORS headers, including on
errors. Mesh `KoiosProvider` also fetches `tip` and `epoch_params` during
`.complete()`, so when `proxyBase` is set the pay path points Mesh at the same
Worker base.

The `Range` header is ignored by Koios (it returns 1000 rows). Lookups use
`/address_txs?limit=50&order=block_height.desc`, retry on HTTP 429, and stop
once a transaction is older than the link's `created` timestamp.

### Set up the Worker (optional, you bring your own key)

Do not commit API tokens. This project does not sign up for Koios or
Blockfrost for you.

```sh
cd worker
npx wrangler secret put KOIOS_API_TOKEN
# or: npx wrangler secret put BLOCKFROST_PROJECT_ID
# wrangler.toml CHECKER_PROVIDER = "koios" or "blockfrost"
npx wrangler deploy
```

Then put the Worker origin in `public/checker-config.json`:

```json
{
  "provider": "koios",
  "proxyBase": "https://your-worker.workers.dev"
}
```

You can also store the same JSON in `localStorage['ada-pay-links.checker']`.
Without a `proxyBase`, the app does not call public Koios from the browser
and shows the Cardanoscan fallback instead.

## Honest limitations

- **CIP-13 does not carry a memo, a network, or a created time.** Scanning a
  CIP-13 QR / opening `web+cardano:` in a wallet pre-fills the address and
  amount only. Invoice matching needs the pay page. The QR encodes the
  pay-page URL for that reason.
- **USD amounts are approximate.** The rate comes from CoinGecko, with Coinbase
  as a fallback. It is labeled as approximate and is not a quote. The link
  always stores ADA, never USD.
- **"Paid" means:** a successful on-chain transaction sent at least the
  requested ADA to the receive address, carried a CIP-20 memo equal to the
  link's full memo (a consecutive run of `msg` lines, so a wallet-appended
  line does not break a long memo), and is not older than the link's
  `created` timestamp. It does not identify the payer, and it is not a legal
  receipt.
- **No custody, no secrets, no team funds.** There is no server in the static
  app, no seed phrase, and no hardcoded merchant payout wallet. The merchant
  always pastes their own receive address. The footer **Tip / Support the
  dev** is optional mainnet ADA, on by default, and unlocks nothing.
- **In testing.** Wallet combinations and long address histories have not been
  hardened for relying on "paid" for real value.

## Tip / Support the dev

A **Tip** (also labeled **Support the dev**) is shown in the footer and is on
by default, including if this UI is later packaged in an Android build. Tips
are optional mainnet ADA and **unlock nothing** — the tool stays free. This is
not a payout address for payments you collect.

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
`npm run build` locally (a GitHub Actions workflow could not be pushed: the
`gh` token on this box lacks the `workflow` scope).

`npm audit` findings from the Mesh / Vite / node-polyfill tree are Node
install-time issues in development dependencies; they are not API keys or
browser-shipped secrets.

## Tests

```sh
node --test test/*.test.mjs
```

Coverage includes:

- bech32 payment-address checks (CIP-19 network byte and payload length,
  including the tip address on mainnet only)
- ADA amount bounds (1 … 45,000,000,000) and ADA ↔ lovelace conversion
- approximate USD → ADA conversion, rounded to the nearest lovelace
- CIP-13 and pay-page URL build / parse (`created`, memo suffix, no `?&`)
- CIP-20 memo matching over a consecutive run of lines
- ignoring transactions older than the link's `created` time
- checker config (Koios / Blockfrost / Worker proxy) and the Cardanoscan fallback
- Koios listing (`limit=50&order=block_height.desc`) and 429 backoff, with a mocked fetch
- CIP-30 wallet listing (no Nami), network-id / address-prefix guards, testnet probe
- wallet error text (`You cancelled in the wallet`, never `[object Object]`)
- XSS-safe status rendering (tx hashes must be 64 hex characters)
- Worker path allowlisting and CORS / secret injection

Wallet signing against a live network is not in CI; that needs a real testnet wallet.

## Tech

- Vanilla HTML / CSS / JS with Vite. No framework, no tracking, no secrets.
- `src/paylink.js` — address, URI, amount, and matching logic, shared with the
  Node test suite.
- `src/koios.js` / `src/blockfrost.js` / `src/payment.js` — indexer lookups.
- `src/wallet.js` — CIP-30 payments via Mesh, with Mesh pointed at the Worker
  when `proxyBase` is set.
- `worker/` — optional Cloudflare Worker proxy.
- QR rendering: vendored [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)
  (MIT, © Kazuhiko Arase) in `public/vendor/qrcode.js`.

## What's left before treating mainnet as production

- Real-wallet testing on Preprod (and Preview) with Lace and Eternl: connect,
  pay with memo, confirm the status check, and confirm the Preprod/Preview
  mismatch warning.
- Clearer wallet / min-UTxO / fee errors, and polling for confirmation
  instead of a one-shot lookup.
- Koios / Blockfrost rate-limit operations once a Worker is deployed.
- An independent review if anyone will rely on "paid" for real value.
- Native assets / stablecoins are out of scope for this MVP (CIP-13 is ADA-only
  today).
- The $9 setup kit, hosted branding, and a Shopify-friendly flow are not in
  this repository.

## License

MIT. Built by [@kshot9000](https://x.com/kshot9000) (GitHub: [Kshot3000](https://github.com/Kshot3000)).
