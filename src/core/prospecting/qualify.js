/**
 * Prospecting — qualify a candidate against the ICP using FREE signals only.
 * Fetches the candidate's own site (TDE web extract) + public DNS/email-hygiene,
 * then a cheap LLM judges fit. No paid data sources.
 */
const { cheapChat } = require('./llm');
const { captureDns } = require('../fitscore/firmographics');

async function qualify(candidate, icp) {
  const domain = candidate.domain;
  let siteText = '';
  try {
    const { extractWeb } = require('../../ingest/web');
    siteText = ((await extractWeb('https://' + domain)).text || '').slice(0, 6000);
  } catch { /* site unreachable — qualify on DNS + name only */ }
  const dns = await captureDns(domain).catch(() => ({}));

  const p = icp.profile || {};
  const sys =
    'You assess whether a company is a good fit for an Ideal Customer Profile. ' +
    'Return JSON {"fit_score":0-100,"matches":[...],"reasons":"...","company_name":"...","industry":"..."}. ' +
    'Be skeptical: if the site content does not clearly indicate a fit, score low. ' +
    'Treat weak/absent DMARC as a positive signal only if the ICP is about email security.';
  const user =
    'ICP:\n' + JSON.stringify({
      summary: p.summary, industries: p.target_industries, company_size: p.company_size,
      pains: p.key_pain_points, signals: p.signals_to_look_for,
    }) +
    '\n\nCANDIDATE domain: ' + domain +
    '\nEmail/DNS signals: ' + JSON.stringify(dns) +
    '\nWebsite excerpt:\n' + (siteText || '(no site content retrieved)');

  const out = await cheapChat(sys, user, { json: true });
  return {
    fit_score: typeof out.fit_score === 'number' ? out.fit_score : null,
    matches: out.matches || [],
    reasons: out.reasons || '',
    company_name: out.company_name || candidate.name || domain,
    industry: out.industry || null,
    signals: { dns },
    has_site: siteText.length > 0,
  };
}

module.exports = { qualify };
