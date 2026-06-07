/**
 * FitScore — resolve rubric signals to points for a lead.
 * ───────────────────────────────────────────────────────────────────
 * Inputs:
 *   rubric        — { signals: [{key,label,weight,type,good_values?}], thresholds }
 *   intel         — TDE company_intel row (industry, customer_data, compete_data,
 *                   painpoints_data, solution_context, country, ...)
 *   firmographics — output of firmographics.getFirmographics() (apollo/dns/derived)
 *
 * Deterministic: awards a signal's full weight when its evidence is present
 * (and matches good_values when provided). Extend per real rubric needs.
 */
function asArray(v) { return Array.isArray(v) ? v : (v ? [v] : []); }
function nonEmpty(v) { return Array.isArray(v) ? v.length > 0 : !!v; }

function resolveSignals(rubric, intel = {}, firmographics = {}) {
  const apollo = firmographics.apollo || {};
  const dnsObj = firmographics.dns || {};
  const customer = parseJson(intel.customer_data);
  const painpoints = parseJson(intel.painpoints_data);
  const solCtx = parseJson(intel.solution_context);

  const signals = {};
  for (const sig of (rubric.signals || [])) {
    const key = sig.key;
    const weight = Number(sig.weight) || 0;
    let hit = false;

    switch (key) {
      case 'industry':
        hit = matchVal(intel.industry || apollo.industry, sig.good_values);
        break;
      case 'employee_count':
      case 'company_size':
      case 'size':
        hit = apollo.company_size != null;
        break;
      case 'tech_stack':
        hit = nonEmpty(apollo.technology_names) || nonEmpty(solCtx.technology_stack);
        break;
      case 'growth_signals':
        hit = nonEmpty(customer.growth_signals) || apollo.latest_funding_stage != null;
        break;
      case 'region':
      case 'country':
        hit = matchVal(intel.country, sig.good_values);
        break;
      case 'pain_fit':
        hit = nonEmpty(painpoints.company_pain_points) || nonEmpty(painpoints.buying_triggers);
        break;
      case 'email_security_gap': // email-security ICP: weak/absent DMARC = strong fit
        hit = dnsObj.dmarc_present === false || ['none', 'unspecified'].includes(dnsObj.dmarc_policy);
        break;
      default:
        hit = false;
    }
    signals[key] = hit ? weight : 0;
  }
  return signals;
}

function matchVal(value, good) {
  if (value == null) return false;
  if (!good || !good.length) return true; // presence is enough when no allow-list
  const v = String(value).toLowerCase();
  return asArray(good).some((g) => v.includes(String(g).toLowerCase()));
}
function parseJson(v) { if (!v) return {}; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch { return {}; } }

module.exports = { resolveSignals };
