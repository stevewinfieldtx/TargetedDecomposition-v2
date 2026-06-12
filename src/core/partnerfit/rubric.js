/**
 * PartnerFit — IPP rubric generation from a TDE solution collection.
 * ───────────────────────────────────────────────────────────────────
 * Mirror of fitscore/rubric.js, but the rubric describes the IDEAL RESELLER
 * (channel partner) for the vendor, not the ideal customer. Uses TDE's own
 * reconstruct() over the vendor's atoms (intent 'ipp_rubric'), and constrains
 * the model to the SHARED partner vocabulary (vocab.js) so all vendor rubrics
 * speak the same language. Falls back to a sensible default.
 *
 * Persisted on the solution collection's metadata.ipp_rubric.
 */
const { PARTNER_VOCAB, VOCAB_KEYS } = require('./vocab');

const FALLBACK_RUBRIC = {
  version: 1,
  kind: 'ipp',
  signals: PARTNER_VOCAB.map((v) => ({
    key: v.key, label: v.label, weight: v.weight, type: v.type, description: v.description,
    good_values: v.good_values,
  })),
  thresholds: { dark_green: 80, green: 60, yellow: 40 },
};

const RUBRIC_QUERY =
  'Based on this vendor and how it goes to market through the channel, define the Ideal ' +
  'PARTNER Profile (IPP) scoring rubric — the traits of a RESELLER most likely to succeed ' +
  'selling this vendor. Choose signals ONLY from this allowed key set: [' + VOCAB_KEYS.join(', ') + ']. ' +
  'Return JSON {"version":1,"kind":"ipp","signals":[{"key","label","weight","type","description","good_values?"}],' +
  '"thresholds":{"dark_green","green","yellow"}}. Weights should sum to ~100. type is categorical|range|boolean. ' +
  'Set good_values for categorical keys when the evidence implies them (e.g. partner_type:["MSP","MSSP"]).';

function normalize(r) {
  r.version = r.version || 1;
  r.kind = 'ipp';
  r.thresholds = { dark_green: 80, green: 60, yellow: 40, ...(r.thresholds || {}) };
  // keep only signals whose key is in the shared vocabulary (governed)
  r.signals = (r.signals || []).filter((s) => s && VOCAB_KEYS.includes(s.key));
  if (!r.signals.length) r.signals = FALLBACK_RUBRIC.signals;
  return r;
}

function parseRubric(output) {
  if (output && typeof output === 'object' && Array.isArray(output.signals)) return normalize(output);
  if (typeof output === 'string') {
    const m = output.match(/\{[\s\S]*\}/);
    if (m) { try { const o = JSON.parse(m[0]); if (Array.isArray(o.signals)) return normalize(o); } catch { /* fall through */ } }
  }
  return null;
}

/** Generate an IPP rubric for a solution collection via TDE reconstruct; fallback on failure. */
async function generateRubric(engine, solutionCollectionId) {
  try {
    const res = await engine.reconstruct([solutionCollectionId], {
      intent: 'ipp_rubric', query: RUBRIC_QUERY, format: 'json', max_atoms: 20, max_words: 700,
    });
    return parseRubric(res && res.output) || FALLBACK_RUBRIC;
  } catch {
    return FALLBACK_RUBRIC;
  }
}

module.exports = { generateRubric, parseRubric, FALLBACK_RUBRIC };
