const express = require('express');
const router = express.Router();

/**
 * In-memory job store shared across route modules.
 * Job states: pending | processing | completed | failed
 *
 * Shape: {
 *   id, type, status, created_at, updated_at,
 *   params, result, error
 * }
 */
const jobStore = new Map();

/**
 * GET /jobs/:jobId — retrieve job status and result.
 */
router.get('/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobStore.get(jobId);

  if (!job) {
    return res.status(404).json({ success: false, error: 'Job not found' });
  }

  res.json({ success: true, job });
});

module.exports = router;
module.exports.jobStore = jobStore;
