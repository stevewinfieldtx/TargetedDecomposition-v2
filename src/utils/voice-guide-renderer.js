/**
 * Pull representative source text from the collection's atoms.
 * Returns a large block of actual text the person said/wrote so the
 * LLM can identify real patterns, phrases, and examples.
 *
 * This is READ-ONLY on the collection — no fingerprint or atom is modified.
 */
async function _pullSourceText(engine, collectionId, profileType) {
  const VIDEO_AUDIO_TYPES = new Set(['youtube', 'audio', 'podcast', 'mp3', 'mp4']);
  const sources = await engine.store.getSources(collectionId);
  const readySources = sources.filter(s => s.status === 'ready');

  // For CPPV, only pull from video/audio. For CPPW, pull from all.
  const relevantSources = profileType === 'CPPV'
    ? readySources.filter(s => VIDEO_AUDIO_TYPES.has(s.source_type))
    : readySources;

  if (!relevantSources.length) {
    console.log(`  Voice guide: no relevant sources found for source text extraction`);
    return '';
  }

  // Sample up to 30 sources spread across the timeline for diversity
  const MAX_SOURCES = 30;
  let sampled = relevantSources;
  if (relevantSources.length > MAX_SOURCES) {
    const step = Math.floor(relevantSources.length / MAX_SOURCES);
    sampled = relevantSources.filter((_, i) => i % step === 0).slice(0, MAX_SOURCES);
  }

  // Pull atoms from each source and take representative chunks
  const chunks = [];
  const MAX_WORDS_PER_SOURCE = 1500;
  for (const source of sampled) {
    try {
      const atoms = await engine.store.getAtoms(collectionId, source.id);
      const fullText = atoms.map(a => a.text).join(' ');
      const words = fullText.split(/\s+/);
      const capped = words.length > MAX_WORDS_PER_SOURCE
        ? words.slice(0, MAX_WORDS_PER_SOURCE).join(' ')
        : fullText;
      if (capped.length > 50) {
        chunks.push(`--- SOURCE: ${source.title || source.id} ---\n${capped}`);
      }
    } catch (e) {
      // Skip sources we can't read
    }
  }

  const sourceText = chunks.join('\n\n');
  console.log(`  Voice guide: pulled ${chunks.length} source texts (~${Math.round(sourceText.split(/\s+/).length)} words total)`);
  return sourceText;
}


/**
 * Three-pass voice guide generation, modeled on the segmentation prompt
 * methodology that produced the Alex Hormozi reference document.
 *
 * Pass 1 (Micro): Vocabulary, Grammar, Punctuation
 * Pass 2 (Meso): Sentence Structure, Rhetorical Devices, Paragraph Structure
 * Pass 3 (Macro): Tone, Coherence, Quirks, Dialogue, Figurative Language
 *
 * Each pass runs against the ACTUAL SOURCE TEXT (what the person said/wrote)
 * with the statistical fingerprint provided as supplementary context.
 * This gives the LLM real sentences to quote and real patterns to identify.
 */
async function _generateSectionsThreePass(profileJson, profileType, displayName, sourceText) {
  // If we couldn't pull source text, fall back to the original single-pass method
  if (!sourceText || sourceText.length < 200) {
    console.log('  Voice guide: insufficient source text, falling back to single-pass');
    return _generateSectionsFromProfile(profileJson, profileType, displayName);
  }

  const modalityNote = profileType === 'CPPW'
    ? 'This text comes from written emails. The voice guide should reflect written communication style.'
    : 'This text comes from spoken video/podcast transcripts. The voice guide should reflect spoken communication style, noting where spoken patterns may differ from written prose.';

  const baseSystem = `You are a linguistic analyst specializing in communication style profiling for ${displayName}. You produce structured voice guides that AI agents use to replicate a person's communication style.

${modalityNote}

You will receive:
1. ACTUAL SOURCE TEXT — real words ${displayName} said or wrote. This is your PRIMARY source for identifying patterns and quoting examples.
2. STATISTICAL FINGERPRINT — corpus-level metrics (word frequencies, sentence lengths, punctuation ratios). Use this to confirm or supplement what you see in the source text.

CRITICAL RULES:
- Every rule MUST include at least one REAL example quoted directly from the source text. Not paraphrased. Not invented. Actually quoted.
- Be specific and prescriptive — "Use X" not "Consider using X".
- Provide good examples AND bad examples (what NOT to do when emulating this voice).
- If a pattern appears in the source text, cite the specific quote.
- Each section should have 4–8 detailed rules with examples.
- Quality and specificity matter more than anything. Take your time.

Return valid JSON: an array of objects, each with:
  { "num": <section number>, "title": "<section title>", "rules": ["<detailed rule with quoted example>", ...] }`;

  // ── Pass 1: Micro-level (Sections 1–3) ──────────────────────────────────────
  const pass1Prompt = `Person: ${displayName}

Analyze the following source text focusing on these MICRO-LEVEL elements:

1. Vocabulary and Word Choice
   - Analyze the use of unique, specialized, or repetitive words and phrases
   - Identify frequency and diversity of vocabulary
   - Examine use of jargon, slang, or colloquialisms
   - Determine preference for simple or complex words
   - Look for distinctive or unusual word choices
   - Assess the reading age level

2. Grammatical Patterns
   - Identify use of specific grammatical structures (passive voice, complex tenses, parts of speech)
   - Analyze verb tense usage and consistency
   - Examine pronoun usage (I, you, we)
   - Look for recurring grammatical quirks or deliberate deviations

3. Punctuation
   - Analyze use of commas, semicolons, dashes, parentheses
   - Determine if certain punctuation marks are favored
   - Examine how punctuation creates rhythm, emphasis, or clarity
   - Look for unusual or idiosyncratic punctuation patterns

Provide detailed rules for each element with REAL examples quoted from the source text. Show what good and bad emulation looks like.

STATISTICAL FINGERPRINT (supplementary context):
${profileJson}

SOURCE TEXT:
${sourceText}`;

  console.log(`  Voice guide Pass 1/3 (Micro: vocabulary, grammar, punctuation)...`);
  const raw1 = await callLLM(pass1Prompt, {
    model: config.CONTENT_MODEL,
    system: baseSystem,
    maxTokens: 8000,
    temperature: 0.3,
  });

  // ── Pass 2: Meso-level (Sections 4–6) ──────────────────────────────────────
  const pass2Prompt = `Person: ${displayName}

Analyze the following source text focusing on these MESO-LEVEL elements:

4. Sentence Structure and Length
   - Examine complexity, variety, and average length of sentences
   - Identify use of simple, compound, complex, or compound-complex sentences
   - Analyze use of sentence fragments, run-on sentences, or varied beginnings
   - Determine preference for short punchy sentences vs longer elaborate ones
   - Calculate approximate average words per sentence
   - Identify percentage of short sentences (<10 words) vs long sentences (>30 words)

5. Rhetorical Devices
   - Recognize use of metaphors, similes, alliteration, repetition
   - Identify use of rhetorical questions, irony, hyperbole
   - Examine use of analogies, anecdotes, or examples to illustrate points
   - Look for distinctive or recurring rhetorical devices

6. Paragraph Structure
   - Examine how ideas are organized: length, topic sentences, transitions
   - Analyze use of deductive or inductive reasoning
   - Identify use of chronological, spatial, or emphatic order
   - Look for unique or recurring structural patterns

Provide detailed rules for each element with REAL examples quoted from the source text. Show what good and bad emulation looks like.

STATISTICAL FINGERPRINT (supplementary context):
${profileJson}

SOURCE TEXT:
${sourceText}`;

  console.log(`  Voice guide Pass 2/3 (Meso: sentence structure, rhetoric, paragraphs)...`);
  const raw2 = await callLLM(pass2Prompt, {
    model: config.CONTENT_MODEL,
    system: baseSystem,
    maxTokens: 8000,
    temperature: 0.3,
  });

  // ── Pass 3: Macro-level (Sections 7–11) ─────────────────────────────────────
  const pass3Prompt = `Person: ${displayName}

Analyze the following source text focusing on these MACRO-LEVEL elements:

7. Tone and Mood
   - Analyze overall emotional tone (formal, casual, humorous, serious)
   - Identify shifts in tone and how they're achieved
   - Determine use of diction, syntax, and imagery to create mood
   - Look for inconsistencies or contradictions in tone

8. Overall Coherence and Cohesion
   - Analyze how well ideas flow and connect
   - Examine use of transitional words, phrases, or sentences
   - Identify use of repetition, parallel structure, or other cohesive devices
   - Determine ability to maintain focus and unity

9. Idiosyncrasies and Quirks
   - Identify unique or unusual aspects of style: catchphrases, coined terms, signature expressions
   - Look for recurring stylistic mannerisms that set this person apart
   - Analyze how these quirks contribute to the overall voice

10. Dialogue
    - Examine how the person handles direct address, quoted speech, hypothetical conversations
    - Analyze authenticity and consistency of conversational patterns
    - Identify distinctive quirks in how they set up or deliver dialogue

11. Figurative Language
    - Identify use of personification, synecdoche, metonymy
    - Analyze how figurative language conveys meaning or evokes emotions
    - Examine frequency and effectiveness of figurative language

Provide detailed rules for each element with REAL examples quoted from the source text. Show what good and bad emulation looks like.

STATISTICAL FINGERPRINT (supplementary context):
${profileJson}

SOURCE TEXT:
${sourceText}`;

  console.log(`  Voice guide Pass 3/3 (Macro: tone, coherence, quirks, dialogue, figurative)...`);
  const raw3 = await callLLM(pass3Prompt, {
    model: config.CONTENT_MODEL,
    system: baseSystem,
    maxTokens: 8000,
    temperature: 0.3,
  });

  // ── Merge all three passes ─────────────────────────────────────────────────
  const allSections = [];
  for (const [passNum, raw] of [[1, raw1], [2, raw2], [3, raw3]]) {
    if (!raw) {
      console.error(`  Voice guide: Pass ${passNum} returned null`);
      continue;
    }
    try {
      const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        allSections.push(...parsed);
      }
    } catch (err) {
      console.error(`  Voice guide Pass ${passNum} parse error: ${err.message}`);
      console.error(`  Raw (first 300): ${raw.slice(0, 300)}`);
    }
  }

  // Ensure we have all 11 sections, filling gaps with fallback
  const final = [];
  for (const def of SECTION_DEFS) {
    const found = allSections.find(s => s.num === def.num);
    if (found && found.rules && found.rules.length > 0) {
      final.push(found);
    } else {
      console.log(`  Voice guide: section ${def.num} (${def.title}) missing from passes, using fallback`);
      final.push({
        num: def.num,
        title: def.title,
        rules: [`[Section not generated — insufficient source material for this dimension. Try adding more ${profileType === 'CPPV' ? 'video/audio' : 'email'} sources.]`],
      });
    }
  }

  console.log(`  Voice guide: ${final.filter(s => !s.rules[0]?.startsWith('[')).length}/11 sections generated from source text`);
  return final;
}


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
 * @param {Object} intelData   — the .data from store.getIntelligence(), e.g. { profile, profile_type, ... }
 * @param {string} displayName — person or brand name for the title
 * @param {Object} engine      — TDEngine instance (used for LLM calls + atom retrieval)
 * @param {string} collectionId — collection ID to pull source text for rich examples
 * @returns {{ sections: Object[], docxBuffer: Buffer, generated_at: string }}
 */
async function generateVoiceGuide(intelData, displayName, engine, collectionId) {
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
    // Pull actual source text from the collection so the LLM can cite real
    // examples instead of inventing generic ones from statistical data.
    // This is the parallel enrichment path — the fingerprint (used for BEC
    // security) is never modified, only read alongside real source text.
    let sourceText = '';
    if (engine && collectionId) {
      sourceText = await _pullSourceText(engine, collectionId, profileType);
    }

    // Generate sections using the 3-pass methodology (micro → meso → macro)
    // against real source text, with the fingerprint as statistical context.
    // Speed is not a concern — this runs once per quarter.
    sections = await _generateSectionsThreePass(profileJson, profileType, displayName, sourceText);
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

  console.log(`  Voice guide: calling LLM (${config.CONTENT_MODEL}, maxTokens=8000) for ${displayName}...`);
  const raw = await callLLM(userPrompt, {
    model: config.CONTENT_MODEL,
    system: systemPrompt,
    maxTokens: 8000,
    temperature: 0.3,
  });

  // Check if LLM returned anything at all
  if (!raw) {
    console.error(`  Voice guide: LLM returned null/empty — check OPENROUTER_API_KEY, model availability (${config.CONTENT_MODEL}), and prompt size.`);
    console.error(`  Voice guide: fingerprint size was ${profileJson.length} chars`);
    // Fallback: return skeleton sections with diagnostic info
    return SECTION_DEFS.map(s => ({
      num: s.num,
      title: s.title,
      rules: [`[Voice guide generation failed — LLM returned no response. Check server logs. Model: ${config.CONTENT_MODEL}, fingerprint size: ${profileJson.length} chars]`],
    }));
  }

  console.log(`  Voice guide: LLM responded (${raw.length} chars), parsing...`);

  // Parse the JSON response
  try {
    // Handle potential markdown fences
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed) && parsed.length >= 11) {
      return parsed;
    }
    throw new Error(`Expected array of 11 sections, got ${Array.isArray(parsed) ? parsed.length + ' sections' : typeof parsed}`);
  } catch (err) {
    console.error(`  Voice guide LLM parse error: ${err.message}`);
    console.error(`  Voice guide raw response (first 500 chars): ${raw.slice(0, 500)}`);
    // Fallback: return skeleton sections
    return SECTION_DEFS.map(s => ({
      num: s.num,
      title: s.title,
      rules: [`[Voice guide generation failed for this section — parse error: ${err.message}. Raw fingerprint available via GET /api/cppv/:collectionId]`],
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
