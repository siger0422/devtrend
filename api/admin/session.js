const { getExpectedCreds, hasConfiguredCreds, isAuthedByCookie } = require("../_adminAuth.js");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!hasConfiguredCreds()) {
    res.status(503).json({ ok: false, authenticated: false, error: "Admin credentials are not configured" });
    return;
  }

  const authed = isAuthedByCookie(req.headers.cookie || "");
  if (!authed) {
    res.status(401).json({ ok: false, authenticated: false });
    return;
  }

  res.status(200).json({ ok: true, authenticated: true, user: getExpectedCreds().user });
};

