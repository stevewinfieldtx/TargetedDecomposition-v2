/**
 * FitScore — hard firmographic signals (Apollo + public DNS), native Node.
 * ───────────────────────────────────────────────────────────────────
 * Complements TDE's qualitative company research with verified numbers and
 * email-hygiene signals. All sources are gated on env / public DNS, and
 * everything is fault-tolerant (missing -> null). Counts only, no individuals.
 *
 * The output is intended to be MERGED into TDE's company_intel for the lead,
 * so the intel lives in one place (per the agreed architecture).
 */
const dns = require('node:dns').promises;

const APOLLO_BASE = 'https://api.apollo.io/api/v1';
const LEADER_SENIORITIES = ['owner', 'founder', 'c_suite', 'partner', 'vp', 'head', 'director'];
const MX_PROVIDERS = {
  google: ['google.com', 'googlemail.com'],
  microsoft: ['outlook.com', 'protection.outlook.com', 'microsoft.com'],
  proofpoint: ['pphosted.com', 'proofpoint.com'],
  mimecast: ['mimecast.com'],
  barracuda: ['barracudanetworks.com', 'cudamail.com'],
  zoho: ['zoho.com', 'zoho.eu'],
};

function bareDomain(d) {
  if (!d) return '';
  return String(d).replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split(':')[0];
}

// ── pure parsers (unit-tested) ──────────────────────────────────────────────
function parseDmarcPolicy(records) {
  for (const rec of records || []) {
    if (String(rec).toLowerCase().includes('v=dmarc1')) {
      const m = String(rec).match(/\bp\s*=\s*(none|quarantine|reject)/i);
      return m ? m[1].toLowerCase() : 'unspecified';
    }
  }
  return null;
}
function classifyMx(hosts) {
  if (!hosts || !hosts.length) return null;
  const joined = hosts.join(' ').toLowerCase();
  for (const [provider, needles] of Object.entries(MX_PROVIDERS)) {
    if (needles.some((n) => joined.includes(n))) return provider;
  }
  return 'self_hosted_or_other';
}

// ── DNS / email hygiene ──────────────────────────────────────────────────────
async function captureDns(domain) {
  const out = { spf_present: null, dmarc_present: null, dmarc_policy: null, mx_provider: null, mx_hosts: null, security_txt_present: null };
  const bare = bareDomain(domain);
  if (!bare) return out;
  try {
    const txt = (await dns.resolveTxt(bare)).map((r) => r.join(''));
    const spf = txt.find((r) => r.toLowerCase().startsWith('v=spf1'));
    out.spf_present = !!spf;
  } catch { /* no TXT */ }
  try {
    const dmarc = (await dns.resolveTxt(`_dmarc.${bare}`)).map((r) => r.join(''));
    const policy = parseDmarcPolicy(dmarc);
    out.dmarc_present = policy !== null;
    out.dmarc_policy = policy;
  } catch { /* no dmarc */ }
  try {
    const mx = (await dns.resolveMx(bare)).map((r) => r.exchange.toLowerCase());
    out.mx_hosts = mx.length ? mx : null;
    out.mx_provider = classifyMx(mx);
  } catch { /* no mx */ }
  try {
    const r = await fetch(`https://${bare}/.well-known/security.txt`, { signal: AbortSignal.timeout(8000) });
    out.security_txt_present = r.ok && (await r.text()).toLowerCase().includes('contact');
  } catch { out.security_txt_present = false; }
  return out;
}

// ── Apollo (gated on APOLLO_API_KEY) ─────────────────────────────────────────
async function apolloOrg(domain) {
  if (!process.env.APOLLO_API_KEY || !domain) return {};
  try {
    const r = await fetch(`${APOLLO_BASE}/organizations/enrich?domain=${encodeURIComponent(bareDomain(domain))}`,
      { headers: { 'x-api-key': process.env.APOLLO_API_KEY }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return {};
    return (await r.json()).organization || {};
  } catch { return {}; }
}
async function apolloPeopleCount(domain, departments, seniorities) {
  if (!process.env.APOLLO_API_KEY || !domain) return null;
  try {
    const body = { q_organization_domains: bareDomain(domain), person_departments: departments, page: 1, per_page: 1 };
    if (seniorities) body.person_seniorities = seniorities;
    const r = await fetch(`${APOLLO_BASE}/mixed_people/search`,
      { method: 'POST', headers: { 'x-api-key': process.env.APOLLO_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    return ((await r.json()).pagination || {}).total_entries ?? null;
  } catch { return null; }
}

// ── derived ──────────────────────────────────────────────────────────────────
function safeRatio(n, d) { if (typeof n !== 'number' || typeof d !== 'number' || d === 0) return null; return Math.round((n / d) * 100) / 100; }

function deriveRatios(apollo) {
  const sales = apollo.sales_titles_count, mkt = apollo.marketing_titles_count;
  return {
    sales_to_marketing_ratio: safeRatio(sales, mkt),
    sales_leader_to_ic_ratio: safeRatio(apollo.sales_leaders_count,
      (typeof sales === 'number' && typeof apollo.sales_leaders_count === 'number') ? sales - apollo.sales_leaders_count : null),
  };
}
function deriveAbsence(dnsObj) {
  return {
    missing_dmarc: dnsObj.dmarc_present === null ? null : !dnsObj.dmarc_present,
    weak_dmarc_policy: dnsObj.dmarc_present === null ? null : ['none', 'unspecified', null].includes(dnsObj.dmarc_policy),
    missing_spf: dnsObj.spf_present === null ? null : !dnsObj.spf_present,
    no_security_txt: dnsObj.security_txt_present === null ? null : !dnsObj.security_txt_present,
  };
}

async function getFirmographics(domain) {
  const [org, sales, marketing, salesLeaders, marketingLeaders, dnsObj] = await Promise.all([
    apolloOrg(domain),
    apolloPeopleCount(domain, ['sales']),
    apolloPeopleCount(domain, ['marketing']),
    apolloPeopleCount(domain, ['sales'], LEADER_SENIORITIES),
    apolloPeopleCount(domain, ['marketing'], LEADER_SENIORITIES),
    captureDns(domain),
  ]);
  const apollo = {
    company_size: org.estimated_num_employees ?? null,
    industry: org.industry ?? null,
    technology_names: org.technology_names ?? null,
    total_funding: org.total_funding ?? null,
    latest_funding_stage: org.latest_funding_stage ?? null,
    sales_titles_count: sales, marketing_titles_count: marketing,
    sales_leaders_count: salesLeaders, marketing_leaders_count: marketingLeaders,
  };
  return { apollo, dns: dnsObj, derived: { ratios: deriveRatios(apollo), absence: deriveAbsence(dnsObj) }, _captured_at: new Date().toISOString() };
}

module.exports = { getFirmographics, captureDns, parseDmarcPolicy, classifyMx, deriveAbsence, bareDomain, LEADER_SENIORITIES };
