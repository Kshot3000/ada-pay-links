# ADA Pay Links checker Worker

Tiny Cloudflare Worker that proxies Koios or Blockfrost and injects an API
token from a Worker secret. Secrets are never committed.

Public Koios omits `Access-Control-Allow-Origin` on actual GET/POST
responses, so a browser cannot read them. This Worker sets CORS headers only
for allowlisted origins (default `https://kshot3000.github.io`, plus
`http://localhost` and `http://127.0.0.1` on any port for local dev). Requests
from any other `Origin`, or with no `Origin`, receive 403 and are not
proxied, so another site cannot burn the upstream API quota. Override the
list with the `ALLOWED_ORIGINS` Worker var (comma-separated).

Transaction submit paths (`/submittx`, `/tx/submit`) are not allowlisted.
Wallets submit signed transactions themselves. Mesh also fetches `tip` and
`epoch_params` during transaction building; those lookup paths stay allowlisted.

```sh
npx wrangler secret put KOIOS_API_TOKEN
# or: npx wrangler secret put BLOCKFROST_PROJECT_ID
npx wrangler deploy
```

Then set `proxyBase` in `public/checker-config.json` to this Worker's origin.
Do not put tokens in `wrangler.toml` or in the frontend.
