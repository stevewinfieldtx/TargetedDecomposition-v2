/**
 * TDE — Core Engine
 * ═══════════════════════════════════════════════════════════════════
 * INGEST → EXTRACT → MUNGE → TAG → EMBED → STORE → SEARCH → SYNTHESIZE → RECONSTRUCT
 *
 * Universal pipeline. Feed it anything:
 *   youtube  → YouTube video URL
 *   channel  → YouTube channel URL
 *   pdf      → local PDF file path
 *   docx     → local Word doc file path
 *   pptx     → local PowerPoint file path
 *   audio    → local MP3/MP4/WAV/M4A/etc.
 *   text     → raw text string or .txt file path
 *   web      → URL of any web page
 *
 * Every source goes through the same pipeline after extraction:
 *   Munger → 6D Tagger → Embeddings → Store
 *
 * Data gets OUT via:
 *   search()       → filtered vector search, returns ranked atoms with 6D tags
 *   ask()          → RAG Q&A, grounded answer from atoms
 *   reconstruct()  → targeted recomposition into deliverables (emails, briefs, questions, etc.)
 */

const config  = require('../config');
const Store   = require('./store');
const { munge }     = require('./munger');
const { tagAtoms }  = require('./tagger');
const { runAnalysis } = require('./analyzers');
const { batchEmbed, callLLM, callLLMFast, callLLMJSON, generateEmbedding } = require('../utils/llm');
const { v4: uuidv4 } = require('uuid');

const youtube = require('../ingest/youtube');

const MAX_AUTO_RETRIES = 2;
const AUTO_RETRY_DELAYS = [10000, 30000]; // 10s first, 30s second

function _extractYouTubeId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

class TDEngine {
  constructor(dataDir) {
    this.store = new Store(dataDir || config.DATA_DIR);
    console.log('  TDEngine v2.1 initialized');
  }

  // ── Collections ──────────────────────────────────────────────────────────────

  createCollection(id, name, description = '', metadata = {}) {
    return this.store.createCollection(id, name, description, metadata);
  }
  getCollection(id)    { return this.store.getCollection(id); }
  listCollections()    { return this.store.listCollections(); }
  deleteCollection(id) { return this.store.deleteCollection(id); }

  // ── Universal Ingest ─────────────────────────────────────────────────────────

  async ingest(collectionId, type, input, opts = {}) {
    console.log(`\n  TDE Ingest: [${type}] ${input.slice(0, 80)}${input.length > 80 ? '...' : ''}`);
    let content, sourceId, sourceRecord;

    try {
      switch (type.toLowerCase()) {
        case 'youtube': return await this._ingestYouTube(collectionId, input);
        case 'pdf': { const { extractPDF } = require('../ingest/pdf'); content = await extractPDF(input); sourceId = uuidv4().slice(0, 8) + '_pdf'; break; }
        case 'docx': case 'word': { const { extractDOCX } = require('../ingest/docx'); content = await extractDOCX(input); sourceId = uuidv4().slice(0, 8) + '_docx'; break; }
        case 'pptx': case 'powerpoint': { const { extractPPTX } = require('../ingest/pptx'); content = await extractPPTX(input); sourceId = uuidv4().slice(0, 8) + '_pptx'; break; }
        case 'audio': case 'podcast': case 'mp3': case 'mp4': { const { extractAudio } = require('../ingest/audio'); content = await extractAudio(input); sourceId = uuidv4().slice(0, 8) + '_audio'; break; }
        case 'text': case 'transcript': { const { extractText } = require('../ingest/text'); content = extractText(input, opts.title); sourceId = uuidv4().slice(0, 8) + '_text'; break; }
        case 'web': case 'url': { const { extractWeb } = require('../ingest/web'); content = await extractWeb(input); sourceId = uuidv4().slice(0, 8) + '_web'; break; }
        default: throw new Error(`Unknown content type: ${type}. Valid: youtube, pdf, docx, pptx, audio, text, web`);
      }
    } catch (err) { console.error(`  Extraction failed: ${err.message}`); throw err; }

    if (!content || !content.text || content.text.length < 50) throw new Error(`No extractable content from: ${input}`);
    if (opts.title) content.title = opts.title;
    if (opts.author) content.author = opts.author;
    console.log(`  Extracted: "${content.title}" — ${Math.round(content.text.length / 5)} words`);

    sourceRecord = {
      id: sourceId, sourceType: type,
      sourceUrl: type === 'web' ? input : '',
      filePath: ['pdf','docx','pptx','audio','text'].includes(type) ? input : '',
      title: content.title || opts.title || 'Untitled',
      author: content.author || opts.author || '',
      publishedAt: content.publishedAt || '',
      duration: content.duration || 0,
      pageCount: content.pageCount || 0,
      metadata: content.metadata || {},
      status: 'processing',
    };
    await this.store.addSource(collectionId, sourceRecord);

    try {
      const atoms = await this._pipeline(collectionId, sourceId, content, opts.context || '');
      sourceRecord.status = 'ready';
      sourceRecord.metadata = { ...sourceRecord.metadata, atomCount: atoms.length };
      await this.store.addSource(collectionId, sourceRecord);
      console.log(`  Done: ${atoms.length} atoms stored for "${sourceRecord.title}"`);

      // Auto-build CPPV when we hit the minimum (3) and then every 5th after that
      const VIDEO_AUDIO_TYPES = new Set(['youtube', 'audio', 'podcast', 'mp3', 'mp4']);
      if (VIDEO_AUDIO_TYPES.has(type.toLowerCase())) {
        try {
          const allSources = await this.store.getSources(collectionId);
          const readyVideoCount = allSources.filter(s => s.status === 'ready' && VIDEO_AUDIO_TYPES.has(s.source_type)).length;
          const shouldBuild = readyVideoCount === 3 || (readyVideoCount >= 5 && readyVideoCount % 5 === 0);
          if (shouldBuild) {
            console.log(`  [auto-cppv] ${readyVideoCount} video/audio sources ready — building fingerprint`);
            this._buildCPPV(collectionId)
              .then(r => r ? console.log(`  [auto-cppv] Fingerprint built (${r.source_count} sources)`) : console.log('  [auto-cppv] Fingerprint skipped (see logs above)'))
              .catch(e => console.error(`  [auto-cppv] Fingerprint failed: ${e.message}`));
          }
        } catch (e) { console.log(`  [auto-cppv] check failed: ${e.message}`); }
      }

      return { ...sourceRecord, atomCount: atoms.length };
    } catch (err) {
      const retryCount = sourceRecord.metadata.retryCount || 0;
      if (retryCount < MAX_AUTO_RETRIES) {
        const delay = AUTO_RETRY_DELAYS[retryCount] || 30000;
        sourceRecord.metadata.retryCount = retryCount + 1;
        sourceRecord.metadata.lastError = err.message;
        sourceRecord.metadata.lastRetryAt = new Date().toISOString();
        await this.store.addSource(collectionId, sourceRecord);
        console.log(`  [AUTO-RETRY] ${sourceId} — attempt ${retryCount + 1}/${MAX_AUTO_RETRIES} in ${delay/1000}s (${err.message})`);
        setTimeout(() => {
          this.ingest(collectionId, type, input, { ...opts, _retryCount: retryCount + 1 })
            .catch(e => console.error(`  [AUTO-RETRY] Failed: ${sourceId} — ${e.message}`));
        }, delay);
        return { ...sourceRecord, status: 'processing' };
      }
      sourceRecord.status = 'error';
      sourceRecord.metadata = { ...sourceRecord.metadata, error: err.message, retriesExhausted: true, finalFailedAt: new Date().toISOString() };
      await this.store.addSource(collectionId, sourceRecord);
      throw err;
    }
  }

  // ── Core Pipeline ────────────────────────────────────────────────────────────

  async _pipeline(collectionId, sourceId, content, context = '') {
    console.log(`  Pipeline: munging...`);
    const atoms = await munge(content, sourceId);
    if (!atoms.length) throw new Error('Munger produced no atoms — content may be too short or low-quality');
    console.log(`  Pipeline: ${atoms.length} atoms extracted`);

    console.log(`  Pipeline: tagging 6D metadata...`);
    const tagged = await tagAtoms(atoms, context);

    console.log(`  Pipeline: embedding...`);
    const texts = tagged.map(a => a.text);
    const embeddings = await batchEmbed(texts, 5);
    tagged.forEach((a, i) => { a.embedding = embeddings[i] || null; });
    console.log(`  Pipeline: ${embeddings.filter(Boolean).length}/${tagged.length} embedded`);

    await this.store.storeAtoms(collectionId, sourceId, tagged);
    return tagged;
  }

  // ── YouTube ──────────────────────────────────────────────────────────────────

  async _ingestYouTube(collectionId, videoUrl) {
    const videoId = youtube.extractVideoId(videoUrl);
    if (!videoId) throw new Error(`Invalid YouTube URL: ${videoUrl}`);

    const existing = await this.store.getSource(collectionId, videoId);
    if (existing && existing.status === 'ready') { console.log(`  Already ingested: ${existing.title}`); return existing; }

    const meta = await youtube.getVideoMetadata(videoId);
    let comments = [];
    try { comments = await youtube.getVideoComments(videoId, 50); } catch {}

    const source = {
      id: videoId, sourceType: 'youtube', sourceUrl: videoUrl,
      title: meta?.title || `Video ${videoId}`, author: meta?.author || '',
      publishedAt: meta?.publishedAt || '', duration: meta?.duration || 0,
      metadata: { ...(meta || {}), comments, commentCount: meta?.commentCount || 0, tags: meta?.tags || [] },
      status: 'processing',
    };
    await this.store.addSource(collectionId, source);
    console.log(`  YouTube: ${source.title} (${Math.round(source.duration / 60)}m)`);

    const transcript = await youtube.getTranscript(videoId);
    if (!transcript) {
      const retryCount = source.metadata.retryCount || 0;
      if (retryCount < MAX_AUTO_RETRIES) {
        const delay = AUTO_RETRY_DELAYS[retryCount] || 30000;
        source.metadata.retryCount = retryCount + 1;
        source.metadata.lastError = 'No transcript available';
        source.metadata.lastRetryAt = new Date().toISOString();
        await this.store.addSource(collectionId, source);
        console.log(`  [AUTO-RETRY] ${videoId} — attempt ${retryCount + 1}/${MAX_AUTO_RETRIES} in ${delay/1000}s (no transcript)`);
        setTimeout(() => {
          this._ingestYouTube(collectionId, videoUrl)
            .then(r => r ? console.log(`  [AUTO-RETRY] Success: ${videoId}`) : null)
            .catch(err => console.error(`  [AUTO-RETRY] Failed: ${videoId} — ${err.message}`));
        }, delay);
        return null; // Return null but don't mark error yet
      }
      // Auto-retries exhausted — mark permanent error
      source.status = 'error';
      source.metadata.error = 'No transcript available';
      source.metadata.retriesExhausted = true;
      source.metadata.finalFailedAt = new Date().toISOString();
      await this.store.addSource(collectionId, source);
      return null;
    }

    const content = { text: transcript.text, segments: transcript.segments, title: source.title, author: source.author, duration: source.duration, metadata: source.metadata, sourceUrl: videoUrl };
    const atoms = await this._pipeline(collectionId, videoId, content, `YouTube video: "${source.title}" by ${source.author}`);
    source.status = 'ready'; source.metadata.atomCount = atoms.length;
    await this.store.addSource(collectionId, source);
    return source;
  }

  // ── Channel Ingest ───────────────────────────────────────────────────────────

  async ingestChannel(collectionId, channelInput, maxVideos = 50) {
    console.log(`\n  Scanning channel: ${channelInput}`);
    const videoList = await youtube.getChannelVideoIds(channelInput, maxVideos);
    const results = { total: videoList.length, ingested: 0, errors: 0, skipped: 0 };
    for (let i = 0; i < videoList.length; i++) {
      const { videoId, title } = videoList[i];
      console.log(`\n  [${i + 1}/${videoList.length}] ${title || videoId}`);
      try {
        const url = `https://www.youtube.com/watch?v=${videoId}`;
        const result = await this._ingestYouTube(collectionId, url);
        if (result) { result.status === 'ready' ? results.ingested++ : results.skipped++; }
        else { results.errors++; }
      } catch (err) { console.error(`  Error: ${err.message}`); results.errors++; }
      if (i < videoList.length - 1) await sleep(5000);
    }
    console.log(`\n  Channel complete: ${results.ingested}/${results.total} ingested`);
    return results;
  }

  // ── Batch Ingest ─────────────────────────────────────────────────────────────

  async ingestBatch(collectionId, items, context = '') {
    const results = { total: items.length, ingested: 0, errors: 0 };
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      console.log(`\n  Batch [${i + 1}/${items.length}]: ${item.type} — ${(item.input || '').slice(0, 60)}`);
      try { await this.ingest(collectionId, item.type, item.input, { ...item.opts, context }); results.ingested++; }
      catch (err) { console.error(`  Error: ${err.message}`); results.errors++; }
      if (i < items.length - 1) await sleep(500);
    }
    return results;
  }

  // ── Search ───────────────────────────────────────────────────────────────────

  async search(collectionId, query, topK = 10, filters = {}) {
    const queryEmb = await generateEmbedding(query);
    if (!queryEmb) return this._keywordSearch(collectionId, query, topK);
    const results = await this.store.search(collectionId, queryEmb, topK, filters);
    return results.map(r => ({
      atomId: r.id || r.atom_id, sourceId: r.source_id, text: r.text,
      similarity: Math.round((r.similarity || 0) * 1000) / 10,
      atomType: r.atom_type, persona: r.d_persona, buyingStage: r.d_buying_stage,
      emotionalDriver: r.d_emotional_driver, evidenceType: r.d_evidence_type,
      credibility: r.d_credibility, recency: r.d_recency,
      startTime: r.start_time, pageNumber: r.page_number,
    }));
  }

  async _keywordSearch(collectionId, query, topK) {
    const atoms = await this.store.getAtoms(collectionId);
    const terms = query.toLowerCase().split(/\s+/);
    const scored = atoms
      .map(a => ({ ...a, score: terms.filter(t => a.text.toLowerCase().includes(t)).length / terms.length }))
      .filter(a => a.score > 0).sort((a, b) => b.score - a.score).slice(0, topK);
    return scored.map(r => ({ atomId: r.id, sourceId: r.source_id, text: r.text, similarity: Math.round(r.score * 100) }));
  }

  // ── Ask (RAG) ────────────────────────────────────────────────────────────────

  async ask(collectionId, question, filters = {}, topK = 8) {
    const results = await this.search(collectionId, question, topK, filters);
    if (!results.length) return { answer: 'Not enough content to answer this question.', atoms: [] };
    const col = await this.store.getCollection(collectionId);
    const context = results.map((r, i) => `[${i + 1}] ${r.text}`).join('\n\n');
    const filterStr = Object.entries(filters).filter(([,v]) => v).map(([k,v]) => `${k}: ${v}`).join(', ');
    const answer = await callLLMFast(
      `Answer this question using ONLY the content below:\n\nQUESTION: ${question}${filterStr ? '\nFILTER CONTEXT: ' + filterStr : ''}\n\nCONTENT ATOMS:\n${context}\n\nBe specific, cite the atoms, and be concise.`,
      { model: config.CONTENT_MODEL, system: `You answer questions using only provided content from the knowledge base "${col?.name || collectionId}". Be accurate and cite specific atoms.`, maxTokens: 1500, temperature: 0.3 }
    );
    return { answer: answer || 'Error generating response.', atoms: results.slice(0, 5) };
  }

  // ── Reconstruct (Targeted Recomposition) ─────────────────────────────────────

  async reconstruct(collectionIds, options = {}) {
    // Intents where we inject the person's voice profile (CPPW > CPPV fallback)
    // into the system prompt by default. Callers can override via options.in_voice.
    const VOICE_AWARE_INTENTS = new Set(['sales_email', 'agent_response', 'custom']);

    const {
      intent = 'custom',
      query,
      filters = {},
      context = '',
      format = 'text',
      max_atoms = 15,
      max_words = 500,
      in_voice = VOICE_AWARE_INTENTS.has(intent),
      voice_collection = null, // which collection's voice to use when multi-collection (defaults to first)
    } = options;

    if (!query) throw new Error('query is required for reconstruction');
    const cols = Array.isArray(collectionIds) ? collectionIds : [collectionIds];

    const _t = { start: Date.now() };
    console.log(`\n  Reconstruct: "${intent}" across [${cols.join(', ')}]${in_voice ? ' [voice-aware]' : ''}`);
    console.log(`  Query: ${query.slice(0, 80)}...`);
    console.log(`  Filters: ${JSON.stringify(filters)}`);

    // Step 1: Filtered search across all requested collections
    let allResults = [];
    for (const colId of cols) {
      try {
        const results = await this.search(colId, query, max_atoms, filters);
        allResults.push(...results.map(r => ({ ...r, collectionId: colId })));
      } catch (err) { console.log(`  Search failed for ${colId}: ${err.message}`); }
    }
    _t.search = Date.now();
    console.log(`  ⏱ Search: ${((_t.search - _t.start) / 1000).toFixed(2)}s`);
    allResults.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
    const topAtoms = allResults.slice(0, max_atoms);

    if (!topAtoms.length) {
      return { output: 'Insufficient content in the knowledge base to fulfill this request.', atoms_used: [], atoms_available: 0, confidence: 'none', gaps: ['No atoms matched the query and filters.'] };
    }
    console.log(`  Retrieved ${topAtoms.length} atoms (from ${allResults.length} total matches)`);

    // Step 2: Build reconstruction prompt
    const intentPrompts = {
      sales_email: 'Write a professional sales email. Be specific and evidence-based, referencing real capabilities and proof points from the atoms. No generic sales language. Every claim must be backed by a specific atom.',
      competitive_brief: 'Create a competitive intelligence brief: Overview, Key Strengths, Key Weaknesses, Differentiators, Battle Cards. Ground every point in source atoms.',
      executive_summary: 'Write a concise executive summary for C-level readers. Lead with business impact, use only high-credibility evidence, focus on strategic implications.',
      discovery_questions: 'Generate discovery questions for a sales conversation. Each: (1) grounded in atom insights, (2) probes a real pain point, (3) includes rationale, (4) suggests what a good answer looks like.',
      enrichment: 'Produce a structured enrichment package as JSON: "capabilities" (with evidence), "differentiators" (with proof), "proof_points" (stats, cases, quotes), "gaps" (what is missing). No filler.',
      agent_response: 'Respond naturally as this person in conversation.',
      objection_handling: 'Create an objection handling playbook. Per objection: state it, recommended response (from atoms), supporting evidence, follow-up question.',
      custom: 'Fulfill the request using the provided atoms as your ONLY source material. Be specific and evidence-based.',
    };
    const intentInstruction = intentPrompts[intent] || intentPrompts.custom;

    const atomContext = topAtoms.map((a, i) => {
      const tags = [];
      if (a.persona) tags.push(`Persona: ${a.persona}`);
      if (a.buyingStage) tags.push(`Stage: ${a.buyingStage}`);
      if (a.evidenceType) tags.push(`Evidence: ${a.evidenceType}`);
      if (a.credibility) tags.push(`Credibility: ${a.credibility}/5`);
      if (a.emotionalDriver) tags.push(`Driver: ${a.emotionalDriver}`);
      if (a.collectionId && cols.length > 1) tags.push(`Source: ${a.collectionId}`);
      return `[ATOM ${i + 1}] ${tags.join(' | ')}\n${a.text}`;
    }).join('\n\n');

    const filterDesc = Object.entries(filters).filter(([,v]) => v).map(([k,v]) => `${k}: ${v}`).join(', ');

    // ── Voice Profile Injection (CPPW > CPPV > none) ──
    // Only when in_voice is true AND we have a specific collection to source the voice from.
    let voiceSection = '';
    let voiceTypeUsed = 'none';
    _t.voiceStart = Date.now();
    if (in_voice) {
      const voiceCollectionId = voice_collection || cols[0];
      try {
        // Prefer the generated voice guide (compact, human-readable rules) over
        // the raw fingerprint (huge JSON blob of statistical data). The guide was
        // built FROM the fingerprint — no need to send both.
        const voiceGuide = await this.store.getIntelligence(voiceCollectionId, 'voice_guide_sections');
        if (voiceGuide && voiceGuide.data && voiceGuide.data.sections) {
          voiceTypeUsed = 'voice_guide';
          const guideText = voiceGuide.data.sections
            .map(s => `${s.num}. ${s.title}\n${s.rules.join('\n')}`)
            .join('\n\n');
          voiceSection = `
VOICE GUIDE:
${guideText}

Write in this person's voice. Follow the rules above — they capture vocabulary, sentence patterns, tone, and quirks. Use their catchphrases naturally where they fit. Do NOT fall into generic "ChatGPT-style" language unless the guide says that's how they talk.
`;
          console.log(`  Voice: using generated voice guide (${guideText.length} chars)`);
        } else {
          // Fall back to raw fingerprint if no voice guide has been generated yet
          const { profile, type } = await this.getVoiceProfile(voiceCollectionId);
          if (profile) {
            voiceTypeUsed = type;
            const profilePayload = type === 'CPPV' && profile.profile ? profile.profile : profile;
            voiceSection = `
VOICE FINGERPRINT (type: ${type})
${JSON.stringify(profilePayload, null, 2)}

Write in this person's voice. Match their vocabulary tier, sentence length distribution, rhetorical patterns, signature phrases, and emotional range. Use their catchphrases naturally where they fit. Do NOT fall into generic "ChatGPT-style" language.
`;
            console.log(`  Voice: no voice guide found, falling back to raw ${type} fingerprint (${voiceSection.length} chars)`);
          } else {
            console.log(`  Voice: no CPPW or CPPV available for ${voiceCollectionId}, proceeding without voice injection`);
          }
        }
      } catch (err) {
        console.log(`  Voice lookup failed: ${err.message}, proceeding without voice injection`);
      }
    }
    _t.voice = Date.now();
    console.log(`  ⏱ Voice profile: ${((_t.voice - _t.voiceStart) / 1000).toFixed(2)}s (type: ${voiceTypeUsed}, prompt payload: ${voiceSection.length} chars)`);

    // Intents that should never show GAPS (conversational, user-facing)
    const noGapsIntents = new Set(['agent_response']);
    const includeGaps = !noGapsIntents.has(intent);

    const systemPrompt = intent === 'agent_response'
      ? `You are this person in a live conversation.

The content below is NOT a script, NOT source material to summarize, and NOT to be repeated. It exists only to shape your instincts — how you think, what you care about, and how you sound.

Your job: Respond to the question as this person would, naturally, in real conversation.

CRITICAL RULES:
- Do NOT list, summarize, or reference the atomic elements.
- Do NOT "cover all points" from the content.
- Do NOT sound complete — sound human.
- Pick what matters most and respond like a person talking, not writing.
- It's okay to ignore most of the content.

STYLE:
- Short, conversational, slightly imperfect
- Some opinions > full coverage
- Natural flow > structured completeness

IF UNSURE:
- Say you're not sure, or ask a follow-up question.

OUTPUT:
- One natural response. No bullets. No lists. No structure.

${voiceSection}`
      : `You are the Targeted Decomposition Engine's reconstruction system. Take atomic intelligence units and REASSEMBLE them into a targeted deliverable.

RULES:
- Use ONLY the provided atoms for factual content. Do not add information from general knowledge.
- Every factual claim must trace to a specific atom.
${includeGaps ? '- If atoms are insufficient, state what is missing in a GAPS section at the end.' : '- If atoms are insufficient for a complete answer, work confidently with what you have. Do NOT mention gaps, missing data, or limitations.'}
- ${max_words ? `Stay under ${max_words} words.` : 'Be comprehensive but not padded.'}
- ${format === 'json' ? 'Return valid JSON only. No markdown fences.' : format === 'markdown' ? 'Use markdown formatting.' : 'Use clean prose.'}
${voiceSection}`;

    const gapInstruction = includeGaps
      ? 'After your main output, include a GAPS section listing information the atoms could NOT provide.'
      : 'Do NOT include a GAPS section. Just deliver the response.';
    const userPrompt = `INTENT: ${intent}\n${intentInstruction}\n\n${context ? `CONTEXT: ${context}\n` : ''}${filterDesc ? `AUDIENCE FILTERS: ${filterDesc}\n` : ''}\nQUERY: ${query}\n\nATOMS (${topAtoms.length} of ${allResults.length} matches):\n\n${atomContext}\n\n${format === 'json' ? 'Respond with valid JSON only.' : gapInstruction}`;

    // Step 3: LLM reconstruction (fast path — Cerebras if configured, else OpenRouter CONTENT_MODEL)
    console.log(`  Reconstructing (${intent}, ${format}, max ${max_words} words)...`);
    const t0 = Date.now();
    const raw = await callLLMFast(userPrompt, {
      model: config.CONTENT_MODEL, system: systemPrompt,
      maxTokens: Math.min(max_words ? max_words * 2 : 4000, 8000),
      temperature: intent === 'enrichment' ? 0.2 : 0.4,
    });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const totalElapsed = ((Date.now() - _t.start) / 1000).toFixed(1);
    console.log(`  ⏱ LLM call: ${elapsed}s | Total reconstruct: ${totalElapsed}s`);

    if (!raw) {
      return { output: 'Reconstruction failed.', atoms_used: topAtoms, atoms_available: allResults.length, confidence: 'failed', gaps: ['LLM returned no response'] };
    }

    // Step 4: Parse output and extract gaps
    let output = raw;
    let gaps = [];
    const gapMatch = raw.match(/(?:GAPS?|MISSING|INFORMATION GAPS?)[:\s]*\n([\s\S]*?)$/i);
    if (gapMatch) {
      output = raw.slice(0, gapMatch.index).trim();
      gaps = gapMatch[1].split('\n').map(l => l.replace(/^[-*\u2022\d.)\s]+/, '').trim()).filter(l => l.length > 5);
    }
    if (format === 'json') {
      try {
        const cleaned = output.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        output = JSON.parse(cleaned);
        if (output.gaps) { gaps = [...gaps, ...(Array.isArray(output.gaps) ? output.gaps : [output.gaps])]; }
      } catch { /* leave as string */ }
    }

    let confidence = 'high';
    if (topAtoms.length < 3) confidence = 'low';
    else if (topAtoms.length < 7) confidence = 'medium';
    if (gaps.length > 3) confidence = confidence === 'high' ? 'medium' : 'low';

    // Step 5: Build video references (top 2-3 relevant YouTube sources with timestamps)
    let video_references = [];
    if (intent === 'agent_response') {
      try {
        // Deduplicate by source, pick the top-scoring atom per source
        const sourceMap = new Map();
        for (const atom of topAtoms) {
          if (!atom.sourceId) continue;
          if (!sourceMap.has(atom.sourceId) || (atom.similarity || 0) > (sourceMap.get(atom.sourceId).similarity || 0)) {
            sourceMap.set(atom.sourceId, atom);
          }
        }
        // Fetch source details for top 3 unique sources
        const topSourceIds = [...sourceMap.keys()].slice(0, 3);
        for (const srcId of topSourceIds) {
          const atom = sourceMap.get(srcId);
          const colId = atom.collectionId || cols[0];
          const source = await this.store.getSource(colId, srcId);
          if (source && source.source_type === 'youtube' && source.source_url) {
            const videoId = _extractYouTubeId(source.source_url);
            if (videoId) {
              const startSeconds = atom.startTime ? Math.floor(atom.startTime) : 0;
              video_references.push({
                title: source.title || 'Untitled',
                video_id: videoId,
                thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
                url: `https://www.youtube.com/watch?v=${videoId}${startSeconds ? `&t=${startSeconds}` : ''}`,
                timestamp: startSeconds,
                timestamp_display: startSeconds ? `${Math.floor(startSeconds / 60)}:${String(startSeconds % 60).padStart(2, '0')}` : null,
              });
            }
          }
        }
      } catch (err) {
        console.log(`  Video references: failed (${err.message})`);
      }
    }

    return {
      output, atoms_used: topAtoms, atoms_available: allResults.length, confidence, gaps,
      video_references,
      meta: {
        intent, collections: cols, filters,
        elapsed_seconds: parseFloat(elapsed),
        atoms_retrieved: topAtoms.length,
        voice_type_used: voiceTypeUsed, // 'CPPW' | 'CPPV' | 'voice_guide' | 'none'
      },
    };
  }

  // ── Analysis Layer (Template-Specific Extractors) ────────────────────────────

  async analyzeSource(collectionId, sourceId) {
    const col = await this.store.getCollection(collectionId);
    if (!col) throw new Error(`Collection not found: ${collectionId}`);
    const atoms = await this.store.getAtoms(collectionId, sourceId);
    if (!atoms.length) throw new Error(`No atoms for source: ${sourceId}`);
    const source = await this.store.getSource(collectionId, sourceId);

    const meta = typeof col.metadata === 'string' ? JSON.parse(col.metadata || '{}') : (col.metadata || {});
    const templateId = meta.templateId || col.template_id || 'default';

    const sourceMeta = typeof source.metadata === 'string' ? JSON.parse(source.metadata || '{}') : (source.metadata || {});
    const enrichedMeta = {
      ...source,
      viewCount: sourceMeta.viewCount || 0, likeCount: sourceMeta.likeCount || 0,
      commentCount: sourceMeta.commentCount || 0, _comments: sourceMeta.comments || [],
      tags: sourceMeta.tags || [], speakerNames: meta.speakerNames || [],
      productContext: meta.productContext || '',
    };

    console.log(`\n  Analyzing: ${source?.title || sourceId} (template: ${templateId})`);
    const analysis = await runAnalysis(atoms, enrichedMeta, templateId);
    await this.store.storeIntelligence(collectionId, `analysis_${sourceId}`, analysis);
    console.log(`  Analysis stored for ${sourceId}`);
    return analysis;
  }

  async analyzeCollection(collectionId) {
    const sources = await this.store.getSources(collectionId);
    const readySources = sources.filter(s => s.status === 'ready');
    console.log(`\n  Analyzing collection: ${collectionId} (${readySources.length} sources)`);
    const results = [];
    for (const source of readySources) {
      try {
        const analysis = await this.analyzeSource(collectionId, source.id);
        results.push({ sourceId: source.id, title: source.title, analysis });
      } catch (err) { console.error(`  Analysis failed for ${source.title}: ${err.message}`); }
    }
    await this._buildCollectionIntelligence(collectionId, results);
    await this._buildCPPV(collectionId);
    return results;
  }

  async _buildCollectionIntelligence(collectionId, analysisResults) {
    if (!analysisResults.length) return;
    const merged = {};
    for (const r of analysisResults) {
      const extractors = r.analysis?.extractors || {};
      for (const [key, value] of Object.entries(extractors)) {
        if (!merged[key]) merged[key] = [];
        merged[key].push(value);
      }
    }
    await this.store.storeIntelligence(collectionId, 'merged_extractors', merged);

    const sources = await this.store.getSources(collectionId);
    const readySources = sources.filter(s => s.status === 'ready');
    const engagement = readySources.map(s => {
      const meta = typeof s.metadata === 'string' ? JSON.parse(s.metadata || '{}') : (s.metadata || {});
      return {
        id: s.id, title: s.title, publishedAt: s.published_at || meta.publishedAt,
        viewCount: meta.viewCount || 0, likeCount: meta.likeCount || 0,
        commentCount: meta.commentCount || 0,
        likeRate: meta.viewCount > 0 ? Math.round((meta.likeCount / meta.viewCount) * 10000) / 100 : 0,
        commentRate: meta.viewCount > 0 ? Math.round((meta.commentCount / meta.viewCount) * 10000) / 100 : 0,
        tags: meta.tags || [],
      };
    });
    const totalViews = engagement.reduce((s, e) => s + e.viewCount, 0);
    const totalLikes = engagement.reduce((s, e) => s + e.likeCount, 0);
    const totalComments = engagement.reduce((s, e) => s + e.commentCount, 0);
    const avgViews = engagement.length > 0 ? Math.round(totalViews / engagement.length) : 0;

    await this.store.storeIntelligence(collectionId, 'engagement_analytics', {
      totalVideos: engagement.length, totalViews, totalLikes, totalComments, avgViews,
      topByViews: [...engagement].sort((a, b) => b.viewCount - a.viewCount).slice(0, 10),
      highPassion: [...engagement].sort((a, b) => b.commentRate - a.commentRate).slice(0, 10),
      allVideos: engagement,
    });
    console.log(`  Intelligence merged: ${Object.keys(merged).join(', ')}`);
    console.log(`  Engagement: ${engagement.length} sources, ${totalViews} total views`);
  }

  // ── CPPV: Voice Profile From Video/Podcast Content (TDE-native) ──────────────
  // Builds a spoken-style fingerprint from atoms that originated in video or audio
  // sources ONLY. Emails, PDFs, web articles, pasted text, etc. are strictly excluded.
  // Stored with keepHistory=true so quarterly refreshes preserve what CPPV was
  // active when a given piece of content was composed (audit trail).
  //
  // CPPW (written-style fingerprint from emails) is NOT built here. It is produced
  // externally by TrueWriting's on-prem email analyzer and pushed to TDE via
  // POST /api/cppw/:collectionId.

  async _buildCPPV(collectionId) {
    const apiUrl = (config.TRUEWRITING_API_URL || '').replace(/\/+$/, '');
    if (!apiUrl) { console.log(`  CPPV: TRUEWRITING_API_URL not configured — skipping`); return null; }

    const VIDEO_AUDIO_TYPES = new Set(['youtube', 'audio', 'podcast', 'mp3', 'mp4']);

    const sources = await this.store.getSources(collectionId);
    const readySources = sources.filter(s => s.status === 'ready');
    const videoAudioSources = readySources.filter(s => VIDEO_AUDIO_TYPES.has(s.source_type));

    if (videoAudioSources.length === 0) {
      console.log(`  CPPV: no video/audio sources in collection (have ${readySources.length} total ready, none video/audio)`);
      return null;
    }

    // Sample sources to avoid overwhelming memory on large collections.
    // 50 sources spread across the timeline gives TrueWriting broad stylistic
    // coverage without 138+ database queries crashing the server.
    const MAX_SOURCES = 50;
    let sampled = videoAudioSources;
    if (videoAudioSources.length > MAX_SOURCES) {
      const step = Math.floor(videoAudioSources.length / MAX_SOURCES);
      sampled = videoAudioSources.filter((_, i) => i % step === 0).slice(0, MAX_SOURCES);
      console.log(`  CPPV: sampled ${sampled.length} of ${videoAudioSources.length} video/audio sources (spread across timeline)`);
    }

    const segments = [];
    for (const source of sampled) {
      const atoms = await this.store.getAtoms(collectionId, source.id);
      const fullText = atoms.map(a => a.text).join(' ');
      if (fullText.length > 20) {
        const meta = typeof source.metadata === 'string' ? JSON.parse(source.metadata || '{}') : (source.metadata || {});
        segments.push({
          text: fullText,
          source_id: source.id,
          source_type: source.source_type,
          title: source.title || '',
          date: source.published_at || meta.publishedAt || null,
        });
      }
    }

    if (segments.length < 3) {
      console.log(`  CPPV: Need 3+ video/audio sources (have ${segments.length})`);
      return null;
    }

    // Send ALL segments for full stylistic breadth, but cap each segment's text
    // to ~2000 words so the total payload stays manageable. TrueWriting sees the
    // full range of topics/contexts (travel vlog vs restaurant review vs interview)
    // which matters more for voice fingerprinting than having every word from fewer videos.
    const MAX_WORDS_PER_SEGMENT = 2000;
    const selectedSegments = segments.map(seg => {
      const words = seg.text.split(/\s+/);
      if (words.length <= MAX_WORDS_PER_SEGMENT) return seg;
      return { ...seg, text: words.slice(0, MAX_WORDS_PER_SEGMENT).join(' ') };
    });
    const totalWords = selectedSegments.reduce((s, seg) => s + seg.text.split(/\s+/).length, 0);
    console.log(`  CPPV: ${selectedSegments.length} segments, ~${totalWords} words total (capped at ${MAX_WORDS_PER_SEGMENT}/segment)`);

    console.log(`\n  Building CPPV via TrueWriting API (${selectedSegments.length} video/audio sources)...`);
    try {
      const resp = await fetch(`${apiUrl}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_type: 'transcript',
          profile_type: 'cppv', // hint to TrueWriting that this is spoken content
          segments: selectedSegments,
          min_words: 50,
        }),
      });
      if (!resp.ok) {
        const errBody = await resp.text().catch(() => 'no body');
        console.log(`  CPPV: TrueWriting API error ${resp.status}: ${errBody.slice(0, 200)}`);
        // Store the error so build-cppv endpoint can report it
        this._lastCPPVError = `TrueWriting API returned ${resp.status}: ${errBody.slice(0, 200)}`;
        return null;
      }
      const profile = await resp.json();

      // Wrap with metadata so the stored record is self-describing for audit + recomposition
      const record = {
        profile,
        profile_type: 'CPPV',
        source_modality: 'spoken',
        built_at: new Date().toISOString(),
        sources_used: segments.map(s => ({ source_id: s.source_id, source_type: s.source_type, title: s.title })),
        source_count: segments.length,
      };
      await this.store.storeIntelligence(collectionId, 'cppv', record, { keepHistory: true });
      console.log(`  CPPV stored (${segments.length} sources, versioned)`);
      return record;
    } catch (err) {
      console.log(`  CPPV: TrueWriting unreachable (${err.message})`);
      return null;
    }
  }

  // ── Voice Profile Cascade: CPPW → CPPV → none ────────────────────────────────
  // Used by reconstruct() and any caller that needs to compose written content
  // in a specific person's voice. CPPW (built externally from their emails) is
  // preferred because it captures written style directly; CPPV (built here from
  // their videos/podcasts) is a reasonable fallback because it captures
  // communicative style from speech. Never mix the two.

  async getVoiceProfile(collectionId) {
    const cppw = await this.store.getIntelligence(collectionId, 'cppw');
    if (cppw && cppw.data && Object.keys(cppw.data).length > 0) {
      return { profile: cppw.data, type: 'CPPW' };
    }
    const cppv = await this.store.getIntelligence(collectionId, 'cppv');
    if (cppv && cppv.data && Object.keys(cppv.data).length > 0) {
      return { profile: cppv.data, type: 'CPPV' };
    }
    return { profile: null, type: 'none' };
  }

  // ── Stats & Intelligence ──────────────────────────────────────────────────────

  async deleteSource(collectionId, sourceId) { return this.store.deleteSource(collectionId, sourceId); }

  async getStats(collectionId)               { return this.store.getStats(collectionId); }
  async getIntelligence(collectionId, type)  { return this.store.getIntelligence(collectionId, type); }
  async getSources(collectionId)             { return this.store.getSources(collectionId); }
  async getAtoms(collectionId, sourceId, filters) { return this.store.getAtoms(collectionId, sourceId, filters); }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = TDEngine;
