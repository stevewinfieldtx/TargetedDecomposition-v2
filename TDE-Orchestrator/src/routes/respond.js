const express = require('express');
const tdeClient = require('../services/tde-client');

const router = express.Router();

/**
 * POST /respond — fast-path agent response.
 * No TrueArtifact. No caching. Always real-time.
 */
router.post('/', async (req, res) => {
  const start = Date.now();
  const { collection_id, question, audience, context = {} } = req.body;

  // ── Validate ────────────────────────────────────────
  if (!collection_id) {
    return res.status(400).json({ success: false, error: 'collection_id is required' });
  }
  if (!question) {
    return res.status(400).json({ success: false, error: 'question is required' });
  }

  try {
    const result = await tdeClient.reconstruct(collection_id, {
      question,
      audience: audience || undefined,
      intent: 'agent_response',
      format: 'text',
      max_words: 150,
      conversation_history: context.conversation_history || undefined,
      context,
    });

    const elapsed = Date.now() - start;
    console.log(`[respond] Answered in ${elapsed}ms for collection ${collection_id}`);

    return res.json({
      success: true,
      response: result.response || result.content || result,
      atoms_used: result.atoms_used || result.sources?.length || 0,
      confidence: result.confidence || null,
      elapsed_ms: elapsed,
    });
  } catch (err) {
    console.error(`[respond] Error: ${err.message}`);
    const status = err.status || 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});

module.exports = router;
