/**
 * Slide Synthesizer — for each archetype in the plan, selects the best atoms
 * and asks the LLM to generate structured slide content.
 */

const { callLLMJSON } = require('../../utils/llm');
const { formatAtomsForPrompt } = require('../../shared/atom-formatter');

/**
 * @param {Object}   archetype    - single archetype definition
 * @param {Object[]} atoms        - full atom payload
 * @param {string}   solutionName
 * @param {Object}   audience
 * @param {number}   slideIndex   - position in deck (for context)
 * @returns {Object}              - { archetype, title, bullets, notes, atomsUsed }
 */
async function synthesizeSlide(archetype, atoms, solutionName, audience, slideIndex) {
  // 1. Select atoms — match on 9D query filters
  const selected = selectAtoms(atoms, archetype.atomQuery, 12);

  // 2. Build the prompt
  const atomBlock = selected.length > 0
    ? `\nSOURCE ATOMS:\n${formatAtomsForPrompt(selected)}`
    : '\n(No source atoms — generate from context only)';

  const prompt = `You are writing slide ${slideIndex + 1} of a B2B sales deck.

SLIDE TYPE: ${archetype.label}
INTENT: ${archetype.intent}
SOLUTION: ${solutionName}
AUDIENCE: ${audience.type || 'general'} ${audience.persona || ''} ${audience.industry || ''}

${archetype.promptHint}
${atomBlock}

Return a JSON object with:
{
  "title": "slide title (max 8 words)",
  "bullets": ["point 1", "point 2", ...],
  "notes": "speaker notes (2-3 sentences)",
  "visual_suggestion": "brief description of ideal visual for this slide"
}

Rules:
- Bullets: 3-6 items, each 8-20 words
- Ground every claim in the source atoms when available
- Use the audience's language, not vendor jargon
- Title should be a compelling statement, not just the topic name`;

  const result = await callLLMJSON(prompt, {
    maxTokens: 1500,
    temperature: 0.4,
    system: 'You are a B2B sales content writer. Return only valid JSON.',
  });

  if (result && result.title) {
    return {
      archetype: archetype.id,
      title: result.title,
      bullets: result.bullets || [],
      notes: result.notes || '',
      visualSuggestion: result.visual_suggestion || '',
      atomsUsed: selected.length,
    };
  }

  // Fallback: minimal slide
  console.warn(`  [Synthesizer] LLM failed for ${archetype.id}, using fallback`);
  return {
    archetype: archetype.id,
    title: archetype.label,
    bullets: selected.slice(0, 4).map(a => a.text?.slice(0, 120) || archetype.intent),
    notes: archetype.intent,
    visualSuggestion: '',
    atomsUsed: selected.length,
  };
}

/**
 * Select the best atoms for a given 9D query.
 * Simple matching: score atoms by how many query dimensions they match.
 */
function selectAtoms(atoms, query, limit = 12) {
  if (!query || Object.keys(query).length === 0) return [];

  const scored = atoms.map(atom => {
    let score = 0;
    for (const [dim, values] of Object.entries(query)) {
      const atomVal = atom[dim] || atom[camelCase(dim)];
      if (!atomVal) continue;
      const normalised = Array.isArray(values) ? values : [values];
      if (normalised.some(v => {
        if (typeof v === 'number') return Number(atomVal) >= v;
        return String(atomVal).toLowerCase().includes(String(v).toLowerCase());
      })) {
        score += 1;
      }
    }
    return { atom, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.atom);
}

function camelCase(str) {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Synthesize all slides in the plan (sequential to respect rate limits).
 */
async function synthesizeAll(plan, atoms, solutionName, audience) {
  const slides = [];
  for (let i = 0; i < plan.length; i++) {
    const slide = await synthesizeSlide(plan[i], atoms, solutionName, audience, i);
    slides.push(slide);
  }
  return slides;
}

module.exports = { synthesizeSlide, synthesizeAll, selectAtoms };
