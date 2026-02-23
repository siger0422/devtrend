const { getPayload } = require("../_notion.js");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "public, max-age=20, stale-while-revalidate=60");
  try {
    const preview = String(req.query.preview || "") === "1";
    const force = String(req.query.refresh || "") === "1";
    const payload = await getPayload({ preview, force });
    res.status(200).json(payload);
  } catch (error) {
    if (Array.isArray(error.missing)) {
      res.status(400).json({
        ok: false,
        error: "Missing required environment variables",
        missing: error.missing,
      });
      return;
    }
    res.status(500).json({ ok: false, error: error.message || "Unknown error" });
  }
};
