const { getPublished } = require("../_snapshotStore.js");
const fs = require("node:fs");
const path = require("node:path");

const BOOTSTRAP_FILE_PATH = path.join(process.cwd(), "notion-bootstrap.json");

function tryReadBootstrap() {
  try {
    if (!fs.existsSync(BOOTSTRAP_FILE_PATH)) return null;
    const raw = fs.readFileSync(BOOTSTRAP_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.groups)) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "public, max-age=20, stale-while-revalidate=60");
  try {
    const published = await getPublished();
    if (published?.payload) {
      res.status(200).json({
        ...published.payload,
        source: "published",
        publishedAt: published.publishedAt || null,
      });
      return;
    }

    const bootstrap = tryReadBootstrap();
    if (bootstrap) {
      res.status(200).json({
        ...bootstrap,
        source: "bootstrap",
      });
      return;
    }

    res.status(200).json({
      version: 1,
      source: "empty",
      updatedAt: new Date().toISOString(),
      groups: [],
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || "Unknown error" });
  }
};
