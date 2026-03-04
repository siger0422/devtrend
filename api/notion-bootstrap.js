const { getPublished } = require('./_snapshotStore');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
  try {
    const published = await getPublished();
    if (published?.payload) {
      res.status(200).json(published.payload);
      return;
    }

    res.status(200).json({
      version: 1,
      updatedAt: new Date().toISOString(),
      source: 'empty',
      groups: [],
    });
  } catch (error) {
    res.status(500).json({
      version: 1,
      updatedAt: new Date().toISOString(),
      source: 'bootstrap-error',
      error: error.message || 'Unknown error',
      groups: [],
    });
  }
};
