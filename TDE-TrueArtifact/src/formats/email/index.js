/**
 * Email format entry point.
 * Pipeline: Archetype selection → Composer → Structured output
 */

const { composeEmail } = require('./composer');

/**
 * @param {Object[]} atoms        - atom payload from TDE
 * @param {Object}   audience     - { type, persona, industry, name, company, ... }
 * @param {string}   solutionName
 * @param {Object}   context      - { emailType, subjectLineCount, customInstructions }
 * @returns {Object}              - { subject, subjectAlternatives, body, previewText, metadata }
 */
async function renderEmail(atoms, audience, solutionName, context = {}) {
  const t0 = Date.now();
  const emailType = context.emailType || inferEmailType(audience);

  console.log(`  [Email] Composing ${emailType} for ${audience.persona || audience.type || 'general'}, atoms=${atoms.length}`);

  const result = await composeEmail(atoms, audience, solutionName, {
    ...context,
    emailType,
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`  [Email] Complete in ${elapsed}s — ${result.metadata.wordCount} words`);

  return result;
}

/**
 * If no emailType is specified, infer from audience context.
 */
function inferEmailType(audience) {
  const persona = (audience.persona || audience.type || '').toLowerCase();
  if (persona.includes('partner')) return 'partner_recruitment';
  if (persona.includes('executive') || persona.includes('c_suite') || persona.includes('cxo')) return 'executive_intro';
  return 'cold_outreach';
}

module.exports = renderEmail;
