const { buildClearCookie } = require("../_adminAuth.js");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  res.setHeader("Set-Cookie", buildClearCookie());
  res.status(200).json({ ok: true });
};

