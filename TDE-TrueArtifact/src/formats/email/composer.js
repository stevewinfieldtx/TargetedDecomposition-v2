/**
 * Email Composer — selects atoms, synthesizes email copy via LLM,
 * and returns structured email content (subject, body, metadata).
 */

const { callLLMJSON } = require('../../utils/llm');
const { formatAtomsForPrompt } = require('../../shared/atom-formatter');
const { EMAIL_ARCHETYPE_MAP } = require('./archetypes');

/**
 * @param {Object[]} atoms         - atom payload from TDE
 * @param {Object}   audience      - { type, persona, industry, name, company, ... }
 * @param {string}   solutionName
 * @param {Object}   options       - { emailType, subjectLineCount, customInstructions }
 * @returns {Object}               - { subject, subjectAlternatives, body, preview, metadata }
 */
async function composeEmail(atoms, audience, solutionName, options = {}) {
  const emailType = options.emailType || 'cold_outreach';
  const archetype = EMAIL_ARCHETYPE_MAP[emailType];
  if (!archetype) {
    throw Object.assign(
      new Error(`Unknown email type: "${emailType}". Supported: ${Object.keys(EMAIL_ARCHETYPE_MAP).join(', ')}`),
      { statusCode: 400 }
    );
  }

  // 1. Select relevant atoms
  const selected = selectAtomsForEmail(atoms, archetype.atomQuery, 8);

  // 2. Build the synthesis prompt
  const atomBlock = selected.length > 0
    ? `\nSOURCE ATOMS:\n${formatAtomsForPrompt(selected)}`
    : '\n(No source atoms — generate from context and solution knowledge)';

  const recipientContext = [
    audience.name && `Name: ${audience.name}`,
    audience.title && `Title: ${audience.title}`,
    audience.company && `Company: ${audience.company}`,
    audience.industry && `Industry: ${audience.industry}`,
    audience.persona && `Persona: ${audience.persona}`,
  ].filter(Boolean).join('\n');

  const subjectCount = options.subjectLineCount || 3;

  const prompt = `You are a B2B email copywriter. Write a ${archetype.label} email.

SOLUTION: ${solutionName}
EMAIL TYPE: ${archetype.label}
TONE: ${archetype.tone}
MAX WORDS: ${archetype.maxWords}
STRUCTURE: ${archetype.structure.join(' → ')}

RECIPIENT:
${recipientContext || 'General prospect'}

INSTRUCTIONS:
${archetype.promptHint}
${options.customInstructions ? `\nADDITIONAL: ${options.customInstructions}` : ''}
${atomBlock}

Return a JSON object:
{
  "subject": "best subject line",
  "subject_alternatives": ["alt 1", "alt 2"],
  "body": "full email body as plain text with \\n for line breaks",
  "preview_text": "email preview text (40-90 chars)",
  "personalization_tokens": ["any {{tokens}} used that need filling"]
}

Rules:
- Keep body under ${archetype.maxWords} words
- Ground claims in source atoms when available
- Use {{first_name}}, {{company}} tokens for personalization
- No "I hope this email finds you well" or similar filler
- Subject lines: 4-8 words, curiosity-driven, no clickbait
- Generate exactly ${subjectCount} subject line options total (1 primary + ${subjectCount - 1} alternatives)`;

  const result = await callLLMJSON(prompt, {
    maxTokens: 2000,
    temperature: 0.5,
    system: 'You are a top-performing B2B email copywriter. Return only valid JSON.',
  });

  if (result && result.body) {
    return {
      subject: result.subject || `Re: ${solutionName}`,
      subjectAlternatives: result.subject_alternatives || [],
      body: result.body,
      previewText: result.preview_text || '',
      personalizationTokens: result.personalization_tokens || [],
      metadata: {
        emailType,
        atomsUsed: selected.length,
        wordCount: result.body.split(/\s+/).length,
      },
    };
  }

  // Fallback
  console.warn(`  [Composer] LLM failed for ${emailType}, returning minimal output`);
  return {
    subject: `${solutionName} — ${archetype.label}`,
    subjectAlternatives: [],
    body: selected.map(a => a.text).join('\n\n') || `Learn more about ${solutionName}.`,
    previewText: '',
    personalizationTokens: [],
    metadata: { emailType, atomsUsed: selected.length, wordCount: 0, fallback: true },
  };
}

function selectAtomsForEmail(atoms, query, limit = 8) {
  if (!query || Object.keys(query).length === 0) return atoms.slice(0, limit);

  const scored = atoms.map(atom => {
    let score = 0;
    for (const [dim, values] of Object.entries(query)) {
      const atomVal = atom[dim] || atom[dim.replace(/_([a-z])/g, (_, c) => c.toUpperCase())];
      if (!atomVal) continue;
      const targets = Array.isArray(values) ? values : [values];
      if (targets.some(v => {
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

module.exports = { composeEmail };
