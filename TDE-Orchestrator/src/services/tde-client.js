const config = require('../config');

const BASE = config.TDE_INTERNAL_URL;

/**
 * Internal HTTP client for the TDE atom engine.
 * Uses built-in fetch (Node 20+). Every call logs timing and wraps errors.
 */

async function request(method, path, body) {
  const url = `${BASE}${path}`;
  const start = Date.now();
  const tag = `[tde-client] ${method} ${path}`;

  console.log(`${tag} → sending`);

  try {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body !== undefined) {
      opts.body = JSON.stringify(body);
    }

    const res = await fetch(url, opts);
    const elapsed = Date.now() - start;

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`${tag} ← ${res.status} (${elapsed}ms): ${text}`);
      const err = new Error(`TDE responded ${res.status}: ${text}`);
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    console.log(`${tag} ← 200 (${elapsed}ms)`);
    return data;
  } catch (err) {
    if (!err.status) {
      const elapsed = Date.now() - start;
      console.error(`${tag} ← NETWORK ERROR (${elapsed}ms): ${err.message}`);
      err.status = 502;
    }
    throw err;
  }
}

/**
 * Search a collection for relevant atoms.
 */
async function search(collectionId, query, topK = 10, filters = {}) {
  return request('POST', `/search/${collectionId}`, { query, top_k: topK, filters });
}

/**
 * Reconstruct content from one or more collections.
 * collectionIds can be a single string or an array — joined with commas.
 */
async function reconstruct(collectionIds, options = {}) {
  const ids = Array.isArray(collectionIds) ? collectionIds.join(',') : collectionIds;
  return request('POST', `/reconstruct/${ids}`, options);
}

/**
 * Ask a question against a collection.
 */
async function ask(collectionId, question, filters = {}) {
  return request('POST', `/ask/${collectionId}`, { question, filters });
}

/**
 * Trigger research ingestion for a collection.
 */
async function research(collectionId, solutionUrl, solutionName) {
  return request('POST', `/research/${collectionId}`, {
    solution_url: solutionUrl,
    solution_name: solutionName,
  });
}

/**
 * List all collections.
 */
async function getCollections() {
  return request('GET', '/collections');
}

/**
 * Get a single collection by id.
 */
async function getCollection(id) {
  return request('GET', `/collections/${id}`);
}

/**
 * Get stats for a collection.
 */
async function getStats(collectionId) {
  return request('GET', `/stats/${collectionId}`);
}

module.exports = {
  search,
  reconstruct,
  ask,
  research,
  getCollections,
  getCollection,
  getStats,
};
