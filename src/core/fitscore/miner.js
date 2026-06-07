/**
 * FitScore — Section 9 pattern miner (ported from the Python reference).
 * ───────────────────────────────────────────────────────────────────
 * Compares a TOP cohort (dark_green+green) vs BOTTOM (yellow+unqualified)
 * across flattened lead feature-sets, ranks discriminating signals with real
 * statistics, proposes new rubric signals, and surfaces hidden gems.
 * Pure + dependency-free so every number is deterministic and auditable.
 */

const TOP = new Set(['dark_green', 'green']);
const BOTTOM = new Set(['yellow', 'unqualified']);

const MIN_COHORT = 5;
const MIN_SUPPORT = 3;
const SIG_P = 0.1;
const MIN_ABS_DIFF = 0.15;
const MIN_ABS_D = 0.4;

const SKIP_KEYS = new Set([
  '_captured_at', 'pages_fetched', 'spf_record', 'dmarc_record', 'mx_hosts',
  '_headcounts_used', 'description', 'specialties', 'social_links', 'open_roles',
]);
const MAX_LIST_ITEMS = 25;

// ── stats ──────────────────────────────────────────────────────────────────
function normalCdf(z) {
  // Abramowitz-Stegun erf approximation
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

function twoProportionTest(succA, nA, succB, nB) {
  if (nA === 0 || nB === 0) return { p_a: null, p_b: null, diff: null, lift: null, z: null, p_value: null, n_a: nA, n_b: nB };
  const pA = succA / nA, pB = succB / nB;
  const pPool = (succA + succB) / (nA + nB);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / nA + 1 / nB));
  const z = se > 0 ? (pA - pB) / se : 0;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  const lift = pB > 0 ? pA / pB : (pA > 0 ? Infinity : null);
  return {
    p_a: round(pA, 4), p_b: round(pB, 4), diff: round(pA - pB, 4),
    lift: lift === Infinity || lift === null ? lift : round(lift, 2),
    z: round(z, 3), p_value: round(pValue, 4), n_a: nA, n_b: nB,
  };
}

function meanSd(values) {
  const n = values.length;
  if (n === 0) return [0, 0, 0];
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n === 1) return [mean, 0, 1];
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1);
  return [mean, Math.sqrt(variance), n];
}

function cohensD(a, b) {
  const [mA, sdA, nA] = meanSd(a);
  const [mB, sdB, nB] = meanSd(b);
  if (nA < 2 || nB < 2) return { mean_a: nA ? round(mA, 3) : null, mean_b: nB ? round(mB, 3) : null, d: null, n_a: nA, n_b: nB };
  const pooled = Math.sqrt(((nA - 1) * sdA ** 2 + (nB - 1) * sdB ** 2) / (nA + nB - 2));
  const d = pooled > 0 ? (mA - mB) / pooled : 0;
  return { mean_a: round(mA, 3), mean_b: round(mB, 3), d: round(d, 3), n_a: nA, n_b: nB };
}

function round(x, n) { const f = 10 ** n; return Math.round(x * f) / f; }
function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }

// ── flatten ──────────────────────────────────────────────────────────────────
function flatten(data, prefix = '', out = {}) {
  if (!data || typeof data !== 'object') return out;
  for (const [key, value] of Object.entries(data)) {
    if (SKIP_KEYS.has(key) || key.startsWith('__')) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(value)) {
      const scalars = value.filter((v) => ['string', 'number', 'boolean'].includes(typeof v));
      out[`${path}__count`] = scalars.length;
      for (const item of scalars.slice(0, MAX_LIST_ITEMS)) out[`${path}:${item}`] = true;
    } else if (value && typeof value === 'object') {
      flatten(value, path, out);
    } else if (['string', 'number', 'boolean'].includes(typeof value)) {
      out[path] = value;
    }
  }
  return out;
}

// ── miner ──────────────────────────────────────────────────────────────────
function mine(leads, topColours = TOP, bottomColours = BOTTOM) {
  const top = leads.filter((l) => topColours.has(l.colour));
  const bottom = leads.filter((l) => bottomColours.has(l.colour));
  const result = { top_n: top.length, bottom_n: bottom.length, findings: [], suggested_signals: [], hidden_gems: [], notes: [] };

  if (top.length < MIN_COHORT || bottom.length < MIN_COHORT) {
    result.notes.push(`Need >= ${MIN_COHORT} scored leads in each cohort to mine reliably (have top=${top.length}, bottom=${bottom.length}).`);
    return result;
  }

  const topFlat = top.map((l) => flatten(l.features || {}));
  const bottomFlat = bottom.map((l) => flatten(l.features || {}));
  const { numeric, categorical } = featureUniverse([...topFlat, ...bottomFlat]);

  for (const feat of numeric) { const f = numericFinding(feat, topFlat, bottomFlat); if (f) result.findings.push(f); }
  for (const feat of categorical) result.findings.push(...categoricalFindings(feat, topFlat, bottomFlat));

  result.findings.sort((a, b) => b.effect - a.effect);
  result.suggested_signals = suggestSignals(result.findings);
  result.hidden_gems = hiddenGems(result.findings, bottom);
  return result;
}

function featureUniverse(rows) {
  const numeric = new Set(), categorical = new Set(), allKeys = new Set();
  for (const row of rows) {
    for (const [k, v] of Object.entries(row)) {
      allKeys.add(k);
      if (isNum(v)) numeric.add(k);
    }
  }
  // a key seen with any numeric value is numeric; everything else is categorical
  for (const k of allKeys) if (!numeric.has(k)) categorical.add(k);
  return { numeric, categorical };
}

function numericFinding(feat, topFlat, bottomFlat) {
  const a = topFlat.map((r) => r[feat]).filter(isNum);
  const b = bottomFlat.map((r) => r[feat]).filter(isNum);
  if (a.length < MIN_SUPPORT || b.length < MIN_SUPPORT) return null;
  const res = cohensD(a, b);
  if (res.d === null || Math.abs(res.d) < MIN_ABS_D) return null;
  const direction = res.d > 0 ? 'top' : 'bottom';
  const comp = res.d > 0 ? 'higher' : 'lower';
  return { feature: feat, kind: 'numeric', detail: res, effect: Math.abs(res.d), direction,
    headline: `Winners average ${res.mean_a} vs ${res.mean_b} on '${feat}' (${comp} among top leads; d=${res.d}).` };
}

function categoricalFindings(feat, topFlat, bottomFlat) {
  const values = new Set();
  [...topFlat, ...bottomFlat].forEach((r) => { if (feat in r) values.add(r[feat]); });
  const findings = [];
  for (const val of values) {
    const succA = topFlat.filter((r) => r[feat] === val).length;
    const succB = bottomFlat.filter((r) => r[feat] === val).length;
    if (succA + succB < MIN_SUPPORT) continue;
    const res = twoProportionTest(succA, topFlat.length, succB, bottomFlat.length);
    if (res.diff === null || Math.abs(res.diff) < MIN_ABS_DIFF || (res.p_value !== null && res.p_value > SIG_P)) continue;
    const direction = res.diff > 0 ? 'top' : 'bottom';
    const label = `${feat}=${val}`;
    const pctA = Math.round(res.p_a * 100), pctB = Math.round(res.p_b * 100);
    const headline = direction === 'top'
      ? `${label}: ${pctA}% of top leads vs ${pctB}% of bottom (+${Math.round(res.diff * 100)}pp, p=${res.p_value}, lift x${res.lift}).`
      : `${label}: ${pctA}% of top vs ${pctB}% of bottom (${Math.round(res.diff * 100)}pp, p=${res.p_value}) — more common among weak leads.`;
    findings.push({ feature: label, kind: 'categorical', detail: { ...res, feature: feat, value: val }, effect: Math.abs(res.diff), direction, headline });
  }
  return findings;
}

function suggestSignals(findings, limit = 8) {
  const out = [];
  for (const f of findings) {
    if (f.direction !== 'top') continue;
    const weight = Math.max(5, Math.min(20, Math.round((f.effect * 40) / 5) * 5));
    const key = f.feature.replace(/[.: ]/g, '_').toLowerCase();
    out.push({ key, label: humanize(f.feature), suggested_weight: weight,
      type: f.kind === 'categorical' ? 'boolean' : 'range', evidence: f.detail, rationale: f.headline });
    if (out.length >= limit) break;
  }
  return out;
}

function hiddenGems(findings, bottomLeads, limit = 10) {
  const winning = findings.filter((f) => f.direction === 'top').slice(0, 12);
  if (!winning.length) return [];
  const gems = [];
  for (const lead of bottomLeads) {
    const flat = flatten(lead.features || {});
    const matched = [];
    for (const f of winning) {
      if (f.kind === 'categorical' && flat[f.detail.feature] === f.detail.value) matched.push(f.feature);
      else if (f.kind === 'numeric' && isNum(flat[f.feature]) && flat[f.feature] >= (f.detail.mean_a || 0)) matched.push(f.feature);
    }
    if (matched.length) gems.push({ lead_id: lead.id, company_name: lead.company_name, domain: lead.domain,
      current_score: lead.score ?? null, current_colour: lead.colour ?? null,
      winning_traits_matched: matched, match_strength: round(matched.length / winning.length, 2) });
  }
  gems.sort((a, b) => b.match_strength - a.match_strength);
  return gems.slice(0, limit);
}

function humanize(feature) {
  return feature.split('.').pop().replace(/_/g, ' ').replace(/:/g, ': ').replace(/\b\w/g, (c) => c.toUpperCase());
}

module.exports = { mine, flatten, twoProportionTest, cohensD, normalCdf, TOP, BOTTOM };
