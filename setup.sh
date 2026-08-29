#!/usr/bin/env bash
# One-time setup for the Daily Random subscriber layer on hermes-kelso.
# Run from the repo root:  bash setup.sh
set -euo pipefail

echo "== 1. Create SUBS KV namespace =="
SUBS_ID=$(npx wrangler kv namespace create SUBS | grep -oE 'id = "[^"]+"' | head -1 | sed 's/id = "//;s/"//')
echo "SUBS id: $SUBS_ID"
echo "   -> paste this into wrangler.toml as the id for binding \"SUBS\""

echo
echo "== 2. Turnstile (do this in the Cloudflare dashboard) =="
echo "   - Go to Turnstile -> Create widget for kelso.dotdoing.com"
echo "   - Copy the site key and secret key"
echo "   - Set site key:  npx wrangler secret put TURNSTILE_SITEKEY   (or edit [vars] in wrangler.toml)"
echo "   - Set secret:    npx wrangler secret put TURNSTILE_SECRET"

echo
echo "== 3. Resend (verify dotdoing.com as sending domain) =="
echo "   - Resend dashboard -> Domains -> add dotdoing.com"
echo "   - Add the SPF/DKIM/DMARC DNS records it shows into Cloudflare"
echo "   - Create an API key, then:"
echo "   - Set key:  npx wrangler secret put RESEND_API_KEY"

echo
echo "== 4. Admin / unsubscribe auth =="
echo "   - Generate a token and set it (also used as the unsubscribe HMAC key):"
echo "   - npx wrangler secret put SUBS_TOKEN"

echo
echo "== 5. Deploy =="
echo "   npx wrangler deploy"

echo
echo "== 6. Seed initial subscribers (optional) =="
echo "   Build a JSON array [{email,ts}] of your family/friends and:"
echo "   npx wrangler kv key put --binding=SUBS SUBS_LIST \"$(cat seed.json)\""
