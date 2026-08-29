// Requires in wrangler.toml:
// name = "hermes-kelso"
// main = "src/index.js"
// compatibility_date = "2025-01-01"

// [cache]
// enabled = true

// [[kv_namespaces]]
// binding = "PAGES"
// id = "your-namespace-id"

// [[kv_namespaces]]
// binding = "SUBS"
// id = "your-subs-namespace-id"

// [[routes]]
// pattern = "kelso.dotdoing.com/*"
// zone_name = "dotdoing.com"


function randomSlug(len = 9) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let s = "";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  for (const b of bytes) s += chars[b % chars.length];
  return s;
}

function auth(request, env) {
  return request.headers.get("Authorization") === `Bearer ${env.API_TOKEN}`;
}

// ---------- Subscriber layer helpers ----------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function base64url(bytes) {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacSign(message, key) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(key),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return base64url(new Uint8Array(sig));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyTurnstile(token, env) {
  if (!token) return false;
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token }),
  });
  const data = await res.json().catch(() => ({}));
  return data.success === true;
}

async function sendEmail(env, to, subject, html) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: env.FROM_EMAIL, to, subject, html }),
  });
  return res.ok;
}

function htmlPage(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:42rem;margin:8vh auto;padding:0 1rem;color:#111}
.err{color:#b00}.cf-turnstile{margin:1rem 0}input{padding:.6rem;width:100%;max-width:20rem;font:inherit}
button{padding:.6rem 1.2rem;font:inherit;cursor:pointer}a{color:#06c}</style></head>
<body>${body}</body></html>`;
}

function subscribeFormHtml(env, error) {
  const err = error ? `<p class="err">${escapeHtml(error)}</p>` : "";
  const body = `<h1>The Daily Random</h1>
<p>One strange thing every morning, in your inbox.</p>
${err}
<form action="/subscribe" method="post">
  <input type="email" name="email" required placeholder="you@example.com" autocomplete="email">
  <div class="cf-turnstile" data-sitekey="${escapeHtml(env.TURNSTILE_SITEKEY)}"></div>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  <button type="submit">Subscribe</button>
</form>`;
  return htmlPage("Subscribe — The Daily Random", body);
}

// Edge cache: 1 hour (purged on update, so TTL is just a safety net)
// Browser cache: 60 seconds (keeps navigations fast without long staleness)
const PAGE_HEADERS = {
  "content-type": "text/html;charset=UTF-8",
  "Cache-Control": "public, max-age=60, s-maxage=3600",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    // Serve robots.txt
    if (request.method === "GET" && pathname === "/robots.txt") {
      return new Response("User-agent: *\nDisallow: /", {
        headers: {
          "content-type": "text/plain; charset=UTF-8",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    // Homepage: GET / → same as /p/index
    if (request.method === "GET" && (pathname === "/" || pathname === "")) {
      const html = await env.PAGES.get("index");
      if (!html) return new Response("Not found", { status: 404 });
      return new Response(html, {
        headers: { ...PAGE_HEADERS, "Cache-Tag": "page-index" },
      });
    }

    // Serve a page: GET /p/:slug
    if (request.method === "GET" && pathname.startsWith("/p/")) {
      const slug = pathname.slice("/p/".length);
      const html = await env.PAGES.get(slug);
      if (!html) return new Response("Not found", { status: 404 });
      return new Response(html, {
        headers: { ...PAGE_HEADERS, "Cache-Tag": `page-${slug}` },
      });
    }

    // Create: POST /api/publish
    if (request.method === "POST" && pathname === "/api/publish") {
      if (!auth(request, env))
        return new Response("Unauthorized", { status: 401 });
      const html = await request.text();
      const slug = randomSlug();
      await env.PAGES.put(slug, html);
      return Response.json({
        url: `https://kelso.dotdoing.com/p/${slug}`,
        slug,
      });
    }

    // Update: PUT /api/p/:slug
    if (request.method === "PUT" && pathname.startsWith("/api/p/")) {
      if (!auth(request, env))
        return new Response("Unauthorized", { status: 401 });
      const slug = pathname.slice("/api/p/".length);
      const exists = await env.PAGES.get(slug);
      if (!exists) return new Response("Not found", { status: 404 });
      await env.PAGES.put(slug, await request.text());
      // Purge edge cache for this page (and the homepage if slug is "index")
      ctx.waitUntil(ctx.cache.purge({ tags: [`page-${slug}`] }));
      return Response.json({
        ok: true,
        url: `https://kelso.dotdoing.com/p/${slug}`,
      });
    }

    // Delete: DELETE /api/p/:slug
    if (request.method === "DELETE" && pathname.startsWith("/api/p/")) {
      if (!auth(request, env))
        return new Response("Unauthorized", { status: 401 });
      const slug = pathname.slice("/api/p/".length);
      await env.PAGES.delete(slug);
      ctx.waitUntil(ctx.cache.purge({ tags: [`page-${slug}`] }));
      return Response.json({ ok: true });
    }

    // ---------- Subscriber layer (new) ----------

    // Signup form: GET /subscribe
    if (request.method === "GET" && pathname === "/subscribe") {
      return new Response(subscribeFormHtml(env, ""), {
        headers: { "content-type": "text/html;charset=UTF-8" },
      });
    }

    // Subscribe: POST /subscribe
    if (request.method === "POST" && pathname === "/subscribe") {
      const form = await request.formData().catch(() => null);
      const email = ((form && form.get("email")) || "").toString().trim().toLowerCase();
      const token = (form && form.get("cf-turnstile-response")) || "";
      if (!EMAIL_RE.test(email)) {
        return new Response(subscribeFormHtml(env, "Please enter a valid email address."), {
          headers: { "content-type": "text/html;charset=UTF-8" }, status: 400,
        });
      }
      if (!await verifyTurnstile(token, env)) {
        return new Response(subscribeFormHtml(env, "Verification failed. Please try again."), {
          headers: { "content-type": "text/html;charset=UTF-8" }, status: 400,
        });
      }
      const uuid = randomSlug(16);
      await env.SUBS.put(`PENDING:${uuid}`, JSON.stringify({ email, ts: Date.now() }), { expirationTtl: 86400 });
      const confirmUrl = `https://kelso.dotdoing.com/confirm?token=${uuid}`;
      await sendEmail(
        env, email, "Confirm your Daily Random subscription",
        `<p>One strange thing every morning →</p>
<p><a href="${confirmUrl}">Confirm your subscription</a></p>
<p>If you didn't request this, you can ignore this email.</p>`
      );
      return new Response(
        htmlPage("Check your inbox",
          `<h1>Check your inbox</h1><p>We sent a confirmation link to <strong>${escapeHtml(email)}</strong>. Click it to start receiving The Daily Random.</p>`),
        { headers: { "content-type": "text/html;charset=UTF-8" } }
      );
    }

    // Confirm: GET /confirm?token=<uuid>
    if (request.method === "GET" && pathname === "/confirm") {
      const token = url.searchParams.get("token");
      if (!token) return new Response("Missing token", { status: 400 });
      const raw = await env.SUBS.get(`PENDING:${token}`);
      if (!raw) {
        return new Response(
          htmlPage("Link expired",
            `<h1>Link expired</h1><p>This confirmation link is invalid or has expired. Please <a href="/subscribe">subscribe again</a>.</p>`),
          { headers: { "content-type": "text/html;charset=UTF-8" }, status: 404 }
        );
      }
      const { email } = JSON.parse(raw);
      const listRaw = await env.SUBS.get("SUBS_LIST");
      const list = listRaw ? JSON.parse(listRaw) : [];
      if (!list.some((e) => e.email === email)) list.push({ email, ts: Date.now() });
      await env.SUBS.put("SUBS_LIST", JSON.stringify(list));
      await env.SUBS.delete(`PENDING:${token}`);
      return new Response(
        htmlPage("You're in",
          `<h1>You're in</h1><p>Thanks for subscribing to The Daily Random. One strange thing every morning →</p>`),
        { headers: { "content-type": "text/html;charset=UTF-8" } }
      );
    }

    // Unsubscribe: GET /unsubscribe?email=<e>&token=<hmac>
    if (request.method === "GET" && pathname === "/unsubscribe") {
      const email = (url.searchParams.get("email") || "").toString().toLowerCase();
      const token = url.searchParams.get("token") || "";
      if (!email || !token) return new Response("Missing parameters", { status: 400 });
      const expected = await hmacSign(email, env.SUBS_TOKEN);
      if (!timingSafeEqual(expected, token)) {
        return new Response("Invalid token", { status: 403 });
      }
      const listRaw = await env.SUBS.get("SUBS_LIST");
      const list = listRaw ? JSON.parse(listRaw) : [];
      const next = list.filter((e) => e.email !== email);
      await env.SUBS.put("SUBS_LIST", JSON.stringify(next));
      return new Response(
        htmlPage("Unsubscribed",
          `<h1>Unsubscribed</h1><p>${escapeHtml(email)} has been removed from The Daily Random.</p>`),
        { headers: { "content-type": "text/html;charset=UTF-8" } }
      );
    }

    // Admin export: GET /admin/subscribers
    if (request.method === "GET" && pathname === "/admin/subscribers") {
      if (request.headers.get("Authorization") !== `Bearer ${env.SUBS_TOKEN}`) {
        return new Response("Unauthorized", { status: 401 });
      }
      const listRaw = await env.SUBS.get("SUBS_LIST");
      const list = listRaw ? JSON.parse(listRaw) : [];
      return Response.json({ count: list.length, subscribers: list });
    }

    return new Response("Not found", { status: 404 });
  },
};
