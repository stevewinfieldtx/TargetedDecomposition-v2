/**
 * TDE — Targeted Decomposition Engine
 * Configuration
 * ═══════════════════════════════════════════════════════════════════
 * Dual taxonomy: DIMENSIONS (9D atom tagging) + TEMPLATES (vertical extractors)
 */

require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 8400,

  // OpenRouter
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '',
  OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',

  // Anthropic direct (used for Batch API on non-realtime work — 50% discount vs realtime)
  ANTHROPIC_API_KEY:     process.env.ANTHROPIC_API_KEY     || '',
  ANTHROPIC_BASE_URL:    process.env.ANTHROPIC_BASE_URL    || 'https://api.anthropic.com',
  ANTHROPIC_BATCH_MODEL: process.env.ANTHROPIC_BATCH_MODEL || 'claude-sonnet-4-6',

  // Cerebras direct (used for user-facing retrieval — reconstruct() and ask())
  CEREBRAS_API_KEY:  process.env.CEREBRAS_API_KEY  || '',
  CEREBRAS_BASE_URL: process.env.CEREBRAS_BASE_URL || 'https://api.cerebras.ai/v1',
  CEREBRAS_MODEL:    process.env.CEREBRAS_MODEL    || 'llama-3.3-70b',

  // Models
  ANALYSIS_MODEL:  process.env.ANALYSIS_MODEL  || 'qwen/qwen-2.5-72b-instruct',
  CONTENT_MODEL:   process.env.CONTENT_MODEL   || 'meta-llama/llama-3.1-70b-instruct',
  EMBEDDING_MODEL: process.env.EMBEDDING_MODEL || 'mistralai/mistral-embed-2312',

  // External services
  YOUTUBE_API_KEY:    process.env.YOUTUBE_API_KEY    || '',
  GROQ_API_KEY:       process.env.GROQ_API_KEY       || '',
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY || '',

  // Service APIs
  TRUEWRITING_API_URL: process.env.TRUEWRITING_API_URL || '',
  TRUEGRAPH_API_URL:   process.env.TRUEGRAPH_API_URL   || '',

  // FalkorDB (TrueGraph relationship intelligence)
  FALKORDB_HOST: process.env.FALKORDB_HOST || '',
  FALKORDB_PORT: parseInt(process.env.FALKORDB_PORT || '6379'),
  FALKORDB_PASSWORD: process.env.FALKORDB_PASSWORD || '',

  // Storage
  DATABASE_URL:        process.env.DATABASE_URL       || '',
  QDRANT_URL:          process.env.QDRANT_URL         || '',
  QDRANT_API_KEY:      process.env.QDRANT_API_KEY     || '',
  EMBEDDING_DIMENSION: parseInt(process.env.EMBEDDING_DIMENSION || '1024'),
  DATA_DIR:            process.env.DATA_DIR           || './data',

  // API security
  API_SECRET_KEY: process.env.API_SECRET_KEY || '',

  // ── 9D Taxonomy ────────────────────────────────────────────────────────────
  // The nine dimensions every atom is tagged across.
  // Edit these values to tune for your domain.

  DIMENSIONS: {
    persona: ['Executive/C-Suite', 'CFO/Finance', 'CISO/Security', 'CTO/IT', 'VP Sales', 'VP Marketing', 'Operations', 'Practitioner', 'End User', 'General'],
    buying_stage: ['Awareness', 'Interest', 'Evaluation', 'Decision', 'Retention', 'Advocacy'],
    emotional_driver: ['Fear/Risk', 'Aspiration/Growth', 'Validation/Proof', 'Curiosity', 'Trust/Credibility', 'Urgency', 'FOMO'],
    evidence_type: ['Statistic/Data', 'Case Study', 'Analyst Report', 'Customer Quote', 'Framework/Model', 'Anecdote/Story', 'Expert Opinion', 'Product Demo', 'Comparison', 'Definition'],
    credibility: [1, 2, 3, 4, 5],
    recency_tier: ['Current Quarter', 'This Year', 'Last 1-2 Years', 'Dated (3-5yr)', 'Evergreen'],
    economic_driver: ['Cost Reduction', 'Revenue Growth', 'Risk Mitigation', 'Operational Efficiency', 'Compliance/Regulatory', 'Competitive Advantage', 'Innovation/R&D', 'Talent/Retention', 'None/General'],
    status_quo_pressure: ['High - Active Pain', 'Medium - Growing Concern', 'Low - Nice to Have', 'Counter - Switching Cost Fear', 'None/Neutral'],
    industry: 'NAICS/SIC object',
  },

  // ── Default Munger Profile ─────────────────────────────────────────────────
  // These values are used when a template doesn't specify its own mungerProfile.
  DEFAULT_MUNGER_PROFILE: {
    windowWords: 600,
    windowOverlap: 100,
    minAtomWords: 8,
    maxAtomWords: 120,
    confidenceThreshold: 0.5,
    extractionHint: '',
  },

  // ── Collection Templates ──────────────────────────────────────────────────
  TEMPLATES: {

    influencer: {
      id: 'influencer',
      name: 'TrueInfluence',
      description: 'Content creator / influencer — voice, topics, products, and audience intel',
      extractors: ['communication', 'topics', 'food', 'products', 'comments'],
      mungerProfile: {
        windowWords: 400,
        windowOverlap: 100,
        minAtomWords: 6,
        maxAtomWords: 150,
        confidenceThreshold: 0.3,
        extractionHint: 'This is a content creator whose exact words are extremely valuable. Extract EVERYTHING: every opinion, recommendation, product mention, personal story, catchphrase, reaction, joke, aside, cultural reference, place name, brand mention, relationship to audience, and distinctive take. Preserve the creator\'s exact phrasing — their word choices ARE the product. Do not skip casual comments or asides; these often contain the creator\'s most authentic voice. Even throwaway lines reveal personality and preferences that matter for building their communication profile.',
      },
    },

    church: {
      id: 'church',
      name: 'TrueTeachings',
      description: 'Sermon and religious content — verse extraction and theological themes',
      extractors: ['communication', 'topics', 'religion', 'comments'],
      mungerProfile: {
        windowWords: 400,
        windowOverlap: 80,
        minAtomWords: 6,
        maxAtomWords: 150,
        confidenceThreshold: 0.35,
        extractionHint: 'This is a sermon or religious teaching. Extract EVERY theological point, scripture reference (book chapter:verse), practical application, illustration, personal story, key phrase, and call to action. Preserve the preacher\'s exact words for memorable phrases and emotional moments. Theological nuance matters — do not simplify or generalize doctrinal points. If the speaker references a Bible verse, include the full reference (e.g. "Romans 8:28") in the atom text.',
      },
      sermonFields: [
        'sermon_title', 'series_name', 'verse_reference', 'theme',
        'message_summary', 'audience_application', 'connected_verses',
        'emotional_intensity', 'timestamp',
      ],
    },

    food: {
      id: 'food',
      name: 'TrueFood',
      description: 'Food influencer — every restaurant, dish, and opinion extracted',
      extractors: ['communication', 'food', 'products', 'comments'],
      mungerProfile: {
        windowWords: 400,
        windowOverlap: 100,
        minAtomWords: 6,
        maxAtomWords: 130,
        confidenceThreshold: 0.3,
        extractionHint: 'This is food/restaurant content and the creator\'s exact words are the product. Extract EVERYTHING: every restaurant name, dish name, ingredient mention, food description, taste opinion, texture comment, price mention, location detail, recommendation, comparison to other food, cooking technique, cultural context, personal food memory, and even casual reactions like "oh my god" or "this is insane." Preserve the creator\'s exact phrasing — their specific way of describing food is what makes them unique. Do not skip negative reactions or mixed opinions; those are as valuable as praise.',
      },
    },

    influencereats: {
      id: 'influencereats',
      name: 'InfluencerEats',
      description: 'Food discovery map — restaurant pins with structured review data',
      extractors: ['communication', 'food', 'comments'],
      mungerProfile: {
        windowWords: 400,
        windowOverlap: 100,
        minAtomWords: 6,
        maxAtomWords: 130,
        confidenceThreshold: 0.3,
        extractionHint: 'This is a food review or restaurant visit video and the creator\'s exact words are the product. Extract EVERYTHING: every restaurant name, specific dish ordered, location/neighborhood, price if mentioned, the reviewer\'s opinion of each dish using their exact words, reactions to ambiance, service comments, comparisons to other restaurants, and any personal stories or preferences revealed. If the reviewer visits multiple restaurants, keep each one\'s data separate. Preserve casual reactions — "dude this is fire" is as important as a formal review.',
      },
      pinSchema: {
        restaurant_name:     'string',
        restaurant_location: 'string — city, neighborhood, or address',
        food_selected:       'string — dish ordered',
        food_review:         'string — direct quote from creator',
        rating:              'good | meh | bad',
        video_timestamp:     'MM:SS',
        source_video_id:     'string',
        source_channel:      'string',
        confidence:          '0.0 – 1.0',
      },
    },

    business: {
      id: 'business',
      name: 'TrueComms',
      description: 'Business communication, competitive intelligence, Pretty Good Pitch',
      extractors: ['communication', 'topics', 'objections', 'competitive', 'pitch_ready'],
      mungerProfile: {
        windowWords: 600,
        windowOverlap: 100,
        minAtomWords: 8,
        maxAtomWords: 120,
        confidenceThreshold: 0.5,
        extractionHint: 'This is business/sales content. Extract every claim, data point, competitive differentiator, customer proof point, pricing signal, objection, and strategic insight. Preserve specifics: dollar amounts, percentages, customer names, product names.',
      },
    },

    couple: {
      id: 'couple',
      name: 'TrueCouple',
      description: 'Couple content creators — speaker-separated analysis',
      extractors: ['communication', 'topics', 'food', 'products', 'speaker_separation', 'comments'],
      mungerProfile: {
        windowWords: 400,
        windowOverlap: 100,
        minAtomWords: 6,
        maxAtomWords: 130,
        confidenceThreshold: 0.3,
        extractionHint: 'This is a couple/duo content video and both creators\' exact words are the product. Extract EVERYTHING from both speakers: opinions, disagreements, jokes, reactions, stories, recommendations, and banter. When possible, attribute statements to a specific speaker. Capture moments where they disagree or have different perspectives as separate atoms — those differences define their dynamic. Preserve casual remarks, inside jokes, and affectionate teasing; these build the communication personality.',
      },
    },

    education: {
      id: 'education',
      name: 'TrueTeach',
      description: 'Educational content — topics, depth, and audience questions',
      extractors: ['communication', 'topics', 'comments'],
      mungerProfile: {
        windowWords: 500,
        windowOverlap: 100,
        minAtomWords: 8,
        maxAtomWords: 140,
        confidenceThreshold: 0.4,
        extractionHint: 'This is educational/instructional content. Extract every concept explanation, definition, example, step-by-step instruction, key principle, and practical tip. Preserve technical accuracy — do not simplify jargon if the content is technical. Capture the logical flow of the teaching.',
      },
    },

    default: {
      id: 'default',
      name: 'TDE',
      description: 'General content intelligence — use this when no vertical fits',
      extractors: ['communication', 'topics', 'comments'],
      // Uses DEFAULT_MUNGER_PROFILE (no override)
    },
  },
};
