function unauthorized() {
  return new Response("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Devtrend Admin", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}

function safeEqual(a, b) {
  const aa = String(a || "");
  const bb = String(b || "");
  if (aa.length !== bb.length) return false;
  let out = 0;
  for (let i = 0; i < aa.length; i += 1) {
    out |= aa.charCodeAt(i) ^ bb.charCodeAt(i);
  }
  return out === 0;
}

export default function middleware(req) {
  const expectedUser = process.env.ADMIN_USER || "admin";
  const expectedPassword = process.env.ADMIN_PASSWORD || "";

  // If password env is not configured, keep admin blocked in production.
  if (!expectedPassword) {
    return new Response("Admin disabled: set ADMIN_PASSWORD in Vercel env.", {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const auth = req.headers.get("authorization");
  if (!auth || !auth.startsWith("Basic ")) {
    return unauthorized();
  }

  try {
    const encoded = auth.slice(6);
    const decoded = atob(encoded);
    const idx = decoded.indexOf(":");
    const user = idx >= 0 ? decoded.slice(0, idx) : "";
    const password = idx >= 0 ? decoded.slice(idx + 1) : "";

    if (!safeEqual(user, expectedUser) || !safeEqual(password, expectedPassword)) {
      return unauthorized();
    }
    return;
  } catch (_) {
    return unauthorized();
  }
}

export const config = {
  matcher: ["/admin.html", "/admin.js", "/admin.css"],
};

