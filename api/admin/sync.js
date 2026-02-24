const { getPayload } = require('../_notion.js');
const { setDraft } = require('../_snapshotStore.js');
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
    const payload = await getPayload({ preview: false, force: true });
    const draft = await setDraft(payload);
    const groups = Array.isArray(payload.groups) ? payload.groups.length : 0;
    const items = (payload.groups || []).reduce((sum, g) => sum + (g.items || []).length, 0);
    res.status(200).json({ ok: true, draftSyncedAt: draft.syncedAt, groups, items, payload: draft.payload });
  } catch (error) {
    if (Array.isArray(error.missing)) {
      res.status(400).json({ ok: false, error: 'Missing required environment variables', missing: error.missing });
      return;
    }
    res.status(500).json({ ok: false, error: error.message || 'Unknown error' });
  }
};
