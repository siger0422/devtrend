const { publishDraft } = require('../_snapshotStore.js');
const { hasConfiguredCreds, isAuthedByCookie } = require('../_adminAuth.js');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }
  if (!hasConfiguredCreds() || !isAuthedByCookie(req.headers.cookie || '')) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }

  try {
    const published = await publishDraft();
    const groups = Array.isArray(published.payload?.groups) ? published.payload.groups.length : 0;
    const items = (published.payload?.groups || []).reduce((sum, g) => sum + (g.items || []).length, 0);
    res.status(200).json({
      ok: true,
      publishedAt: published.publishedAt,
      draftSyncedAt: published.syncedAt || null,
      groups,
      items,
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || 'Publish failed' });
  }
};
