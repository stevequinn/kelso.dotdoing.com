// Requires in wrangler.toml:
// name = "hermes-kelso"
// main = "src/index.js"
// compatibility_date = "2025-01-01"

// [cache]
// enabled = true

// [[kv_namespaces]]
// binding = "PAGES"
// id = "your-namespace-id"

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

    return new Response("Not found", { status: 404 });
  },
};
