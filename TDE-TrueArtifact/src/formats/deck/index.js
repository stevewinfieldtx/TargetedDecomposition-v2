/**
 * Deck format entry point.
 * Pipeline: Strategist → Synthesizer → Compiler → HTML
 */

const { planDeck } = require('./strategist');
const { synthesizeAll } = require('./synthesizer');
const { compileDeck } = require('./compiler');

/**
 * @param {Object[]} atoms        - atom payload from TDE
 * @param {Object}   audience     - { type, persona, industry, ... }
 * @param {string}   solutionName - e.g. "NINJIO Security Awareness"
 * @param {Object}   context      - optional: brand, forceArchetypes, excludeArchetypes, maxSlides
 * @returns {Object}              - { html, metadata }
 */
async function renderDeck(atoms, audience, solutionName, context = {}) {
  const t0 = Date.now();

  // 1. Plan: pick and order archetypes
  console.log(`  [Deck] Planning for audience=${audience.type || 'general'}, atoms=${atoms.length}`);
  const plan = await planDeck(atoms, audience, solutionName, context);
  console.log(`  [Deck] Plan: ${plan.length} slides → ${plan.map(a => a.id).join(', ')}`);

  // 2. Synthesize: generate content for each slide
  console.log(`  [Deck] Synthesizing ${plan.length} slides...`);
  const slides = await synthesizeAll(plan, atoms, solutionName, audience);

  // 3. Compile: render to HTML
  const html = compileDeck(slides, {
    solutionName,
    audience,
    brand: context.brand || {},
    agendaLabels: slides.map(s => s.title),
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`  [Deck] Complete in ${elapsed}s — ${slides.length} slides, ${html.length} bytes`);

  return {
    html,
    metadata: {
      format: 'deck',
      slideCount: slides.length,
      archetypes: slides.map(s => s.archetype),
      totalAtomsUsed: slides.reduce((sum, s) => sum + s.atomsUsed, 0),
      elapsedMs: Date.now() - t0,
    },
  };
}

module.exports = renderDeck;
