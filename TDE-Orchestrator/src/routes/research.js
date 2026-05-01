const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const tdeClient = require('../services/tde-client');
const cache = require('../cache');
const { jobStore } = require('./jobs');

const router = express.Router();

/**
 * Fire a webhook with HMAC signature.
 */
async function fireWebhook(webhookUrl, payload) {
  try {
    const body = JSON.stringify(payload);
    const signature = crypto
      .createHmac('sha256', config.API_SECRET_KEY || 'unsigned')
      .update(body)
      .digest('hex');

    await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-OppIntelAI-Signature': signature,
      },
      body,
    });
    console.log(`[research] Webhook delivered to ${webhookUrl}`);
  } catch (err) {
    console.error(`[research] Webhook delivery failed: ${err.message}`);
  }
}

/**
 * POST /research — async research ingestion.
 * Returns 202 immediately; processes in background.
 */
router.post('/', async (req, res) => {
  const { collection_id, solution_url, solution_name, depth, webhook_url } = req.body;

  // ── Validate ────────────────────────────────────────
  if (!collection_id) {
    return res.status(400).json({ success: false, error: 'collection_id is required' });
  }
  if (!solution_url) {
    return res.status(400).json({ success: false, error: 'solution_url is required' });
  }

  const jobId = crypto.randomUUID();
  const job = {
    id: jobId,
    type: 'research',
    status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    params: { collection_id, solution_url, solution_name, depth },
    result: null,
    error: null,
  };
  jobStore.set(jobId, job);

  console.log(`[research] Job ${jobId} created for collection ${collection_id}`);

  // Process in background
  setImmediate(async () => {
    job.status = 'processing';
    job.updated_at = new Date().toISOString();

    try {
      const result = await tdeClient.research(
        collection_id,
        solution_url,
        solution_name || ''
      );

      // Invalidate cached entries for this collection
      await cache.invalidateCollection(collection_id);

      job.status = 'completed';
      job.result = result;
      job.updated_at = new Date().toISOString();
      console.log(`[research] Job ${jobId} completed`);

      if (webhook_url) {
        await fireWebhook(webhook_url, {
          event: 'research.completed',
          job_id: jobId,
          collection_id,
          result,
        });
      }
    } catch (err) {
      job.status = 'failed';
      job.error = err.message;
      job.updated_at = new Date().toISOString();
      console.error(`[research] Job ${jobId} failed: ${err.message}`);

      if (webhook_url) {
        await fireWebhook(webhook_url, {
          event: 'research.failed',
          job_id: jobId,
          collection_id,
          error: err.message,
        });
      }
    }
  });

  return res.status(202).json({
    success: true,
    job_id: jobId,
    status: 'pending',
    poll_url: `/jobs/${jobId}`,
  });
});

module.exports = router;
