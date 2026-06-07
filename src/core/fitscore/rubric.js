/**
 * FitScore — ICP rubric generation from a TDE solution collection.
 * ───────────────────────────────────────────────────────────────────
 * Uses TDE's own reconstruct() over the solution's atoms (produced by
 * /research or /upload) to synthesize an ICP rubric. Falls back to a sensible
 * default so the flow works even before deep research has run.
 *
 * The rubric is persisted on the solution collection's metadata.fitscore_rubric.
 */
const FALLBACK_RUBRIC = {
  version: 1,
  signals: [
    { key: 'industry', label: 'Industry fit', weight: 25, type: 'categorical', description: 'Target vertical alignment' },
    { key: 'employee_count', label: 'Company size', weight: 20, type: 'range', description: 'Headcount in ideal band' },
    { key: 'tech_stack', label: 'Tech stack fit', weight: 20, type: 'boolean', description: 'Uses complementary tooling' },
    { key: 'growth_signals', label: 'Growth signals', weight: 20, type: 'boolean', description: 'Hiring / funding momentum' },
    { key: 'region', label: 'Region', weight: 15, type: 'categorical', description: 'Served geography' },
  ],
  thresholds: { dark_green: 80, green: 60, yellow: 40 },
};

const RUBRIC_QUERY =
  'Based on this solution, define the Ideal Customer Profile scoring rubric. ' +
  'Return JSON {"version":1,"signals":[{"key","label","weight","type","description"}],"thresholds":{"dark_green","green","yellow"}}. ' +
  'Weights should sum to ~100. type is categorical|range|boolean.';

function parseRubric(output) {
  if (output && typeof output === 'object' && Array.isArray(output.signals)) return normalize(output);
  if (typeof output === 'string') {
    const m = output.match(/\{[\s\S]*\}/);
    if (m) { try { const o = JSON.parse(m[0]); if (Array.isArray(o.signals)) return normalize(o); } catch { /* fall through */ } }
  }
  return null;
}
function normalize(r) {
  r.version = r.version || 1;
  r.thresholds = { dark_green: 80, green: 60, yellow: 40, ...(r.thresholds || {}) };
  return r;
}

/** Generate a rubric for a solution collection via TDE reconstruct; fallback on failure. */
async function generateRubric(engine, solutionCollectionId) {
  try {
    const res = await engine.reconstruct([solutionCollectionId], {
      intent: 'icp_rubric', query: RUBRIC_QUERY, format: 'json', max_atoms: 20, max_words: 700,
    });
    return parseRubric(res && res.output) || FALLBACK_RUBRIC;
  } catch {
    return FALLBACK_RUBRIC;
  }
}

module.exports = { generateRubric, parseRubric, FALLBACK_RUBRIC };
