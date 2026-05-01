const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const tdeClient = require('../services/tde-client');
const trueartifactClient = require('../services/trueartifact-client');
const cache = require('../cache');
const { jobStore } = require('./jobs');

const router = express.Router();

/**
 * Build a deterministic cache key from craft parameters.
 */
function buildCacheKey(params) {
  const payload = JSON.stringify({
    collection_id: params.collection_id,
    format: params.format,
    audience: params.audience,
    context: params.context || {},
  });
  const hash = crypto.createHash('sha256').update(payload).digest('hex');
  return `craft:${params.format}:${hash}`;
}

/**
 * Deduplicate atoms by id.
 */
function deduplicateAtoms(atoms) {
  const seen = new Set();
  return atoms.filter((a) => {
    const id = a.id || a.atom_id || JSON.stringify(a);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

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
    console.log(`[craft] Webhook delivered to ${webhookUrl}`);
  } catch (err) {
    console.error(`[craft] Webhook delivery failed: ${err.message}`);
  }
}

/**
 * Core processing: search for atoms, deduplicate, render via TrueArtifact.
 */
async function processCraft(params) {
  const { collection_id, format, audience, context = {} } = params;
  const solutionName = context.solution_name || '';

  // Run multiple queries for diverse atoms
  const queries = [
    `${format} content for ${audience}`,
    `key value propositions for ${solutionName || 'solution'}`,
    `${context.industry || 'industry'} ${context.deal_stage || ''} relevant points`,
  ];

  const searchResults = await Promise.all(
    queries.map((q) => tdeClient.search(collection_id, q, 10).catch(() => ({ atoms: [] })))
  );

  let allAtoms = searchResults.flatMap((r) => r.atoms || r.results || []);
  allAtoms = deduplicateAtoms(allAtoms);

  console.log(`[craft] Collected ${allAtoms.length} unique atoms for ${format}`);

  // Render via TrueArtifact
  const rendered = await trueartifactClient.render(format, allAtoms, audience, solutionName, context);

  return {
    format,
    content: rendered.content || rendered,
    metadata: {
      atoms_used: allAtoms.length,
      rendered_at: new Date().toISOString(),
      ...(rendered.metadata || {}),
    },
  };
}

/**
 * POST /craft — main artifact creation endpoint.
 */
router.post('/', async (req, res) => {
  const start = Date.now();
  const { collection_id, format, audience, context, options = {} } = req.body;

  // ── Validate ────────────────────────────────────────
  if (!collection_id) {
    return res.status(400).json({ success: false, error: 'collection_id is required' });
  }
  if (!format) {
    return res.status(400).json({ success: false, error: 'format is required' });
  }
  if (!audience) {
    return res.status(400).json({ success: false, error: 'audience is required' });
  }
  if (!config.SUPPORTED_FORMATS.includes(format)) {
    return res.status(400).json({
      success: false,
      error: `Unsupported format "${format}". Supported: ${config.SUPPORTED_FORMATS.join(', ')}`,
    });
  }

  const params = { collection_id, format, audience, context };

  // ── Check cache ─────────────────────────────────────
  const cacheKey = buildCacheKey(params);
  try {
    const cached = await cache.get(cacheKey);
    if (cached) {
      console.log(`[craft] Cache HIT for ${cacheKey}`);
      return res.json({ success: true, artifact: cached, cache_key: cacheKey, cached: true });
    }
  } catch (err) {
    console.error('[craft] Cache lookup error:', err.message);
  }

  // ── Async path (deck, etc.) ─────────────────────────
  if (config.ASYNC_FORMATS.includes(format)) {
    const jobId = crypto.randomUUID();
    const job = {
      id: jobId,
      type: 'craft',
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      params,
      result: null,
      error: null,
    };
    jobStore.set(jobId, job);

    console.log(`[craft] Async job ${jobId} created for ${format}`);

    // Process in background
    setImmediate(async () => {
      job.status = 'processing';
      job.updated_at = new Date().toISOString();
      try {
        const artifact = await processCraft(params);
        const ttl = config.CACHE_TTL[format] || 0;
        await cache.set(cacheKey, artifact, ttl, collection_id);

        job.status = 'completed';
        job.result = { artifact, cache_key: cacheKey };
        job.updated_at = new Date().toISOString();
        console.log(`[craft] Job ${jobId} completed`);

        if (options.webhook_url) {
          await fireWebhook(options.webhook_url, {
            event: 'craft.completed',
            job_id: jobId,
            artifact,
            cache_key: cacheKey,
          });
        }
      } catch (err) {
        job.status = 'failed';
        job.error = err.message;
        job.updated_at = new Date().toISOString();
        console.error(`[craft] Job ${jobId} failed: ${err.message}`);

        if (options.webhook_url) {
          await fireWebhook(options.webhook_url, {
            event: 'craft.failed',
            job_id: jobId,
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
  }

  // ── Synchronous path ────────────────────────────────
  try {
    const artifact = await processCraft(params);
    const ttl = config.CACHE_TTL[format] || 0;
    await cache.set(cacheKey, artifact, ttl, collection_id);

    const elapsed = Date.now() - start;
    console.log(`[craft] Synchronous ${format} completed in ${elapsed}ms`);

    return res.json({
      success: true,
      artifact,
      cache_key: cacheKey,
      cached: false,
      elapsed_ms: elapsed,
    });
  } catch (err) {
    console.error(`[craft] Processing error: ${err.message}`);
    const status = err.status || 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});

module.exports = router;
