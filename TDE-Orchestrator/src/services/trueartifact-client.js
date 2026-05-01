const config = require('../config');

const BASE = config.TRUEARTIFACT_INTERNAL_URL;

/**
 * Internal HTTP client for TrueArtifact (craft engine).
 * Authenticates with TRUEARTIFACT_AUTH_TOKEN as Bearer token.
 */

/**
 * Render an artifact from atoms.
 *
 * @param {string} format      – email | deck | social_image | one_pager | battlecard
 * @param {Array}  atoms       – atom objects from TDE search
 * @param {string} audience    – description of target audience
 * @param {string} solutionName – name of the solution/product
 * @param {object} context     – additional context (industry, deal_stage, prospect, seller, brand)
 * @returns {object} rendered artifact payload
 */
async function render(format, atoms, audience, solutionName, context = {}) {
  const url = `${BASE}/render`;
  const start = Date.now();
  const tag = `[trueartifact-client] POST /render (${format})`;

  console.log(`${tag} → sending ${atoms.length} atoms`);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.TRUEARTIFACT_AUTH_TOKEN}`,
      },
      body: JSON.stringify({
        format,
        atoms,
        audience,
        solution_name: solutionName,
        context,
      }),
    });

    const elapsed = Date.now() - start;

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`${tag} ← ${res.status} (${elapsed}ms): ${text}`);
      const err = new Error(`TrueArtifact responded ${res.status}: ${text}`);
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

module.exports = { render };
