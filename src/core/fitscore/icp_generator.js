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
  return `You are building an Ideal Customer Profile for "${vendorName}" that MUST be usable to FIND customers on the web.

Return JSON:
{
  "summary": "1-2 sentences naming who specifically buys this and why — no generic category language",
  "discriminators": [
    {
      "variable": "short canonical name, e.g. 'Runs Splunk SIEM'",
      "definition": "what this trait means / how to read it",
      "why_discriminating": "why this separates a real buyer from a generic company in this category",
      "detection": { "method": "one of: ${DETECT_METHODS}", "example_query": "a concrete web search or public signal you'd use to find it" },
      "weight": 1
    }
  ],
  "anti_signals": [ { "variable": "trait that means NOT a fit", "detection": { "method": "...", "example_query": "..." } } ],
  "buyer_personas": [ { "title": "...", "role": "..." } ]
}

RULES (follow strictly):
- Derive discriminators ONLY from the supplied evidence about who this vendor actually sells to (named customers, case studies, integrations, verticals). Do NOT invent traits the evidence doesn't support.
- EVERY discriminator must have a detection method + concrete example_query. If you can't say how to find it on the web, DROP it.
- Do NOT restate the product's own features as customer "needs" (e.g. if the vendor sells SIEM integration, the discriminator is "already runs a SIEM" — an observable customer trait — not "needs SIEM integration").
- SELF-CRITIQUE before answering: for each discriminator ask "would this equally describe a generic competitor's customer in the same category?" If yes, DELETE it and replace with something sharper grounded in THIS vendor's specific evidence.
- weight is 1-5 (5 = strongest signal of fit).
- Aim for 8-15 sharp discriminators. A few sharp ones beat many bland ones. If evidence is thin, return fewer rather than padding with generic items.`;
}

async function callModel(system, user) {
  if (!process.env.OPENROUTER_API_KEY) return null;
  const model = process.env.ICP_MODEL || process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-sonnet';
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.OPENROUTER_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, temperature: 0.3, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (!r.ok) return null;
    const txt = (await r.json()).choices?.[0]?.message?.content || '';
    try { return JSON.parse(txt); } catch { const m = txt.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; }
  } catch { return null; }
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
      summary: 'Insufficient evidence to build sharp discriminators — research returned little. '
        + 'Deepen research (case studies / customers / integrations) and regenerate.',
      discriminators: [], buyer_personas: (profile && profile.buyer_personas) || [],
      _low_evidence: true, _evidence_chars: evidence.length,
    };
  }
  profile._model = process.env.ICP_MODEL || process.env.OPENROUTER_MODEL || 'default';
  profile._evidence_chars = evidence.length;
  if (evidence.length < 400) profile._low_evidence = true;
  return profile;
}

module.exports = { generate, discriminatorPrompt };
