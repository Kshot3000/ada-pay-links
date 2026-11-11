# ADA Pay Links checker Worker

Tiny Cloudflare Worker that proxies Koios or Blockfrost and injects an API
token from a Worker secret. Secrets are never committed.

Public Koios omits `Access-Control-Allow-Origin` on actual GET/POST
responses, so a browser cannot read them. This Worker always sets CORS
headers, including on errors. Mesh also fetches `tip` and `epoch_params`
during transaction building; those paths are allowlisted here.

```sh
npx wrangler secret put KOIOS_API_TOKEN
# or: npx wrangler secret put BLOCKFROST_PROJECT_ID
npx wrangler deploy
```

Then set `proxyBase` in `public/checker-config.json` to this Worker's origin.
Do not put tokens in `wrangler.toml` or in the frontend.
