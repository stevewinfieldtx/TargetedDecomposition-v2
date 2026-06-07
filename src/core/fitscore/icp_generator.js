/**
 * Vendor-agnostic ICP generator — produces DISCRIMINATORS, not wallpaper.
 *
 * A good discriminator is (a) observable on the web, (b) splits a real buyer
 * from a generic company in the same category, and (c) specific to THIS vendor's
 * wedge. Every discriminator carries a detection method + example query, so it
 * can drive the prospecting swarm and become a column in the variable matrix.
 *
 * Works for ANY vendor. Nothing is hardcoded — discriminators are derived from
 * the evidence gathered about who the vendor actually sells to.
 */
const DETECT_METHODS =
  'web_search | job_postings | tech_stack | dns_email | news | hiring | firmographic | review_sites';

const EVIDENCE_QUERY =
  'Compile concrete evidence about who this vendor ACTUALLY sells to: named customers and ' +
  'client logos, case studies (named client + their industry + the problem solved), ' +
  'integrations and technology partners, target verticals, typical deal size, and specific ' +
  'proof points. Prefer named specifics over marketing language.';

function discriminatorPrompt(vendorName) {
  return `You are building an Ideal Customer Profile for "${vendorName}" that MUST be usable to FIND brand-new customers on the open web.

Return JSON:
{
  "summary": "1-2 sentences naming who specifically buys this and why — no generic category language",
  "discriminators": [
    {
      "variable": "short canonical OBSERVABLE trait, e.g. 'Runs Splunk SIEM' or 'Hiring OT security staff'",
      "definition": "what this trait means / how to read it",
      "why_discriminating": "why this separates a real buyer from a generic company in this category",
      "detection": { "method": "one of: ${DETECT_METHODS}", "example_query": "a DISCOVERY query that surfaces companies you do NOT already know" },
      "weight": 1
    }
  ],
  "anti_signals": [ { "variable": "observable trait that means NOT a fit", "detection": { "method": "...", "example_query": "..." } } ],
  "buyer_personas": [ { "title": "...", "role": "..." } ]
}

RULES (follow strictly):
- Derive discriminators ONLY from the supplied evidence about who this vendor actually sells to (named customers, case studies, integrations, verticals). Do NOT invent traits the evidence doesn't support.
- Each discriminator must be an OBSERVABLE TRAIT of the customer that an outsider can detect. BANNED: restating ${vendorName}'s own features as a customer "need" — never "needs X", "requires X", or "wants X" where X is what ${vendorName} sells. Convert it into a findable proxy instead: a regulatory cohort, a hiring signal, a technology in use, a recent event, or an industry/segment. (Example: not "needs audit readiness" -> instead "operates under NERC CIP / TSA / PCI" or "hiring GRC/compliance analysts".)
- detection.example_query MUST be a DISCOVERY query that finds companies you do NOT yet know. It must NOT contain the words "company name" and must NOT assume you already know the company. BANNED pattern: "company name + <keyword>".
  Good discovery queries by method:
    web_search: list of NERC CIP regulated utilities ; mid-size healthcare systems in Texas
    job_postings: site:boards.greenhouse.io "OT security" ; "hiring" "GRC analyst" manufacturer
    tech_stack: site:builtwith.com "Microsoft 365" healthcare  (directories of users)
    news: "data breach" hospital 2025 ; "ransomware" manufacturer
    firmographic: "Series B" cybersecurity startups ; NAICS 2211 utilities
    review_sites: site:g2.com <competitor> reviews
- SELF-CRITIQUE before answering — for each discriminator check BOTH:
    (a) "would this equally describe a generic competitor's customer?" and
    (b) "does my example_query actually surface UNKNOWN companies, or does it just verify one I already named?"
  If it fails either test, DELETE it and replace with something sharper grounded in THIS vendor's evidence.
- weight is 1-5 (5 = strongest signal of fit).
- Aim for 8-15 sharp, findable discriminators. A few sharp ones beat many bland ones. If evidence is thin, return fewer rather than padding.`;
}

function pickModel() {
  return process.env.ICP_MODEL || process.env.ANALYSIS_MODEL || process.env.CONTENT_MODEL
    || process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.1-70b-instruct';
}

async function callModel(system, user) {
  if (!process.env.OPENROUTER_API_KEY) return { error: 'no OPENROUTER_API_KEY' };
  const model = pickModel();
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.OPENROUTER_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, temperature: 0.3, max_tokens: 3000,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (!r.ok) { const t = await r.text().catch(() => ''); return { error: 'HTTP ' + r.status + ' ' + t.slice(0, 180), model }; }
    const txt = ((await r.json()).choices?.[0]?.message?.content) || '';
    let parsed = null;
    try { parsed = JSON.parse(txt); } catch { const m = txt.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]); } catch { /* noop */ } } }
    if (!parsed) return { error: 'unparseable_response', model, sample: txt.slice(0, 180) };
    parsed._model = model;
    return parsed;
  } catch (e) { return { error: String((e && e.message) || e), model }; }
}

async function generate(engine, collectionId, vendor = {}) {
  const name = vendor.name || collectionId;

  // 1) Gather raw evidence from the vendor's tagged atoms (who they actually sell to)
  let evidence = '';
  try {
    const r = await engine.reconstruct([collectionId], {
      intent: 'icp_evidence', query: EVIDENCE_QUERY, format: 'text', max_atoms: 35, max_words: 1400,
    });
    evidence = typeof r?.output === 'string' ? r.output : JSON.stringify(r?.output || '');
  } catch { /* evidence stays empty */ }

  // 2) Synthesize discriminators with a strong model
  const profile = await callModel(
    discriminatorPrompt(name),
    'EVIDENCE about ' + name + ':\n\n' + (evidence || '(limited evidence available)')
  );

  if (!profile || !Array.isArray(profile.discriminators)) {
    return {
      summary: (profile && profile.error)
        ? 'Discriminator synthesis failed — see _error.'
        : 'Synthesis returned no discriminators.',
      discriminators: [], buyer_personas: (profile && profile.buyer_personas) || [],
      _low_evidence: evidence.length < 400, _evidence_chars: evidence.length,
      _error: (profile && profile.error) || 'no_discriminators',
      _model_tried: (profile && profile.model) || pickModel(),
      _sample: (profile && profile.sample) || null,
    };
  }
  profile._evidence_chars = evidence.length;
  if (evidence.length < 400) profile._low_evidence = true;
  return profile;
}

module.exports = { generate, discriminatorPrompt };
