/**
 * PartnerFit — resolve IPP rubric signals to points for a reseller.
 * ───────────────────────────────────────────────────────────────────
 * Mirror of fitscore/signals.js, but the subject is a RESELLER/channel partner.
 * Inputs:
 *   rubric        — { signals: [{key,label,weight,type,good_values?}], thresholds }
 *   intel         — TDE company_intel row for the RESELLER (industry, customer_data,
 *                   solution_context, partner_data?, country, ...)
 *   firmographics — getFirmographics() output (apollo headcount/tech + DNS)
 *
 * Deterministic: awards a signal's full weight when its evidence is present
 * (and matches good_values when provided). Resolves only keys in the shared
 * partner vocabulary; unknown keys score 0. Degrades gracefully when intel/
 * firmographics are sparse.
 */
function asArray(v) { return Array.isArray(v) ? v : (v ? [v] : []); }
function nonEmpty(v) { return Array.isArray(v) ? v.length > 0 : !!v; }
function parseJson(v) { if (!v) return {}; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch { return {}; } }
function matchVal(value, good) {
  if (value == null) return false;
  if (!good || !good.length) return true;
  const v = String(value).toLowerCase();
  return asArray(good).some((g) => v.includes(String(g).toLowerCase()));
}
function anyText(...vals) {
  return vals.flatMap(asArray).map((x) => (typeof x === 'string' ? x : JSON.stringify(x || ''))).join(' ').toLowerCase();
}

function resolvePartnerSignals(rubric, intel = {}, firmographics = {}) {
  const apollo = firmographics.apollo || {};
  const customer = parseJson(intel.customer_data);
  const solCtx = parseJson(intel.solution_context);
  const partner = parseJson(intel.partner_data); // optional, when intel was gathered with role=partner
  const techNames = [].concat(apollo.technology_names || [], solCtx.technology_stack || []);
  const blob = anyText(intel.industry, partner.descriptors, partner.services, customer.descriptors, techNames, apollo.keywords);

  const signals = {};
  for (const sig of (rubric.signals || [])) {
    const key = sig.key;
    const weight = Number(sig.weight) || 0;
    let hit = false;

    switch (key) {
      case 'partner_type':
        // observable: the reseller describes itself as an MSP/MSSP/VAR/SI/reseller
        hit = matchVal(partner.partner_type || blob, sig.good_values
          || ['msp', 'mssp', 'var', 'system integrator', 'reseller', 'managed service', 'it services']);
        break;
      case 'managed_services':
        hit = !!partner.managed_services || /managed (it|service|security)|noc|soc|helpdesk|recurring/.test(blob);
        break;
      case 'complementary_vendors':
        hit = nonEmpty(partner.vendor_lines) || nonEmpty(techNames) || nonEmpty(solCtx.technology_stack);
        break;
      case 'certifications':
        hit = matchVal(anyText(partner.certifications, techNames), sig.good_values)
          || /csp|gold partner|silver partner|certified|competency|soc ?2/.test(blob);
        break;
      case 'tech_stack':
        hit = nonEmpty(techNames) || matchVal(blob, sig.good_values);
        break;
      case 'target_industries':
        hit = matchVal(intel.industry || partner.industries, sig.good_values);
        break;
      case 'customer_size':
      case 'size':
        hit = apollo.company_size != null || partner.customer_size != null;
        break;
      case 'region':
      case 'country':
        hit = matchVal(intel.country, sig.good_values);
        break;
      case 'recurring_revenue':
        hit = !!partner.recurring_revenue || /managed|subscription|per (user|seat)|mrr|monthly/.test(blob);
        break;
      case 'growth_signals':
        hit = nonEmpty(customer.growth_signals) || apollo.latest_funding_stage != null;
        break;
      default:
        hit = false;
    }
    signals[key] = hit ? weight : 0;
  }
  return signals;
}

module.exports = { resolvePartnerSignals };
