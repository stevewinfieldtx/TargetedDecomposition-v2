/**
 * FitScore — ICP Scoring routes for TDE.
 * ═══════════════════════════════════════════════════════════════════
 * Native TDE layer that scores companies against an ICP rubric and mines
 * patterns. Reuses TDE's collections, company_intel cache, research and
 * reconstruct. No separate database:
 *   - rubric           -> solution collection's metadata.fitscore_rubric
 *   - per-lead score   -> company_intel.fitscore[<solutionCollectionId>]
 *
 * Mount (server.js, inside the pg-ready block):
 *   require('./routes/icp-routes')(app, auth, engine.store.pg, engine);
 */
const { scoreFromSignals } = require('../core/fitscore/scoring');
const { resolveSignals } = require('../core/fitscore/signals');
const { getFirmographics, bareDomain } = require('../core/fitscore/firmographics');
const { generateRubric } = require('../core/fitscore/rubric');
const { mine } = require('../core/fitscore/miner');
const path = require('path');
const { runSwarm, runDeepFill, msipToText } = require('../core/solution-research');

const ICP_TTL_DAYS = parseInt(process.env.ICP_TTL_DAYS || '30', 10);
function isFresh(iso, days) { return iso ? (Date.now() - new Date(iso).getTime()) < days * 86400000 : false; }
function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

const ICP_QUERY =
  'Define the Ideal Customer Profile (ICP) for this vendor/solution based on what it does, who it serves, ' +
  'and the pains it solves. Return JSON with keys: summary (1-2 sentences), target_industries (array), ' +
  'company_size (object: employees, revenue), geographies (array), buyer_personas (array of {title, role}), ' +
  'key_pain_points (array), buying_triggers (array), disqualifiers (array), signals_to_look_for (array), ' +
  'example_fit_companies (array).';

module.exports = (app, auth, pg, engine) => {
  // ── one-time additive migration: fitscore column on company_intel ──
  (async () => {
    try {
      await pg.query("ALTER TABLE IF EXISTS company_intel ADD COLUMN IF NOT EXISTS fitscore JSONB DEFAULT '{}'::jsonb");
      console.log('  FitScore (ICP): routes ready, company_intel.fitscore ensured');
    } catch (e) { console.log('  FitScore (ICP): migration note — ' + e.message); }
  })();

  // ── helpers ──────────────────────────────────────────────────────
  const meta = (col) => (typeof col.metadata === 'string' ? safeJson(col.metadata) : (col.metadata || {}));

  async function saveCollectionMeta(id, m) {
    if (engine.store._usePg && engine.store._usePg()) {
      await pg.query('UPDATE collections SET metadata = $1, updated_at = NOW() WHERE id = $2', [JSON.stringify(m), id]);
    } else if (engine.store.db) {
      engine.store.db.prepare('UPDATE collections SET metadata = ? WHERE id = ?').run(JSON.stringify(m), id);
    }
  }

  async function getRubric(collectionId) {
    const col = await engine.getCollection(collectionId);
    if (!col) return null;
    return meta(col).fitscore_rubric || null;
  }

  async function getIntelRow(domain) {
    const { rows } = await pg.query('SELECT * FROM company_intel WHERE domain = $1', [bareDomain(domain)]);
    return rows[0] || null;
  }

  async function saveLeadScore(domain, projectId, payload, companyName, website) {
    const d = bareDomain(domain);
    const sql = `
      INSERT INTO company_intel (domain, company_name, website, fitscore, updated_at)
      VALUES ($1, $2, $3, jsonb_build_object($4::text, $5::jsonb), NOW())
      ON CONFLICT (domain) DO UPDATE SET
        fitscore = COALESCE(company_intel.fitscore, '{}'::jsonb) || jsonb_build_object($4::text, $5::jsonb),
        company_name = COALESCE(company_intel.company_name, $2),
        updated_at = NOW()
      RETURNING domain`;
    await pg.query(sql, [d, companyName || d, website || d, projectId, JSON.stringify(payload)]);
  }

  function intelFeatures(row) {
    if (!row) return {};
    const customer = safeJson(row.customer_data);
    const pains = safeJson(row.painpoints_data);
    const sol = safeJson(row.solution_context);
    return {
      industry: row.industry || null,
      country: row.country || null,
      growth_signals: customer.growth_signals || [],
      pain_points: pains.company_pain_points || [],
      buying_triggers: pains.buying_triggers || [],
      technology_stack: sol.technology_stack || [],
    };
  }

  // ── POST /icp/rubric/:collectionId — generate (or set) the ICP rubric ──
  app.post('/icp/rubric/:collectionId', auth, async (req, res) => {
    try {
      const col = await engine.getCollection(req.params.collectionId);
      if (!col) return res.status(404).json({ error: 'Collection not found. Run /research or /upload first.' });
      const rubric = req.body && req.body.rubric ? req.body.rubric : await generateRubric(engine, req.params.collectionId);
      const m = meta(col); m.fitscore_rubric = rubric;
      await saveCollectionMeta(req.params.collectionId, m);
      res.json({ ok: true, collectionId: req.params.collectionId, rubric });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── GET /icp/rubric/:collectionId ──
  app.get('/icp/rubric/:collectionId', auth, async (req, res) => {
    try {
      const rubric = await getRubric(req.params.collectionId);
      if (!rubric) return res.status(404).json({ error: 'No rubric yet. POST /icp/rubric/:collectionId to generate one.' });
      res.json(rubric);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── POST /icp/score/:collectionId — score one lead ──
  // body: { domain, company_name?, url? }
  app.post('/icp/score/:collectionId', auth, async (req, res) => {
    try {
      const projectId = req.params.collectionId;
      const { domain, company_name, url } = req.body || {};
      if (!domain && !url) return res.status(400).json({ error: 'domain or url required' });
      const dom = bareDomain(domain || url);

      const rubric = await getRubric(projectId);
      if (!rubric) return res.status(400).json({ error: 'Generate a rubric first: POST /icp/rubric/' + projectId });

      const intelRow = await getIntelRow(dom);            // qualitative intel from TDE (may be null)
      const firmographics = await getFirmographics(dom);  // hard signals: Apollo + DNS

      const signals = resolveSignals(rubric, intelRow || {}, firmographics);
      const { score, colour } = scoreFromSignals(rubric, signals);

      const features = { ...firmographics, intel: intelFeatures(intelRow) };
      const payload = {
        score, colour, signals, features,
        status: 'new', assigned_to: null,
        intel_available: !!intelRow,
        scored_at: new Date().toISOString(),
      };
      await saveLeadScore(dom, projectId, payload, company_name || (intelRow && intelRow.company_name), url || dom);

      res.json({
        ok: true, domain: dom, company_name: payload.features ? (company_name || (intelRow && intelRow.company_name) || dom) : dom,
        score, colour, signals,
        intel_available: !!intelRow,
        hint: intelRow ? undefined : 'No TDE company_intel yet — run POST /intel/research/company for richer signals.',
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── GET /icp/leads/:collectionId — list scored leads for this project ──
  app.get('/icp/leads/:collectionId', auth, async (req, res) => {
    try {
      const projectId = req.params.collectionId;
      const { rows } = await pg.query('SELECT domain, company_name, fitscore FROM company_intel WHERE fitscore ? $1', [projectId]);
      const leads = rows.map((r) => {
        const fs = (typeof r.fitscore === 'string' ? safeJson(r.fitscore) : r.fitscore)[projectId] || {};
        return { domain: r.domain, company_name: r.company_name, score: fs.score ?? null,
          colour: fs.colour ?? null, status: fs.status ?? 'new', assigned_to: fs.assigned_to ?? null };
      }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
      res.json({ collectionId: projectId, count: leads.length, leads });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── PATCH /icp/leads/:collectionId/:domain — assign / set status ──
  app.patch('/icp/leads/:collectionId/:domain', auth, async (req, res) => {
    try {
      const projectId = req.params.collectionId;
      const dom = bareDomain(req.params.domain);
      const row = await getIntelRow(dom);
      if (!row) return res.status(404).json({ error: 'Lead not found' });
      const fitscore = (typeof row.fitscore === 'string' ? safeJson(row.fitscore) : row.fitscore) || {};
      const entry = fitscore[projectId];
      if (!entry) return res.status(404).json({ error: 'Lead not scored for this project' });
      if (req.body.status !== undefined) entry.status = req.body.status;
      if (req.body.assigned_to !== undefined) entry.assigned_to = req.body.assigned_to;
      await pg.query('UPDATE company_intel SET fitscore = COALESCE(fitscore, \'{}\'::jsonb) || jsonb_build_object($1::text,$2::jsonb), updated_at=NOW() WHERE domain=$3',
        [projectId, JSON.stringify(entry), dom]);
      res.json({ ok: true, domain: dom, status: entry.status, assigned_to: entry.assigned_to });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── POST /icp/analyze/:collectionId — Section 9 pattern mining ──
  app.post('/icp/analyze/:collectionId', auth, async (req, res) => {
    try {
      const projectId = req.params.collectionId;
      const leads = await loadMinerLeads(projectId);
      const result = mine(leads,
        req.body && req.body.top_colours ? new Set(req.body.top_colours) : undefined,
        req.body && req.body.bottom_colours ? new Set(req.body.bottom_colours) : undefined);
      res.json({
        cohorts: { top_n: result.top_n, bottom_n: result.bottom_n },
        findings: result.findings, suggested_signals: result.suggested_signals,
        hidden_gems: result.hidden_gems, notes: result.notes,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── POST /icp/rubric/:collectionId/apply — append accepted suggestions ──
  app.post('/icp/rubric/:collectionId/apply', auth, async (req, res) => {
    try {
      const projectId = req.params.collectionId;
      const keys = (req.body && req.body.keys) || [];
      const col = await engine.getCollection(projectId);
      const m = meta(col);
      const rubric = m.fitscore_rubric;
      if (!rubric) return res.status(400).json({ error: 'No rubric to extend' });

      const leads = await loadMinerLeads(projectId);
      const byKey = Object.fromEntries(mine(leads).suggested_signals.map((s) => [s.key, s]));
      const existing = new Set((rubric.signals || []).map((s) => s.key));
      const added = [];
      for (const key of keys) {
        const s = byKey[key];
        if (!s || existing.has(key)) continue;
        rubric.signals.push({ key: s.key, label: s.label, weight: s.suggested_weight, type: s.type, description: s.rationale, source: 'pattern_miner' });
        added.push(key);
      }
      m.fitscore_rubric = rubric;
      await saveCollectionMeta(projectId, m);
      res.json({ ok: true, added, rubric });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Resolve a vendor/solution name to a domain (Serper if available) ──
  async function resolveDomain(name, url) {
    if (url) return bareDomain(url);
    if (/\./.test(name) && !/\s/.test(name)) return bareDomain(name); // already a domain
    if (process.env.SERPER_API_KEY) {
      try {
        const r = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: name + ' official website', num: 3 }),
          signal: AbortSignal.timeout(15000),
        });
        if (r.ok) {
          const j = await r.json();
          const link = j.organic && j.organic[0] && j.organic[0].link;
          if (link) return bareDomain(link);
        }
      } catch { /* fall through to guess */ }
    }
    return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '') + '.com';
  }

  async function buildIcpProfile(collectionId, vendor) {
    // Vendor-agnostic discriminator generator (sharp, web-findable variables)
    const icpGen = require('../core/fitscore/icp_generator');
    return icpGen.generate(engine, collectionId, vendor || {});
  }

  // Pull high-value pages that reveal who a vendor actually sells to.
  async function ingestEvidencePages(collectionId, baseUrl, label) {
    const base = baseUrl.replace(/\/+$/, '');
    const paths = ['customers', 'case-studies', 'case-study', 'success-stories',
      'integrations', 'partners', 'clients'];
    for (const p of paths) {
      try { await engine.ingest(collectionId, 'web', base + '/' + p, { title: label + ' — ' + p }); }
      catch { /* page may not exist; skip */ }
    }
  }

  // ── PUBLIC: generate-or-fetch an ICP for a vendor/solution (powers the Drix page) ──
  // body: { name?, url?, type? ("vendor"|"solution"), force? }
  app.post('/icp/profile', async (req, res) => {
    try {
      const { name, url, type, force } = req.body || {};
      if (!name && !url) return res.status(400).json({ error: 'Provide a vendor/solution name or website URL' });

      const domain = await resolveDomain(name, url);
      const collectionId = 'icp_' + domain.replace(/[^a-z0-9]+/gi, '_').toLowerCase();

      // 1) cache check (stored in TDE on the collection)
      const existing = await engine.getCollection(collectionId);
      if (existing && !force) {
        const m = meta(existing);
        if (m.icp_profile && isFresh(m.icp_profile.generated_at, ICP_TTL_DAYS)) {
          return res.json({ cached: true, ...m.icp_profile });
        }
      }

      const researchUrl = url || ('https://' + domain);

      // 2) ensure collection + research (swarm) on first time / stale
      const collection = existing || await engine.createCollection(
        collectionId, name || domain, 'ICP research',
        { template: { id: 'business' }, templateId: 'business',
          resource_type: type === 'solution' ? 'Solution' : 'Vendor', solutionUrl: researchUrl });

      let stats = { atomCount: 0 };
      try { stats = await engine.getStats(collectionId); } catch { /* none yet */ }
      if ((stats.atomCount || 0) < 20 || force) {
        let webContent = '';
        try { const { extractWeb } = require('../ingest/web'); webContent = (await extractWeb(researchUrl)).text || ''; } catch { /* ok */ }
        const swarm = await runSwarm(researchUrl, name, webContent);
        const msipText = msipToText(swarm.msip, researchUrl);
        if (msipText.length > 100) await engine.ingest(collectionId, 'text', msipText, { title: (name || domain) + ' — MSIP' });
        if (webContent.length > 200) await engine.ingest(collectionId, 'web', researchUrl, { title: (name || domain) + ' — Website' }).catch(() => {});
        // evidence pages reveal who they actually sell to -> sharper discriminators
        await ingestEvidencePages(collectionId, researchUrl, name || domain);
        await new Promise((r) => setTimeout(r, 2500));
        runDeepFill(engine, collectionId, researchUrl, name, swarm.msip).catch(() => {}); // background enrichment
      }

      // 3) synthesize ICP + cache it in TDE
      const profile = await buildIcpProfile(collectionId, { name: name || domain, domain });
      const record = {
        vendor: { name: name || domain, domain, url: researchUrl, type: type || 'vendor' },
        profile, generated_at: new Date().toISOString(), ttl_days: ICP_TTL_DAYS,
      };
      const m2 = meta(collection); m2.icp_profile = record;
      await saveCollectionMeta(collectionId, m2);

      res.json({ cached: false, ...record });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── PUBLIC: fetch a cached ICP if one exists ──
  app.get('/icp/profile/:domain', async (req, res) => {
    try {
      const domain = bareDomain(req.params.domain);
      const col = await engine.getCollection('icp_' + domain.replace(/[^a-z0-9]+/gi, '_').toLowerCase());
      const m = col ? meta(col) : {};
      if (!m.icp_profile) return res.status(404).json({ error: 'No ICP cached for ' + domain });
      res.json({ cached: true, fresh: isFresh(m.icp_profile.generated_at, ICP_TTL_DAYS), ...m.icp_profile });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── PUBLIC: serve the Drix ICP page ──
  const icpPage = (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'icp.html'));
  app.get('/icp', icpPage);
  app.get('/ideal-customer-profile', icpPage);

  async function loadMinerLeads(projectId) {
    const { rows } = await pg.query('SELECT domain, company_name, fitscore FROM company_intel WHERE fitscore ? $1', [projectId]);
    return rows.map((r) => {
      const fs = (typeof r.fitscore === 'string' ? safeJson(r.fitscore) : r.fitscore)[projectId] || {};
      return { id: r.domain, domain: r.domain, company_name: r.company_name,
        score: fs.score ?? null, colour: fs.colour ?? null, features: fs.features || {} };
    });
  }
};

function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }
