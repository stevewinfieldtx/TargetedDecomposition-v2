/**
 * Prospecting — discover candidate companies for an ICP.
 * Cheap LLM turns the ICP into targeted web searches; results are reduced to
 * unique candidate domains, filtering out the vendor itself and non-company sites.
 */
const { webSearch } = require('./search');
const { cheapChat } = require('./llm');
const { bareDomain } = require('../fitscore/firmographics');

const SKIP_DOMAINS = [
  'wikipedia.org', 'linkedin.com', 'facebook.com', 'twitter.com', 'x.com', 'youtube.com',
  'instagram.com', 'tiktok.com', 'crunchbase.com', 'glassdoor.com', 'indeed.com', 'g2.com',
  'capterra.com', 'reddit.com', 'amazon.com', 'google.com', 'bing.com', 'duckduckgo.com',
  'medium.com', 'forbes.com', 'gartner.com', 'yelp.com', 'bbb.org', 'github.com', 'apple.com',
];

async function generateQueries(icp, n = 6) {
  const sys =
    'You generate web search queries to find POTENTIAL CUSTOMER companies that match an Ideal ' +
    'Customer Profile. Return JSON {"queries":[...]} with ' + n + ' specific queries likely to ' +
    'surface real companies or curated lists/directories (use industries, geographies, segments, ' +
    'and association/member-list hints). Never search for the vendor itself.';
  const p = icp.profile || {};
  const user = 'ICP:\n' + JSON.stringify({
    summary: p.summary, industries: p.target_industries, company_size: p.company_size,
    geographies: p.geographies, pains: p.key_pain_points,
  });
  const out = await cheapChat(sys, user, { json: true });
  return Array.isArray(out.queries) ? out.queries.slice(0, n) : [];
}

function skip(domain, vendorDomain) {
  if (!domain) return true;
  if (vendorDomain && domain.includes(vendorDomain)) return true;
  return SKIP_DOMAINS.some((s) => domain === s || domain.endsWith('.' + s));
}

async function discoverCandidates(icp, { maxQueries = 6, perQuery = 10 } = {}) {
  const vendorDomain = icp.vendor && icp.vendor.domain ? bareDomain(icp.vendor.domain) : null;
  const queries = await generateQueries(icp, maxQueries);
  const seen = new Map();
  for (const q of queries) {
    const results = await webSearch(q, perQuery);
    for (const r of results) {
      let d = null;
      try { d = bareDomain(r.url); } catch { d = null; }
      if (skip(d, vendorDomain)) continue;
      if (!seen.has(d)) seen.set(d, { domain: d, name: r.title, source: q, url: r.url });
    }
    await new Promise((res) => setTimeout(res, 1500)); // polite pacing
  }
  return [...seen.values()];
}

module.exports = { discoverCandidates, generateQueries };
