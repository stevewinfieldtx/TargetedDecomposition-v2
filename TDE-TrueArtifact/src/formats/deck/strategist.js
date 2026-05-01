/**
 * Deck Strategist — decides which archetypes to include and in what order.
 * Uses audience-defaults as a starting point, then asks the LLM to
 * prune / reorder based on the available atoms and context.
 */

const { callLLMJSON } = require('../../utils/llm');
const { ARCHETYPE_MAP } = require('./archetypes');
const { AUDIENCE_DEFAULTS } = require('../../shared/audience-defaults');

/**
 * @param {Object[]} atoms       - full atom payload from TDE
 * @param {Object}   audience    - { type, persona, industry, ... }
 * @param {string}   solutionName
 * @param {Object}   context     - optional overrides (forceArchetypes, excludeArchetypes, maxSlides)
 * @returns {Object[]}           - ordered array of archetype definitions to render
 */
async function planDeck(atoms, audience, solutionName, context = {}) {
  // 1. Start with audience default if we have one, otherwise all archetypes
  const audienceType = audience.type || 'executive';
  const defaultOrder = AUDIENCE_DEFAULTS[audienceType] || AUDIENCE_DEFAULTS.executive;

  // 2. Apply hard overrides from context
  let candidateIds = [...defaultOrder];
  if (context.forceArchetypes) {
    for (const id of context.forceArchetypes) {
      if (!candidateIds.includes(id) && ARCHETYPE_MAP[id]) candidateIds.push(id);
    }
  }
  if (context.excludeArchetypes) {
    candidateIds = candidateIds.filter(id => !context.excludeArchetypes.includes(id));
  }

  // 3. Check atom coverage — drop archetypes that need atoms but have none
  const atomTexts = atoms.map(a => (a.text || '').toLowerCase());
  const coverageHints = candidateIds.map(id => {
    const arch = ARCHETYPE_MAP[id];
    if (!arch) return null;
    if (arch.minAtoms === 0) return { id, covered: true, reason: 'no atoms needed' };
    // Simple keyword heuristic: does any atom mention terms related to this archetype?
    const keywords = (arch.label + ' ' + arch.intent).toLowerCase().split(/\s+/);
    const hits = atomTexts.filter(t => keywords.some(k => k.length > 3 && t.includes(k)));
    return { id, covered: hits.length >= arch.minAtoms, hitCount: hits.length, needed: arch.minAtoms };
  }).filter(Boolean);

  // 4. Ask LLM to finalize the plan
  const maxSlides = context.maxSlides || 20;
  const prompt = `You are a sales deck strategist. Given the following context, decide the final slide order.

SOLUTION: ${solutionName}
AUDIENCE TYPE: ${audienceType}
AUDIENCE DETAILS: ${JSON.stringify(audience)}
MAX SLIDES: ${maxSlides}
TOTAL ATOMS AVAILABLE: ${atoms.length}

CANDIDATE ARCHETYPES (in default order):
${coverageHints.map(c => `  ${c.id}: covered=${c.covered} ${c.hitCount !== undefined ? `(${c.hitCount} atom hits, needs ${c.needed})` : ''}`).join('\n')}

INSTRUCTIONS:
- Return a JSON array of archetype IDs in presentation order
- Always start with "title" and "agenda"
- Always end with "cta" (and optionally "appendix" after it)
- Drop archetypes with covered=false UNLESS they are critical for this audience
- Keep total slides <= ${maxSlides}
- Order for maximum narrative flow: problem → solution → proof → action

Return ONLY a JSON array of strings, e.g. ["title", "agenda", "threat_landscape", ...]`;

  const plan = await callLLMJSON(prompt, {
    maxTokens: 1000,
    temperature: 0.2,
    system: 'You are a B2B sales deck strategist. Return only valid JSON.',
  });

  if (Array.isArray(plan)) {
    const valid = plan.filter(id => ARCHETYPE_MAP[id]);
    if (valid.length >= 3) {
      return valid.map(id => ARCHETYPE_MAP[id]);
    }
  }

  // Fallback: use defaults, drop uncovered
  console.warn('  [Strategist] LLM plan unusable, falling back to defaults');
  return candidateIds
    .filter(id => {
      const c = coverageHints.find(h => h.id === id);
      return c && (c.covered || ['title', 'agenda', 'cta'].includes(id));
    })
    .slice(0, maxSlides)
    .map(id => ARCHETYPE_MAP[id]);
}

module.exports = { planDeck };
