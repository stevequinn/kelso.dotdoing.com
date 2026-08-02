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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    // Serve a page: GET /p/:slug
    if (request.method === "GET" && pathname.startsWith("/p/")) {
      const slug = pathname.slice("/p/".length);
      const html = await env.PAGES.get(slug);
      if (!html) return new Response("Not found", { status: 404 });
      return new Response(html, { headers: { "content-type": "text/html;charset=UTF-8" } });
    }

    // Create: POST /api/publish
    if (request.method === "POST" && pathname === "/api/publish") {
      if (!auth(request, env)) return new Response("Unauthorized", { status: 401 });
      const html = await request.text();
      const slug = randomSlug();
      await env.PAGES.put(slug, html);
      return Response.json({ url: `https://kelso.dotdoing.com/p/${slug}`, slug });
    }

    // Update: PUT /api/p/:slug
    if (request.method === "PUT" && pathname.startsWith("/api/p/")) {
      if (!auth(request, env)) return new Response("Unauthorized", { status: 401 });
      const slug = pathname.slice("/api/p/".length);
      const exists = await env.PAGES.get(slug);
      if (!exists) return new Response("Not found", { status: 404 });
      await env.PAGES.put(slug, await request.text());
      return Response.json({ ok: true, url: `https://kelso.dotdoing.com/p/${slug}` });
    }

    // Delete: DELETE /api/p/:slug
    if (request.method === "DELETE" && pathname.startsWith("/api/p/")) {
      if (!auth(request, env)) return new Response("Unauthorized", { status: 401 });
      const slug = pathname.slice("/api/p/".length);
      await env.PAGES.delete(slug);
      return Response.json({ ok: true });
    }

    return new Response("Not found", { status: 404 });
  },
};
