const COOKIE_NAME = "devtrend_admin_session";

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

function parseCookies(cookieHeader) {
  const out = {};
  String(cookieHeader || "")
    .split(";")
    .map((v) => v.trim())
    .filter(Boolean)
    .forEach((part) => {
      const idx = part.indexOf("=");
      if (idx <= 0) return;
      out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
    });
  return out;
}

function expectedSessionValue() {
  const user = String(process.env.ADMIN_USER || "");
  const password = String(process.env.ADMIN_PASSWORD || "");
  if (!user || !password) return "";
  const input = `${user}:${password}`;
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function redirectToLogin(req) {
  const current = new URL(req.url);
  const next = encodeURIComponent(current.pathname + current.search);
  const loginUrl = new URL(`/admin-login.html?next=${next}`, current.origin);
  return Response.redirect(loginUrl, 302);
}

export default function middleware(req) {
  const current = new URL(req.url);
  const pathname = current.pathname;
  const expected = expectedSessionValue();
  if (!expected) {
    return new Response("Admin disabled: set ADMIN_USER and ADMIN_PASSWORD in Vercel env.", {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (pathname === "/admin-login.html") {
    const cookies = parseCookies(req.headers.get("cookie") || "");
    if (safeEqual(cookies[COOKIE_NAME] || "", expected)) {
      return Response.redirect(new URL("/admin.html", current.origin), 302);
    }
    return;
  }

  if (pathname === "/admin.html") {
    const cookies = parseCookies(req.headers.get("cookie") || "");
    if (!safeEqual(cookies[COOKIE_NAME] || "", expected)) {
      return redirectToLogin(req);
    }
    return;
  }
}

export const config = {
  matcher: ["/admin.html", "/admin-login.html"],
};
