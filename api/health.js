module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    ok: true,
    service: "vercel-notion-inblog-api",
    now: new Date().toISOString(),
  });
};
