/**
 * Vendor-agnostic IPP generator — produces RESELLER DISCRIMINATORS, not wallpaper.
 *
 * Twin of fitscore/icp_generator.js, but the subject is the VENDOR'S IDEAL
 * RESELLER. A good discriminator is (a) observable on the web, (b) splits a
 * reseller likely to succeed with THIS vendor from a generic IT shop, and
 * (c) carries a detection method + a DISCOVERY query that surfaces net-new
 * partner firms. Derived only from evidence about how the vendor sells through
 * the channel and what its existing/comparable partners look like.
 */
const DETECT_METHODS =
  'web_search | partner_directory | job_postings | tech_stack | dns_email | news | review_sites';

const EVIDENCE_QUERY =
  'Compile concrete evidence about how this vendor goes to market THROUGH THE CHANNEL and what a ' +
  'successful RESELLER of it looks like: the vendor partner/reseller program and its requirements, ' +
  'named partners or distributors, partner case studies, the products/services those partners also ' +
  'sell, the verticals and customer sizes they serve, certifications they hold, and whether the ' +
  'vendor sells direct. Prefer named specifics over marketing language.';

function discriminatorPrompt(vendorName) {
  return `You are building an Ideal PARTNER Profile for "${vendorName}" that MUST be usable to FIND brand-new RESELLERS (channel partners) on the open web.

Return JSON:
{
  "summary": "1-2 sentences naming what kind of reseller succeeds with this vendor and why — no generic language",
  "discriminators": [
    {
      "variable": "short canonical OBSERVABLE trait of the RESELLER, e.g. 'Microsoft CSP' or 'Markets managed email security'",
      "definition": "what this trait means / how to read it",
      "why_discriminating": "why this separates a reseller likely to succeed with ${vendorName} from a generic IT firm",
      "detection": { "method": "one of: ${DETECT_METHODS}", "example_query": "a DISCOVERY query that surfaces reseller FIRMS you do NOT already know" },
      "weight": 1
    }
  ],
  "anti_signals": [ { "variable": "observable trait of a reseller that means NOT a fit", "detection": { "method": "...", "example_query": "..." } } ],
  "partner_personas": [ { "title": "decision-maker or champion role at the partner", "role": "..." } ]
}

RULES (follow strictly):
- Derive discriminators ONLY from the supplied evidence about how ${vendorName} sells through the channel and what its partners look like. Do NOT invent traits the evidence doesn't support.
- Each discriminator must be an OBSERVABLE TRAIT OF THE RESELLER FIRM that an outsider can detect (its business model, certifications, the other vendors it carries, the services it markets, the verticals it serves). BANNED: restating ${vendorName}'s own features as a partner "need". Convert into a findable proxy: a certification cohort (e.g. "Microsoft CSP"), a service they advertise (e.g. "offers managed email security"), a competing/complementary line they resell, or a vertical focus.
- detection.example_query MUST be a DISCOVERY query that finds reseller FIRMS you do NOT yet know, and must NOT assume you already know the firm. BANNED pattern: "company name + <keyword>".
  Good discovery queries by method:
    partner_directory: site:<vendor>.com partners ; "authorized reseller" managed email security
    web_search: list of Microsoft CSP MSPs healthcare ; MSSP "managed email security" United States
    job_postings: site:boards.greenhouse.io MSP "email security engineer"
    tech_stack: site:builtwith.com "<competing product>" agencies
    review_sites: site:g2.com "<competing product>" "partners"
- SELF-CRITIQUE before answering — for each discriminator check BOTH:
    (a) "would this equally describe a random IT shop?" and
    (b) "does my example_query actually surface UNKNOWN reseller firms, or just verify one I named?"
  If it fails either test, DELETE it and replace with something sharper grounded in THIS vendor's channel evidence.
- weight is 1-5 (5 = strongest signal of partner fit).
- Aim for 8-15 sharp, findable discriminators. A few sharp ones beat many bland ones. If evidence is thin, return fewer rather than padding.`;
}

function pickModel() {
  return process.env.IPP_MODEL || process.env.ICP_MODEL || process.env.ANALYSIS_MODEL
    || process.env.CONTENT_MODEL || process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.1-70b-instruct';
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

  // 1) Gather channel evidence from the vendor's tagged atoms
  let evidence = '';
  try {
    const r = await engine.reconstruct([collectionId], {
      intent: 'ipp_evidence', query: EVIDENCE_QUERY, format: 'text', max_atoms: 35, max_words: 1400,
    });
    evidence = typeof r?.output === 'string' ? r.output : JSON.stringify(r?.output || '');
  } catch { /* evidence stays empty */ }

  // 2) Synthesize reseller discriminators
  const profile = await callModel(
    discriminatorPrompt(name),
    'CHANNEL EVIDENCE about ' + name + ':\n\n' + (evidence || '(limited evidence available)')
  );

  if (!profile || !Array.isArray(profile.discriminators)) {
    return {
      summary: (profile && profile.error)
        ? 'Discriminator synthesis failed — see _error.'
        : 'Synthesis returned no discriminators.',
      discriminators: [], partner_personas: (profile && profile.partner_personas) || [],
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
