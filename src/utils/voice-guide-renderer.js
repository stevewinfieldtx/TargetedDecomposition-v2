/**
 * TDE — Voice Guide Renderer
 * ═══════════════════════════════════════════════════════════════════
 * Takes a raw CPPV (or CPPW) fingerprint stored in the intelligence
 * table and produces a structured voice guide as:
 *   (a) a JSON object with 11 sections, and
 *   (b) a .docx buffer ready for download.
 *
 * The output format mirrors the "Tone of Voice" document standard
 * used by Eleven Labs conversational agents and similar text-based
 * collaborative AI tools.
 *
 * 11 Sections:
 *   1. Vocabulary and Word Choice
 *   2. Grammatical Patterns
 *   3. Punctuation
 *   4. Sentence Structure and Length
 *   5. Rhetorical Devices
 *   6. Paragraph Structure
 *   7. Tone and Mood
 *   8. Overall Coherence and Cohesion
 *   9. Idiosyncrasies and Quirks
 *  10. Dialogue
 *  11. Figurative Language
 *
 * Usage:
 *   const { generateVoiceGuide } = require('../utils/voice-guide-renderer');
 *   const guide = await generateVoiceGuide(cppvIntelData, 'Alex Hormozi', engine);
 *   // guide.sections   → structured JSON
 *   // guide.docxBuffer  → Buffer ready for res.send()
 */

const { callLLM } = require('./llm');
const config = require('../config');

const SECTION_DEFS = [
  { num: 1, title: 'Vocabulary and Word Choice', emoji: '💎',
    prompt: 'Analyze vocabulary patterns: simple vs specialized terms, repeated key words/phrases, colloquialisms, distinctive word choices, vocabulary range, and reading level. Provide 4-6 specific rules with concrete examples from the source material.' },
  { num: 2, title: 'Grammatical Patterns', emoji: '🔮',
    prompt: 'Analyze grammar: active vs passive voice, dominant tenses, use of imperative mood, first-person vs second-person address, and deliberate rule-breaking for effect. Provide 4-6 specific rules with examples.' },
  { num: 3, title: 'Punctuation', emoji: '⁉️',
    prompt: 'Analyze punctuation habits: comma usage, dashes, ellipses, capitalization for emphasis, colons, parenthetical asides, exclamation points. Provide 4-6 specific rules with examples.' },
  { num: 4, title: 'Sentence Structure and Length', emoji: '📈',
    prompt: 'Analyze sentence patterns: variation in structure (simple/compound/complex), use of fragments, sentence beginnings, average length, mix of short vs long sentences. Provide 4-6 specific rules with examples.' },
  { num: 5, title: 'Rhetorical Devices', emoji: '🎁',
    prompt: 'Analyze rhetorical techniques: metaphors/similes, alliteration, repetition, rhetorical questions, hyperbole, anecdotes and examples. Provide 4-6 specific rules with examples.' },
  { num: 6, title: 'Paragraph Structure', emoji: '🎯',
    prompt: 'Analyze paragraph organization: topic sentences, logical order (deductive/inductive), paragraph length, transitions between ideas. Provide 4-6 specific rules with examples.' },
  { num: 7, title: 'Tone and Mood', emoji: '🧐',
    prompt: 'Analyze tone: dominant tone (casual/formal/authoritative), tonal shifts, humor/sarcasm usage, overall mood and emotional energy. Provide 3-5 specific rules with examples.' },
  { num: 8, title: 'Overall Coherence and Cohesion', emoji: '💯',
    prompt: 'Analyze flow and unity: logical idea progression, transitional phrases, repetition for coherence, focus and unity of purpose. Provide 3-5 specific rules with examples.' },
  { num: 9, title: 'Idiosyncrasies and Quirks', emoji: '🚨',
    prompt: 'Identify distinctive voice quirks: catchphrases, unusual formatting habits, signature expressions, coined terms, unique stylistic tics that set this person apart. Provide 3-5 specific observations with examples.' },
  { num: 10, title: 'Dialogue', emoji: '🦸',
    prompt: 'Analyze how the person handles dialogue and quoted speech: direct vs indirect quotation, speech patterns in examples, conversational tone in hypothetical scenarios. Provide 2-4 specific rules with examples.' },
  { num: 11, title: 'Figurative Language', emoji: '🦖',
    prompt: 'Analyze figurative language: types of metaphors, personification, imagery density, balance of figurative vs literal language. Provide 2-4 specific rules with examples.' },
];

/**
 * Generate the voice guide from a stored CPPV/CPPW intelligence record.
 *
 * @param {Object} intelData  — the .data from store.getIntelligence(), e.g. { profile, profile_type, ... }
 * @param {string} displayName — person or brand name for the title
 * @param {Object} engine      — TDEngine instance (used for LLM calls)
 * @returns {{ sections: Object[], docxBuffer: Buffer, generated_at: string }}
 */
async function generateVoiceGuide(intelData, displayName, engine) {
  // Extract the actual profile payload
  const profileType = intelData.profile_type || 'CPPV';
  const profile = intelData.profile || intelData;
  const profileJson = JSON.stringify(profile, null, 2);

  // If the profile itself is already a structured voice guide (has the section
  // data baked in by TrueWriting), we can use it directly. Otherwise we need
  // the LLM to interpret the fingerprint into the 11-section format.
  let sections;
  if (profile.sections && Array.isArray(profile.sections) && profile.sections.length >= 11) {
    // Pre-structured — use as-is
    sections = profile.sections;
  } else {
    // Generate sections from the raw fingerprint via LLM
    sections = await _generateSectionsFromProfile(profileJson, profileType, displayName);
  }

  // Build the .docx
  const docxBuffer = await _buildDocx(sections, displayName, profileType, intelData);

  return {
    sections,
    docxBuffer,
    generated_at: new Date().toISOString(),
  };
}

/**
 * Use the LLM to interpret a raw fingerprint into the 11-section voice guide format.
 */
async function _generateSectionsFromProfile(profileJson, profileType, displayName) {
  const modalityNote = profileType === 'CPPW'
    ? 'This fingerprint was built from written emails. The voice guide should reflect written communication style.'
    : 'This fingerprint was built from spoken video/podcast content. The voice guide should reflect spoken communication style, noting where spoken patterns may differ from written prose.';

  const systemPrompt = `You are a linguistic analyst specializing in communication style profiling. You produce structured voice guides that can be used by AI agents (like Eleven Labs conversational agents) to replicate a person's communication style.

${modalityNote}

You will receive a communication personality fingerprint (CPP) and must produce a voice guide with exactly 11 sections. Each section should contain 2-6 specific, actionable rules with concrete examples drawn from or inspired by the fingerprint data.

CRITICAL RULES:
- Every rule must include at least one concrete example showing the pattern in action.
- Examples should feel authentic to the person's voice, not generic.
- Be specific and prescriptive — "Use X" not "Consider using X".
- If the fingerprint lacks data for a section, infer reasonable patterns from the overall style profile and note the inference.

Return valid JSON: an array of 11 objects, each with:
  { "num": <1-11>, "title": "<section title>", "rules": ["<rule with example>", ...] }`;

  const userPrompt = `Person: ${displayName}

FINGERPRINT (${profileType}):
${profileJson}

Generate the 11-section voice guide. Each section's rules should be specific to ${displayName}'s style.

Sections required:
${SECTION_DEFS.map(s => `${s.num}. ${s.title}`).join('\n')}`;

  const raw = await callLLM(userPrompt, {
    model: config.CONTENT_MODEL,
    system: systemPrompt,
    maxTokens: 6000,
    temperature: 0.3,
  });

  // Parse the JSON response
  try {
    // Handle potential markdown fences
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed) && parsed.length >= 11) {
      return parsed;
    }
    throw new Error('Expected array of 11 sections');
  } catch (err) {
    console.error(`  Voice guide LLM parse error: ${err.message}`);
    // Fallback: return skeleton sections
    return SECTION_DEFS.map(s => ({
      num: s.num,
      title: s.title,
      rules: [`[Voice guide generation failed for this section — raw fingerprint available via GET /api/cppv/:collectionId]`],
    }));
  }
}

/**
 * Build a .docx buffer from the structured sections.
 * Mirrors the format of the Alex Hormozi "Tone of Voice" reference doc.
 */
async function _buildDocx(sections, displayName, profileType, intelData) {
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel,
    AlignmentType, Header, Footer, PageNumber, LevelFormat,
  } = require('docx');

  const modalityLabel = profileType === 'CPPW' ? 'Written' : 'Spoken';
  const sourceCount = intelData.source_count || intelData.sources_used?.length || '?';
  const builtAt = intelData.built_at || intelData.received_at || 'unknown';

  // Build section children
  const children = [];

  // Title
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    alignment: AlignmentType.LEFT,
    children: [new TextRun({
      text: `${displayName} Tone of Voice`,
      bold: true,
      size: 36,
      font: 'Arial',
    })],
    spacing: { after: 100 },
  }));

  // Subtitle with profile type
  children.push(new Paragraph({
    alignment: AlignmentType.LEFT,
    children: [new TextRun({
      text: `${modalityLabel} Voice Profile`,
      size: 28,
      font: 'Arial',
      italics: true,
      color: '666666',
    })],
    spacing: { after: 400 },
  }));

  // Each section
  for (const section of sections) {
    const def = SECTION_DEFS.find(s => s.num === section.num) || {};
    const emoji = def.emoji || '';

    // Section heading
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({
        text: `${section.num}) ${section.title} ${emoji}`,
        bold: true,
        size: 28,
        font: 'Arial',
      })],
      spacing: { before: 360, after: 200 },
    }));

    // Rules as paragraphs (matching the Hormozi doc style — each rule is its own paragraph)
    const rules = section.rules || [];
    for (const rule of rules) {
      children.push(new Paragraph({
        children: [new TextRun({
          text: rule,
          size: 22,
          font: 'Arial',
        })],
        spacing: { after: 160 },
      }));
    }
  }

  // Spacer before metadata
  children.push(new Paragraph({ spacing: { before: 600 }, children: [] }));

  // Metadata footer note
  children.push(new Paragraph({
    children: [new TextRun({
      text: `Generated by TDE from ${sourceCount} ${profileType === 'CPPW' ? 'email' : 'video/audio'} sources on ${builtAt.split('T')[0] || builtAt}.`,
      size: 18,
      font: 'Arial',
      italics: true,
      color: '999999',
    })],
  }));

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: 'Arial', size: 22 },
        },
      },
      paragraphStyles: [
        {
          id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 36, bold: true, font: 'Arial' },
          paragraph: { spacing: { before: 240, after: 240 }, outlineLevel: 0 },
        },
        {
          id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 28, bold: true, font: 'Arial' },
          paragraph: { spacing: { before: 180, after: 180 }, outlineLevel: 1 },
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({
              text: `${displayName} — ${modalityLabel} Voice Profile`,
              size: 16,
              font: 'Arial',
              color: 'AAAAAA',
            })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: 'Page ', size: 16, font: 'Arial', color: 'AAAAAA' }),
              new TextRun({ children: [PageNumber.CURRENT], size: 16, font: 'Arial', color: 'AAAAAA' }),
            ],
          })],
        }),
      },
      children,
    }],
  });

  return await Packer.toBuffer(doc);
}

module.exports = { generateVoiceGuide, SECTION_DEFS };
