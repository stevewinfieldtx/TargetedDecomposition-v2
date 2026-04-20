/**
 * TDE — Anthropic Batch API wrapper
 * ═══════════════════════════════════════════════════════════════════
 * Submit non-realtime LLM work to Anthropic's Message Batches endpoint
 * for a 50% discount vs. real-time pricing. Trade-off is up to 24h
 * turnaround (usually much faster — minutes for small batches).
 *
 * Use for: Deep Fill research, scheduled re-ingestion, overnight refreshes.
 * Do NOT use for: user-facing reconstruct(), ask(), interactive flows.
 *
 * If ANTHROPIC_API_KEY is not set, batchAvailable() returns false and
 * callers should fall back to their existing OpenRouter real-time path.
 */

const config = require('../config');

const POLL_INTERVAL_MS = 30 * 1000;          // poll every 30s
const MAX_WAIT_MS      = 24 * 60 * 60 * 1000; // 24h hard ceiling
const MAX_BATCH_SIZE   = 10000;              // Anthropic limit per batch

function batchAvailable() {
  return !!config.ANTHROPIC_API_KEY;
}

function anthropicHeaders() {
  return {
    'x-api-key':         config.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
    'content-type':      'application/json',
  };
}

/**
 * Submit a batch of requests and wait for all to complete.
 *
 * @param {Array<{
 *   custom_id: string,
 *   prompt: string,
 *   system?: string,
 *   model?: string,
 *   maxTokens?: number,
 *   temperature?: number,
 * }>} requests
 * @param {Object} [opts]
 * @param {number} [opts.pollIntervalMs] override polling frequency
 * @param {number} [opts.maxWaitMs] override hard-ceiling wait time
 * @returns {Promise<Map<string, {text: string, stop_reason: string} | {error: string}>>}
 *          Map keyed by custom_id. Each entry is either {text, stop_reason} on success
 *          or {error} on failure. Callers should inspect per-request.
 */
async function submitBatch(requests, opts = {}) {
  if (!batchAvailable()) {
    throw new Error('ANTHROPIC_API_KEY not configured — cannot use batch API');
  }
  if (!Array.isArray(requests) || requests.length === 0) {
    return new Map();
  }
  if (requests.length > MAX_BATCH_SIZE) {
    throw new Error(`Batch size ${requests.length} exceeds Anthropic limit of ${MAX_BATCH_SIZE}`);
  }

  const pollInterval = opts.pollIntervalMs || POLL_INTERVAL_MS;
  const maxWait      = opts.maxWaitMs      || MAX_WAIT_MS;
  const defaultModel = config.ANTHROPIC_BATCH_MODEL || 'claude-sonnet-4-6';

  // Build Anthropic-shaped batch entries
  const batchRequests = requests.map(r => {
    const params = {
      model:       r.model || defaultModel,
      max_tokens:  r.maxTokens || 4000,
      temperature: typeof r.temperature === 'number' ? r.temperature : 0.3,
      messages:    [{ role: 'user', content: r.prompt }],
    };
    if (r.system) params.system = r.system;
    return { custom_id: r.custom_id, params };
  });

  console.log(`  [Anthropic Batch] Submitting ${batchRequests.length} requests (model: ${defaultModel})...`);

  // ── Submit ──────────────────────────────────────────────────────
  const submitResp = await fetch(`${config.ANTHROPIC_BASE_URL}/v1/messages/batches`, {
    method:  'POST',
    headers: anthropicHeaders(),
    body:    JSON.stringify({ requests: batchRequests }),
  });

  if (!submitResp.ok) {
    const errText = await submitResp.text();
    throw new Error(`Batch submit failed (${submitResp.status}): ${errText.substring(0, 400)}`);
  }

  const batch = await submitResp.json();
  const batchId = batch.id;
  console.log(`  [Anthropic Batch] Submitted: ${batchId} (status: ${batch.processing_status})`);

  // ── Poll ────────────────────────────────────────────────────────
  const start = Date.now();
  let lastCountsLog = '';

  while (Date.now() - start < maxWait) {
    await sleep(pollInterval);

    let status;
    try {
      const statusResp = await fetch(`${config.ANTHROPIC_BASE_URL}/v1/messages/batches/${batchId}`, {
        method:  'GET',
        headers: anthropicHeaders(),
      });
      if (!statusResp.ok) {
        console.log(`  [Anthropic Batch] Poll error ${statusResp.status}, retrying next interval`);
        continue;
      }
      status = await statusResp.json();
    } catch (err) {
      console.log(`  [Anthropic Batch] Poll exception: ${err.message}, retrying`);
      continue;
    }

    const c = status.request_counts || {};
    const countsLog = `processing=${c.processing||0} succeeded=${c.succeeded||0} errored=${c.errored||0} canceled=${c.canceled||0} expired=${c.expired||0}`;
    if (countsLog !== lastCountsLog) {
      const elapsed = Math.round((Date.now() - start) / 1000);
      console.log(`  [Anthropic Batch] ${batchId}: ${status.processing_status} | ${countsLog} | ${elapsed}s elapsed`);
      lastCountsLog = countsLog;
    }

    if (status.processing_status === 'ended') {
      if (!status.results_url) {
        throw new Error(`Batch ended without results_url: ${batchId}`);
      }
      return await retrieveResults(status.results_url, requests.length);
    }

    if (status.processing_status === 'canceling' || status.processing_status === 'canceled') {
      throw new Error(`Batch ${batchId} was canceled`);
    }
  }

  throw new Error(`Batch ${batchId} timed out after ${Math.round(maxWait / 1000)}s`);
}

async function retrieveResults(resultsUrl, expectedCount) {
  const resp = await fetch(resultsUrl, {
    method:  'GET',
    headers: anthropicHeaders(),
  });

  if (!resp.ok) {
    throw new Error(`Results fetch failed (${resp.status}): ${resultsUrl}`);
  }

  const text = await resp.text();
  const results = new Map();
  const lines = text.split('\n').filter(l => l.trim());

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      const customId = entry.custom_id;
      if (!customId) continue;

      const result = entry.result || {};
      if (result.type === 'succeeded') {
        const msg = result.message || {};
        const content = Array.isArray(msg.content)
          ? msg.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
          : '';
        results.set(customId, { text: content, stop_reason: msg.stop_reason || '' });
      } else if (result.type === 'errored') {
        results.set(customId, { error: result.error?.message || 'unknown error' });
      } else if (result.type === 'expired') {
        results.set(customId, { error: 'expired' });
      } else if (result.type === 'canceled') {
        results.set(customId, { error: 'canceled' });
      } else {
        results.set(customId, { error: `unknown result type: ${result.type}` });
      }
    } catch (err) {
      console.log(`  [Anthropic Batch] Result line parse error: ${err.message}`);
    }
  }

  const succeeded = [...results.values()].filter(v => v.text).length;
  const errored   = [...results.values()].filter(v => v.error).length;
  console.log(`  [Anthropic Batch] Retrieved ${results.size}/${expectedCount} results (${succeeded} succeeded, ${errored} errored)`);

  return results;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { submitBatch, batchAvailable };
