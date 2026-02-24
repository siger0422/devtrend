const { getDraft, getPublished } = require('../_snapshotStore.js');
const { hasConfiguredCreds, isAuthedByCookie } = require('../_adminAuth.js');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!hasConfiguredCreds() || !isAuthedByCookie(req.headers.cookie || '')) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }

  try {
    const draft = await getDraft();
    if (draft?.payload) {
      res.status(200).json({ ok: true, source: 'draft', syncedAt: draft.syncedAt || null, ...draft.payload });
      return;
    }
    const published = await getPublished();
    if (published?.payload) {
      res.status(200).json({ ok: true, source: 'published', publishedAt: published.publishedAt || null, ...published.payload });
      return;
    }
    res.status(200).json({ ok: true, source: 'empty', version: 1, updatedAt: new Date().toISOString(), groups: [] });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || 'Unknown error' });
  }
};
