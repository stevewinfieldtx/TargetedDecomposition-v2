const express = require('express');
const tdeClient = require('../services/tde-client');

const router = express.Router();

/**
 * GET /collections — list all collections.
 */
router.get('/', async (req, res) => {
  try {
    const data = await tdeClient.getCollections();
    return res.json({ success: true, collections: data.collections || data });
  } catch (err) {
    console.error(`[collections] List error: ${err.message}`);
    const status = err.status || 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});

/**
 * GET /collections/:id — get a single collection.
 */
router.get('/:id', async (req, res) => {
  try {
    const data = await tdeClient.getCollection(req.params.id);
    return res.json({ success: true, collection: data.collection || data });
  } catch (err) {
    console.error(`[collections] Get ${req.params.id} error: ${err.message}`);
    const status = err.status || 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});

/**
 * GET /collections/:id/health — collection health report.
 */
router.get('/:id/health', async (req, res) => {
  try {
    const stats = await tdeClient.getStats(req.params.id);

    const issues = [];
    const atomCount = stats.atom_count || stats.total_atoms || 0;
    const lastUpdated = stats.last_updated || stats.updated_at || null;

    if (atomCount === 0) {
      issues.push('Collection has no atoms — research ingestion may be needed');
    }
    if (atomCount > 0 && atomCount < 10) {
      issues.push('Low atom count — artifact quality may be limited');
    }
    if (lastUpdated) {
      const ageMs = Date.now() - new Date(lastUpdated).getTime();
      const ageDays = ageMs / (1000 * 3600 * 24);
      if (ageDays > 30) {
        issues.push(`Collection data is ${Math.round(ageDays)} days old — consider re-research`);
      }
    }

    const status = issues.length === 0 ? 'healthy' : issues.some((i) => i.includes('no atoms')) ? 'critical' : 'warning';

    return res.json({
      success: true,
      health: {
        collection_id: req.params.id,
        status,
        atom_count: atomCount,
        last_updated: lastUpdated,
        issues,
        stats,
      },
    });
  } catch (err) {
    console.error(`[collections] Health ${req.params.id} error: ${err.message}`);
    const status = err.status || 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});

module.exports = router;
