const {
  buildAuthCookie,
  getExpectedCreds,
  hasConfiguredCreds,
  safeEqual,
} = require("../_adminAuth.js");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  if (!hasConfiguredCreds()) {
    res.status(503).json({ ok: false, error: "Admin credentials are not configured" });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (_) {
      body = {};
    }
  }

  const user = String(body?.user || "").trim();
  const password = String(body?.password || "");
  const expected = getExpectedCreds();
  if (!safeEqual(user, expected.user) || !safeEqual(password, expected.password)) {
    res.status(401).json({ ok: false, error: "Invalid credentials" });
    return;
  }

  res.setHeader("Set-Cookie", buildAuthCookie());
  res.status(200).json({ ok: true });
};

