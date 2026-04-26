/**
 * TDE — Research-on-Demand Routes
 * ═══════════════════════════════════════════════════════════════════
 * Provides a "lookup-or-research" pattern for external consumers
 * (e.g., OppIntelAI-Hydration). Three tiers of caching:
 *
 *   1. ATOM CACHE — Real 9D-tagged atoms saved by the consumer after
 *      LLM decomposition. Served directly on cache hit.
 *   2. INTEL CACHE — Structured company/industry data from research
 *      swarm. Used to seed the intel tables but NOT sent as atoms.
 *   3. RUN CACHE — Strategy + pain outputs keyed on the entity combo.
 *      30-day TTL. Prevents re-running expensive LLM synthesis.
 *
 * Mount: require('./routes/research-routes')(app, auth, pg, engine);
 */

const { callLLM } = require('../utils/llm');
const { runSwarm, msipToText } = require('../core/solution-research');
const config = require('../config');
const crypto = require('crypto');

const TTL_DAYS = parseInt(process.env.INTEL_TTL_DAYS) || 30;

module.exports = function mountResearchRoutes(app, auth, pg, engine) {
  if (!pg) {
    console.log('  Research Routes: SKIPPED (no PostgreSQL connection)');
    return;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  function domainFromUrl(url) {
    return (url || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase().trim();
  }

  function slugify(str) {
    return (str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 120);
  }

  function isFresh(timestamp, ttlDays) {
    if (!timestamp) return false;
    const age = Date.now() - new Date(timestamp).getTime();
    return age < (ttlDays || TTL_DAYS) * 24 * 60 * 60 * 1000;
  }

  function runCacheKey(senderDomain, solutionDomain, customerKey, flowMode) {
    const raw = `${senderDomain}|${solutionDomain}|${customerKey}|${flowMode}`;
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 40);
  }

  async function fetchAndStrip(url) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TDE-Research/1.0)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const cleaned = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ').trim();
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : null;
      const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
      const description = descMatch ? descMatch[1].trim() : null;
      return { url, title, description, text: cleaned.slice(0, 40000) };
    } catch (e) {
      throw new Error(`Fetch ${url}: ${e.message}`);
    }
  }

  // ── Company Research Swarm ──────────────────────────────────────────────

  const COMPANY_RESEARCH_AGENTS = [
    {
      id: 'identity',
      name: 'Company Identity Agent',
      prompt: `You are a company research specialist. Given web content about a company, extract:
- company_name: Official company name
- website: Primary website URL
- industry: Primary industry
- sub_industry: More specific sub-industry
- country: HQ country
- employee_estimate: Rough employee count if discoverable
- description: 2-3 sentence company description
- founding_year: Year founded if discoverable
- leadership: Array of key leaders (name, title) if discoverable

Return ONLY valid JSON. No markdown fences.`,
    },
    {
      id: 'pain_landscape',
      name: 'Pain & Challenges Agent',
      prompt: `You are a business analyst. Given web content about a company, identify:
- company_pain_points: Array of 5-8 specific business challenges this company likely faces
- technology_stack: Known or inferred technology they use
- operational_challenges: Array of operational pain points
- market_pressures: External market forces affecting them
- buying_triggers: Events or conditions that would make them buy new solutions

Return ONLY valid JSON. No markdown fences.`,
    },
    {
      id: 'competitive_position',
      name: 'Competitive Position Agent',
      prompt: `You are a competitive intelligence analyst. Given web content about a company, identify:
- competitors: Array of their main competitors
- market_position: Where they sit in the market (leader, challenger, niche, etc.)
- differentiators: What makes them different from competitors
- strengths: Array of 3-5 key strengths
- weaknesses: Array of 3-5 potential weaknesses or vulnerabilities
- partnerships: Known partnerships or alliances

Return ONLY valid JSON. No markdown fences.`,
    },
    {
      id: 'portfolio_signals',
      name: 'Portfolio & Signals Agent',
      prompt: `You are a market research analyst. Given web content about a company, identify:
- products_services: Array of products/services they offer
- target_customers: Who they sell to
- pricing_model: How they price if discoverable
- recent_news: Any recent developments, launches, acquisitions
- growth_signals: Signs of growth or contraction
- certifications: Any compliance or industry certifications

Return ONLY valid JSON. No markdown fences.`,
    },
  ];

  async function runCompanySwarm(url, webContent) {
    const model = config.ANALYSIS_MODEL;
    const context = `COMPANY URL: ${url}\n\nWEBSITE CONTENT:\n${(webContent || '').slice(0, 8000)}`;

    console.log(`  [Company Swarm] Launching ${COMPANY_RESEARCH_AGENTS.length} agents for ${url}...`);
    const t0 = Date.now();

    const results = await Promise.allSettled(
      COMPANY_RESEARCH_AGENTS.map(async (agent) => {
        const prompt = agent.prompt + '\n\n' + context;
        try {
          const raw = await callLLM(prompt, {
            model,
            system: 'You are a research agent. Return only valid JSON.',
            maxTokens: 3000,
            temperature: 0.2,
          });
          if (!raw) return { agentId: agent.id, error: 'No response' };
          const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
          try {
            const parsed = JSON.parse(cleaned);
            console.log(`  [Company Swarm] ${agent.name}: done`);
            return { agentId: agent.id, data: parsed };
          } catch (e) {
            console.log(`  [Company Swarm] ${agent.name}: JSON parse failed`);
            return { agentId: agent.id, data: null, raw };
          }
        } catch (err) {
          console.log(`  [Company Swarm] ${agent.name}: error — ${err.message}`);
          return { agentId: agent.id, error: err.message };
        }
      })
    );

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  [Company Swarm] Complete in ${elapsed}s`);

    const merged = {};
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.data) {
        Object.assign(merged, r.value.data);
      }
    }
    return { data: merged, elapsed: parseFloat(elapsed) };
  }

  // ── Industry Research ──────────────────────────────────────────────────

  async function researchIndustry(industryName, subIndustry) {
    const prompt = `You are an industry research analyst. Research the following industry and provide comprehensive intelligence.

INDUSTRY: ${industryName}
${subIndustry ? `SUB-INDUSTRY: ${subIndustry}` : ''}

Return a JSON object with:
- industry_name: "${industryName}"
- sub_industries: Array of 5-10 major sub-industries/segments
- sic_codes: Array of relevant SIC codes (e.g., ["7372", "7371"])
- naics_codes: Array of relevant NAICS codes (e.g., ["511210", "518210"])
- pain_points: Array of objects { title, description, urgency: "high"|"medium"|"low", persona }
- trends: Array of objects { title, description, impact: "high"|"medium"|"low" }
- regulations: Array of objects { name, description, impact }
- tech_landscape: Object { dominant_platforms, emerging_tech, legacy_systems }
- observations: Array of key market observations

Return ONLY valid JSON. No markdown fences.`;

    const raw = await callLLM(prompt, {
      model: config.ANALYSIS_MODEL,
      system: 'You are an industry research analyst. Return only valid JSON.',
      maxTokens: 4000,
      temperature: 0.3,
    });

    if (!raw) throw new Error('Industry research returned no response');
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    return JSON.parse(cleaned);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // POST /intel/research/company
  // Lookup a company by URL. Returns cached atoms if available.
  // If no atoms cached, returns { has_atoms: false } so consumer knows
  // to do its own LLM decomposition and save atoms back via PUT.
  //
  // Body: { url, role, name? }
  // Returns: { source, domain, has_atoms, atoms?, target?, summary?, intel }
  // ═══════════════════════════════════════════════════════════════════════

  app.post('/intel/research/company', auth, async (req, res) => {
    const { url, role, name } = req.body || {};
    if (!url) return res.status(400).json({ error: 'url is required' });
    if (!role) return res.status(400).json({ error: 'role is required (vendor, solution, customer, partner)' });

    const domain = domainFromUrl(url);
    if (!domain) return res.status(400).json({ error: 'Could not extract domain from url' });

    try {
      // Step 1: Check cache — atoms first, then structured intel
      const { rows } = await pg.query('SELECT * FROM company_intel WHERE domain = $1', [domain]);
      if (rows.length) {
        const row = rows[0];
        const intelFresh = isFresh(row.updated_at, row.ttl_days || TTL_DAYS);
        const atomsFresh = isFresh(row.atoms_cached_at, row.ttl_days || TTL_DAYS);

        // Best case: we have real cached atoms AND they're fresh
        if (atomsFresh && row.cached_atoms && Array.isArray(row.cached_atoms) && row.cached_atoms.length >= 3) {
          console.log(`[Research] Atom cache HIT for ${domain} (${row.cached_atoms.length} atoms, fresh)`);
          return res.json({
            source: 'atom_cache',
            domain,
            company_name: row.company_name,
            role,
            has_atoms: true,
            atoms: row.cached_atoms,
            target: row.cached_target || { name: row.company_name, url, role },
            summary: row.cached_summary || '',
            freshness: {
              atoms_cached_at: row.atoms_cached_at,
              updated_at: row.updated_at,
              ttl_days: row.ttl_days || TTL_DAYS,
              is_fresh: true,
            },
          });
        }

        // Second case: structured intel is fresh but no atoms
        // Consumer will need to do LLM decomposition, but we still have metadata
        if (intelFresh) {
          console.log(`[Research] Intel cache HIT for ${domain} (no atoms — consumer must decompose)`);
          return res.json({
            source: 'intel_cache',
            domain,
            company_name: row.company_name,
            role,
            has_atoms: false,
            intel: {
              company_name: row.company_name,
              website: row.website,
              industry: row.industry,
              sub_industry: row.sub_industry,
              country: row.country,
            },
            freshness: {
              updated_at: row.updated_at,
              ttl_days: row.ttl_days || TTL_DAYS,
              is_fresh: true,
            },
          });
        }

        console.log(`[Research] Cache STALE for ${domain} — re-researching`);
      } else {
        console.log(`[Research] Cache MISS for ${domain} — researching`);
      }

      // Step 2: Fetch the URL
      const webContent = await fetchAndStrip(url);
      if (!webContent.text || webContent.text.length < 100) {
        throw new Error(`Fetched ${url} but got too little content (${(webContent.text || '').length} chars)`);
      }

      // Step 3: Run the appropriate swarm for structured intel
      let swarmResult;
      if (role === 'solution') {
        swarmResult = await runSwarm(url, name || webContent.title, webContent.text);
        const msip = swarmResult.msip || {};
        swarmResult.data = {
          company_name: msip.vendor_name || name || webContent.title || domain,
          description: msip.tagline || '',
          industry: msip.product_category || '',
          products_services: msip.core_capabilities || [],
          competitors: msip.competitors || [],
          target_customers: msip.target_market || '',
          differentiators: msip.differentiators || [],
          company_pain_points: msip.pain_points_solved || [],
          certifications: msip.certifications || [],
          partnerships: msip.integrations || [],
          _msip: msip,
        };
      } else {
        swarmResult = await runCompanySwarm(url, webContent.text);
      }

      const data = swarmResult.data || {};
      const companyName = data.company_name || name || webContent.title || domain;

      // Step 4: Save structured intel to company_intel cache
      const now = new Date().toISOString();
      const painpointsData = {
        company_pain_points: data.company_pain_points || [],
        operational_challenges: data.operational_challenges || [],
        market_pressures: data.market_pressures || [],
        buying_triggers: data.buying_triggers || [],
      };
      const competeData = {
        competitors: data.competitors || [],
        market_position: data.market_position || '',
        strengths: data.strengths || [],
        weaknesses: data.weaknesses || [],
      };
      const customerData = {
        target_customers: data.target_customers || '',
        products_services: data.products_services || [],
        growth_signals: data.growth_signals || [],
        recent_news: data.recent_news || [],
      };
      const solutionContext = role === 'solution' ? (data._msip || {}) : (data.technology_stack ? { technology_stack: data.technology_stack } : {});

      const sql = `
        INSERT INTO company_intel (
          domain, company_name, website, industry, sub_industry,
          country, painpoints_data, compete_data, customer_data, solution_context,
          leadership, tags,
          painpoints_researched_at, compete_researched_at, customer_researched_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13, $13, $13)
        ON CONFLICT (domain) DO UPDATE SET
          company_name = COALESCE($2, company_intel.company_name),
          website = COALESCE($3, company_intel.website),
          industry = COALESCE($4, company_intel.industry),
          sub_industry = COALESCE($5, company_intel.sub_industry),
          country = COALESCE($6, company_intel.country),
          painpoints_data = $7, compete_data = $8,
          customer_data = $9, solution_context = $10,
          leadership = COALESCE($11, company_intel.leadership),
          tags = COALESCE($12, company_intel.tags),
          painpoints_researched_at = $13, compete_researched_at = $13,
          customer_researched_at = $13, updated_at = $13
        RETURNING domain, company_name, updated_at`;

      await pg.query(sql, [
        domain, companyName, url, data.industry || null, data.sub_industry || null,
        data.country || null,
        JSON.stringify(painpointsData), JSON.stringify(competeData),
        JSON.stringify(customerData), JSON.stringify(solutionContext),
        JSON.stringify(data.leadership || []), [role], now,
      ]);

      console.log(`[Research] Saved ${domain} (${companyName}) to intel cache [role=${role}]`);

      // Step 5: Return — has_atoms: false because swarm doesn't produce 9D atoms.
      // Consumer does the real decomposition and saves atoms via PUT /intel/atoms/:domain.
      return res.json({
        source: 'research',
        domain,
        company_name: companyName,
        role,
        has_atoms: false,
        intel: {
          company_name: companyName,
          website: url,
          industry: data.industry || null,
          sub_industry: data.sub_industry || null,
          country: data.country || null,
        },
        swarm_elapsed: swarmResult.elapsed,
        freshness: {
          updated_at: now,
          ttl_days: TTL_DAYS,
          is_fresh: true,
        },
      });
    } catch (err) {
      console.error(`[Research] Error for ${domain}:`, err.message);
      return res.status(502).json({ error: `Research failed: ${err.message}`, domain });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PUT /intel/atoms/:domain
  // Save real 9D-tagged atoms (from consumer's LLM decomposition) to cache.
  // Body: { atoms, target, summary }
  // ═══════════════════════════════════════════════════════════════════════

  app.put('/intel/atoms/:domain', auth, async (req, res) => {
    const domain = domainFromUrl(req.params.domain);
    const { atoms, target, summary } = req.body || {};

    if (!atoms || !Array.isArray(atoms) || atoms.length === 0) {
      return res.status(400).json({ error: 'atoms array is required and must be non-empty' });
    }

    try {
      const now = new Date().toISOString();

      // Upsert: if company_intel row exists, add atoms. If not, create minimal row.
      const sql = `
        INSERT INTO company_intel (domain, company_name, website, cached_atoms, cached_target, cached_summary, atoms_cached_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
        ON CONFLICT (domain) DO UPDATE SET
          cached_atoms = $4,
          cached_target = $5,
          cached_summary = $6,
          atoms_cached_at = $7,
          updated_at = $7
        RETURNING domain, atoms_cached_at`;

      const companyName = target?.name || domain;
      const website = target?.url || domain;

      const { rows } = await pg.query(sql, [
        domain, companyName, website,
        JSON.stringify(atoms),
        JSON.stringify(target || {}),
        summary || '',
        now,
      ]);

      console.log(`[Research] Atoms cached for ${domain}: ${atoms.length} atoms`);
      return res.json({
        ok: true,
        domain,
        atom_count: atoms.length,
        atoms_cached_at: rows[0]?.atoms_cached_at,
      });
    } catch (err) {
      console.error(`[Research] Atom save error for ${domain}:`, err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // POST /intel/research/industry
  // Lookup-or-research an industry. Returns cached atoms if available.
  // Body: { industry, sub_industry? }
  // ═══════════════════════════════════════════════════════════════════════

  app.post('/intel/research/industry', auth, async (req, res) => {
    const { industry, sub_industry } = req.body || {};
    if (!industry) return res.status(400).json({ error: 'industry is required' });

    const key = slugify(industry);

    try {
      const { rows } = await pg.query('SELECT * FROM industry_intel WHERE industry_key = $1', [key]);
      if (rows.length) {
        const row = rows[0];
        const atomsFresh = isFresh(row.atoms_cached_at, row.ttl_days || TTL_DAYS);
        const intelFresh = isFresh(row.updated_at, row.ttl_days || TTL_DAYS);

        // Best case: cached archetype atoms
        if (atomsFresh && row.cached_atoms && Array.isArray(row.cached_atoms) && row.cached_atoms.length >= 3) {
          console.log(`[Research] Industry atom cache HIT for ${key} (${row.cached_atoms.length} atoms)`);
          return res.json({
            source: 'atom_cache',
            industry_key: key,
            has_atoms: true,
            atoms: row.cached_atoms,
            target: row.cached_target || { name: row.industry_name, role: 'customer', is_archetype: true },
            summary: row.cached_summary || '',
            freshness: {
              atoms_cached_at: row.atoms_cached_at,
              updated_at: row.updated_at,
              ttl_days: row.ttl_days || TTL_DAYS,
              is_fresh: true,
            },
          });
        }

        if (intelFresh) {
          console.log(`[Research] Industry intel cache HIT for ${key} (no atoms)`);
          return res.json({
            source: 'intel_cache',
            industry_key: key,
            has_atoms: false,
            intel: {
              industry_name: row.industry_name,
              sub_industries: row.sub_industries,
              sic_codes: row.sic_codes,
              naics_codes: row.naics_codes,
              pain_points: row.pain_points,
              trends: row.trends,
              regulations: row.regulations,
              tech_landscape: row.tech_landscape,
              observations: row.observations,
            },
            freshness: {
              updated_at: row.updated_at,
              ttl_days: row.ttl_days || TTL_DAYS,
              is_fresh: true,
            },
          });
        }
      }

      // Research the industry
      const data = await researchIndustry(industry, sub_industry);
      const now = new Date().toISOString();

      const sql = `
        INSERT INTO industry_intel (
          industry_key, industry_name, sub_industries, sic_codes, naics_codes,
          pain_points, trends, regulations, tech_landscape, observations,
          pain_points_researched_at, trends_researched_at, regulations_researched_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $11, $11)
        ON CONFLICT (industry_key) DO UPDATE SET
          industry_name = COALESCE($2, industry_intel.industry_name),
          sub_industries = COALESCE($3, industry_intel.sub_industries),
          sic_codes = COALESCE($4, industry_intel.sic_codes),
          naics_codes = COALESCE($5, industry_intel.naics_codes),
          pain_points = $6, trends = $7, regulations = $8,
          tech_landscape = $9, observations = $10,
          pain_points_researched_at = $11, trends_researched_at = $11,
          regulations_researched_at = $11, updated_at = $11
        RETURNING industry_key, industry_name, updated_at`;

      await pg.query(sql, [
        key, data.industry_name || industry,
        data.sub_industries || '{}', data.sic_codes || '{}', data.naics_codes || '{}',
        JSON.stringify(data.pain_points || []),
        JSON.stringify(data.trends || []),
        JSON.stringify(data.regulations || []),
        JSON.stringify(data.tech_landscape || {}),
        JSON.stringify(data.observations || []),
        now,
      ]);

      console.log(`[Research] Saved industry ${key} (${industry}) — no atoms yet`);

      return res.json({
        source: 'research',
        industry_key: key,
        has_atoms: false,
        intel: {
          industry_name: data.industry_name || industry,
          sub_industries: data.sub_industries || [],
          pain_points: data.pain_points || [],
          trends: data.trends || [],
        },
        freshness: { updated_at: now, ttl_days: TTL_DAYS, is_fresh: true },
      });
    } catch (err) {
      console.error(`[Research] Industry error for ${key}:`, err.message);
      return res.status(502).json({ error: `Industry research failed: ${err.message}`, industry_key: key });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PUT /intel/atoms/industry/:key
  // Save real archetype atoms for an industry.
  // Body: { atoms, target, summary }
  // ═══════════════════════════════════════════════════════════════════════

  app.put('/intel/atoms/industry/:key', auth, async (req, res) => {
    const key = slugify(req.params.key);
    const { atoms, target, summary } = req.body || {};

    if (!atoms || !Array.isArray(atoms) || atoms.length === 0) {
      return res.status(400).json({ error: 'atoms array is required and must be non-empty' });
    }

    try {
      const now = new Date().toISOString();
      const sql = `
        UPDATE industry_intel
        SET cached_atoms = $2, cached_target = $3, cached_summary = $4, atoms_cached_at = $5, updated_at = $5
        WHERE industry_key = $1
        RETURNING industry_key, atoms_cached_at`;

      const { rows } = await pg.query(sql, [
        key,
        JSON.stringify(atoms),
        JSON.stringify(target || {}),
        summary || '',
        now,
      ]);

      if (!rows.length) {
        return res.status(404).json({ error: `Industry ${key} not found. Research it first.` });
      }

      console.log(`[Research] Industry atoms cached for ${key}: ${atoms.length} atoms`);
      return res.json({ ok: true, industry_key: key, atom_count: atoms.length, atoms_cached_at: now });
    } catch (err) {
      console.error(`[Research] Industry atom save error for ${key}:`, err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // RUN CACHE — Stores pain_groups + strategies for entity combos
  // ═══════════════════════════════════════════════════════════════════════

  // GET /intel/run-cache?sender=<domain>&solution=<domain>&customer=<key>&flow_mode=<mode>
  app.get('/intel/run-cache', auth, async (req, res) => {
    const { sender, solution, customer, flow_mode } = req.query;
    if (!sender || !solution || !customer) {
      return res.status(400).json({ error: 'sender, solution, customer query params required' });
    }

    const key = runCacheKey(sender, solution, customer, flow_mode || 'sell_to_customer');

    try {
      const { rows } = await pg.query('SELECT * FROM run_cache WHERE cache_key = $1', [key]);
      if (!rows.length) {
        return res.json({ found: false, cache_key: key });
      }

      const row = rows[0];
      const fresh = isFresh(row.updated_at, row.ttl_days || TTL_DAYS);
      if (!fresh) {
        return res.json({ found: false, cache_key: key, reason: 'stale' });
      }

      console.log(`[Run Cache] HIT for ${sender}|${solution}|${customer}|${flow_mode}`);
      return res.json({
        found: true,
        cache_key: key,
        pain_groups: row.pain_groups,
        strategies: row.strategies,
        metadata: row.metadata,
        created_at: row.created_at,
        updated_at: row.updated_at,
        ttl_days: row.ttl_days,
      });
    } catch (err) {
      console.error('[Run Cache] Lookup error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  // PUT /intel/run-cache
  // Body: { sender_domain, solution_domain, customer_key, flow_mode, pain_groups, strategies, metadata? }
  app.put('/intel/run-cache', auth, async (req, res) => {
    const { sender_domain, solution_domain, customer_key, flow_mode, pain_groups, strategies, metadata } = req.body || {};

    if (!sender_domain || !solution_domain || !customer_key) {
      return res.status(400).json({ error: 'sender_domain, solution_domain, customer_key required' });
    }
    if (!pain_groups || !strategies) {
      return res.status(400).json({ error: 'pain_groups and strategies required' });
    }

    const mode = flow_mode || 'sell_to_customer';
    const key = runCacheKey(sender_domain, solution_domain, customer_key, mode);

    try {
      const now = new Date().toISOString();
      const sql = `
        INSERT INTO run_cache (cache_key, sender_domain, solution_domain, customer_key, flow_mode, pain_groups, strategies, metadata, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (cache_key) DO UPDATE SET
          pain_groups = $6, strategies = $7, metadata = COALESCE($8, run_cache.metadata), updated_at = $9
        RETURNING cache_key, updated_at`;

      const { rows } = await pg.query(sql, [
        key, sender_domain, solution_domain, customer_key, mode,
        JSON.stringify(pain_groups), JSON.stringify(strategies),
        JSON.stringify(metadata || {}), now,
      ]);

      console.log(`[Run Cache] Saved ${sender_domain}|${solution_domain}|${customer_key}|${mode}`);
      return res.json({ ok: true, cache_key: key, updated_at: rows[0]?.updated_at });
    } catch (err) {
      console.error('[Run Cache] Save error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  console.log('  Research Routes: mounted (/intel/research/*, /intel/atoms/*, /intel/run-cache)');
};
