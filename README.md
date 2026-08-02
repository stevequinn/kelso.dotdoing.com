# hermes-kelso

Publish HTML pages to `kelso.dotdoing.com/p/<slug>` with random unique links. Built on Cloudflare Workers + KV.

## Setup

```bash
mkdir hermes-kelso && cd hermes-kelso
mkdir src
npm install --save-dev wrangler
# add package.json, wrangler.toml, src/index.js
```

```bash
npx wrangler login
npx wrangler kv namespace create PAGES
# copy the returned id into wrangler.toml

openssl rand -hex 32 | npx wrangler secret put API_TOKEN
# save this token somewhere safe — it won't be shown again

npx wrangler deploy
```

DNS: add a proxied CNAME `kelso` → `dotdoing.com` in the Cloudflare dashboard.

## Usage

**Publish**
```bash
curl -X POST https://kelso.dotdoing.com/api/publish \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: text/html" \
  --data-binary @page.html
# → {"url": "https://kelso.dotdoing.com/p/aB3kQ9zT", "slug": "aB3kQ9zT"}
```

**Update**
```bash
curl -X PUT https://kelso.dotdoing.com/api/p/<slug> \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: text/html" \
  --data-binary @updated_page.html
```

**Delete**
```bash
curl -X DELETE https://kelso.dotdoing.com/api/p/<slug> \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Notes

- Slugs are random 9-character strings; collisions are effectively impossible.
- Content is stored in Cloudflare KV, keyed by slug.
- `API_TOKEN` gates all writes (`/api/*`); `GET /p/*` is public.
- Redeploy (`npx wrangler deploy`) only when editing `src/index.js`. Publishing content never requires a redeploy.
