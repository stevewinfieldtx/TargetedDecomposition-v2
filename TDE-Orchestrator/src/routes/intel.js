const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const tdeClient = require('../services/tde-client');
const cache = require('../cache');

const router = express.Router();

/**
 * POST /intel — structured intelligence extraction.
 * Calls TDE reconstruct with intent and format:'json'. Caches result.
 */
router.post('/', async (req, res) => {
  const start = Date.now();
  const { collection_id, query, audience, intent, format, max_atoms } = req.body;

  // ── Validate ────────────────────────────────────────
  if (!collection_id) {
    return res.status(400).json({ success: false, error: 'collection_id is required' });
  }
  if (!query) {
    return res.status(400).json({ success: false, error: 'query is required' });
  }
  if (intent && !config.SUPPORTED_INTENTS.includes(intent)) {
    return res.status(400).json({
      success: false,
      error: `Unsupported intent "${intent}". Supported: ${config.SUPPORTED_INTENTS.join(', ')}`,
    });
  }

  // ── Check cache ─────────────────────────────────────
  const cachePayload = JSON.stringify({ collection_id, query, audience, intent, format, max_atoms });
  const cacheKey = `intel:${crypto.createHash('sha256').update(cachePayload).digest('hex')}`;

  try {
    const cached = await cache.get(cacheKey);
    if (cached) {
      console.log(`[intel] Cache HIT for ${cacheKey}`);
      return res.json({ success: true, intelligence: cached.intelligence, atoms_used: cached.atoms_used, confidence: cached.confidence, cached: true });
    }
  } catch (err) {
    console.error('[intel] Cache lookup error:', err.message);
  }

  // ── Call TDE ────────────────────────────────────────
  try {
    const result = await tdeClient.reconstruct(collection_id, {
      query,
      audience: audience || undefined,
      intent: intent || 'enrichment',
      format: 'json',
      max_atoms: max_atoms || undefined,
    });

    const payload = {
      intelligence: result.response || result.content || result,
      atoms_used: result.atoms_used || result.sources?.length || 0,
      confidence: result.confidence || null,
    };

    const ttl = config.CACHE_TTL.intel || 0;
    await cache.set(cacheKey, payload, ttl, collection_id);

    const elapsed = Date.now() - start;
    console.log(`[intel] Completed in ${elapsed}ms for collection ${collection_id}`);

    return res.json({
      success: true,
      ...payload,
      cached: false,
      elapsed_ms: elapsed,
    });
  } catch (err) {
    console.error(`[intel] Error: ${err.message}`);
    const status = err.status || 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});

module.exports = router;
