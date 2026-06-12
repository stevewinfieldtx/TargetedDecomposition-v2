/**
 * PartnerFit — IPP (Ideal Partner Profile) routes for TDE.
 * ═══════════════════════════════════════════════════════════════════
 * Twin of icp-routes.js. Native TDE layer that scores RESELLERS against a
 * vendor's IPP rubric and mines patterns. Reuses TDE's collections,
 * company_intel cache, research and reconstruct. No separate database:
 *   - rubric           -> solution collection's metadata.ipp_rubric
 *   - per-reseller score -> company_intel.ippscore[<solutionCollectionId>]
 *
 * company_intel is a dual ledger: a company can hold a fitscore (as a customer)
 * AND an ippscore (as a partner). The reseller's resolved features live once in
 * company_intel, so every vendor's ipp_rubric can re-weight them — scan a
 * partner once, match it to many vendors.
 *
 * Mount (server.js, inside the pg-ready block):
 *   require('./routes/ipp-routes')(app, auth, engine.store.pg, engine);
 */
const { scoreFromSignals } = require('../core/fitscore/scoring');           // generic, reused
const { getFirmographics, bareDomain } = require('../core/fitscore/firmographics'); // reused
const { mine } = require('../core/fitscore/miner');                          // generic, reused
const { resolvePartnerSignals } = require('../core/partnerfit/signals');
const { generateRubric } = require('../core/partnerfit/rubric');
const { VOCAB_KEYS } = require('../core/partnerfit/vocab');
const path = require('path');
const { runSwarm, runDeepFill, msipToText } = require('../core/solution-research');

const IPP_TTL_DAYS = parseInt(process.env.IPP_TTL_DAYS || process.env.ICP_TTL_DAYS || '30', 10);
function isFresh(iso, days) { return iso ? (Date.now() - new Date(iso).getTime()) < days * 86400000 : false; }

module.exports = (app, auth, pg, engine) => {
  // ── one-time additive migration: ippscore column on company_intel ──
  (async () => {
    try {
      await pg.query("ALTER TABLE IF EXISTS company_intel ADD COLUMN IF NOT EXISTS ippscore JSONB DEFAULT '{}'::jsonb");
      console.log('  PartnerFit (IPP): routes ready, company_intel.ippscore ensured');
    } catch (e) { console.log('  PartnerFit (IPP): migration note — ' + e.message); }
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
    return meta(col).ipp_rubric || null;
  }

  async function getIntelRow(domain) {
    const { rows } = await pg.query('SELECT * FROM company_intel WHERE domain = $1', [bareDomain(domain)]);
    return rows[0] || null;
  }

  async function savePartnerScore(domain, projectId, payload, companyName, website) {
    const d = bareDomain(domain);
    const sql = `
      INSERT INTO company_intel (domain, company_name, website, ippscore, updated_at)
      VALUES ($1, $2, $3, jsonb_build_object($4::text, $5::jsonb), NOW())
      ON CONFLICT (domain) DO UPDATE SET
        ippscore = COALESCE(company_intel.ippscore, '{}'::jsonb) || jsonb_build_object($4::text, $5::jsonb),
        company_name = COALESCE(company_intel.company_name, $2),
        updated_at = NOW()
      RETURNING domain`;
    await pg.query(sql, [d, companyName || d, website || d, projectId, JSON.stringify(payload)]);
  }

  function intelFeatures(row) {
    if (!row) return {};
    const customer = safeJson(row.customer_data);
    const sol = safeJson(row.solution_context);
    const partner = safeJson(row.partner_data);
    return {
      industry: row.industry || null,
      country: row.country || null,
      partner_type: partner.partner_type || null,
      vendor_lines: partner.vendor_lines || [],
      certifications: partner.certifications || [],
      technology_stack: sol.technology_stack || [],
      growth_signals: customer.growth_signals || [],
    };
  }

  // ── POST /ipp/rubric/:collectionId — generate (or set) the IPP rubric ──
  app.post('/ipp/rubric/:collectionId', auth, async (req, res) => {
    try {
      const col = await engine.getCollection(req.params.collectionId);
      if (!col) return res.status(404).json({ error: 'Collection not found. Run /research or /upload first.' });
      const rubric = req.body && req.body.rubric ? req.body.rubric : await generateRubric(engine, req.params.collectionId);
      const m = meta(col); m.ipp_rubric = rubric;
      await saveCollectionMeta(req.params.collectionId, m);
      res.json({ ok: true, collectionId: req.params.collectionId, rubric });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── GET /ipp/rubric/:collectionId ──
  app.get('/ipp/rubric/:collectionId', auth, async (req, res) => {
    try {
      const rubric = await getRubric(req.params.collectionId);
      if (!rubric) return res.status(404).json({ error: 'No rubric yet. POST /ipp/rubric/:collectionId to generate one.' });
      res.json(rubric);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── POST /ipp/score/:collectionId — score one reseller ──
  // body: { domain, company_name?, url? }
  app.post('/ipp/score/:collectionId', auth, async (req, res) => {
    try {
      const projectId = req.params.collectionId;
      const { domain, company_name, url } = req.body || {};
      if (!domain && !url) return res.status(400).json({ error: 'domain or url required' });
      const dom = bareDomain(domain || url);

      const rubric = await getRubric(projectId);
      if (!rubric) return res.status(400).json({ error: 'Generate a rubric first: POST /ipp/rubric/' + projectId });

      const intelRow = await getIntelRow(dom);            // qualitative intel from TDE (may be null)
      const firmographics = await getFirmographics(dom);  // hard signals: Apollo + DNS

      const signals = resolvePartnerSignals(rubric, intelRow || {}, firmographics);
      const { score, colour } = scoreFromSignals(rubric, signals);

      const features = { ...firmographics, intel: intelFeatures(intelRow) };
      const payload = {
        score, colour, signals, features,
        status: 'new', assigned_to: null,
        intel_available: !!intelRow,
        scored_at: new Date().toISOString(),
      };
      await savePartnerScore(dom, projectId, payload, company_name || (intelRow && intelRow.company_name), url || dom);

      res.json({
        ok: true, domain: dom, company_name: company_name || (intelRow && intelRow.company_name) || dom,
        score, colour, signals,
        intel_available: !!intelRow,
        hint: intelRow ? undefined : 'No TDE company_intel yet — run POST /intel/research/company (role=partner) for richer signals.',
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── GET /ipp/leads/:collectionId — list scored resellers for this project ──
  app.get('/ipp/leads/:collectionId', auth, async (req, res) => {
    try {
      const projectId = req.params.collectionId;
      const { rows } = await pg.query('SELECT domain, company_name, ippscore FROM company_intel WHERE ippscore ? $1', [projectId]);
      const leads = rows.map((r) => {
        const fs = (typeof r.ippscore === 'string' ? safeJson(r.ippscore) : r.ippscore)[projectId] || {};
        return { domain: r.domain, company_name: r.company_name, score: fs.score ?? null,
          colour: fs.colour ?? null, status: fs.status ?? 'new', assigned_to: fs.assigned_to ?? null };
      }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
      res.json({ collectionId: projectId, count: leads.length, partners: leads });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── PATCH /ipp/leads/:collectionId/:domain — assign / set status ──
  app.patch('/ipp/leads/:collectionId/:domain', auth, async (req, res) => {
    try {
      const projectId = req.params.collectionId;
      const dom = bareDomain(req.params.domain);
      const row = await getIntelRow(dom);
      if (!row) return res.status(404).json({ error: 'Partner not found' });
      const ippscore = (typeof row.ippscore === 'string' ? safeJson(row.ippscore) : row.ippscore) || {};
      const entry = ippscore[projectId];
      if (!entry) return res.status(404).json({ error: 'Partner not scored for this project' });
      if (req.body.status !== undefined) entry.status = req.body.status;
      if (req.body.assigned_to !== undefined) entry.assigned_to = req.body.assigned_to;
      await pg.query('UPDATE company_intel SET ippscore = COALESCE(ippscore, \'{}\'::jsonb) || jsonb_build_object($1::text,$2::jsonb), updated_at=NOW() WHERE domain=$3',
        [projectId, JSON.stringify(entry), dom]);
      res.json({ ok: true, domain: dom, status: entry.status, assigned_to: entry.assigned_to });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── POST /ipp/analyze/:collectionId — pattern mining (what top partners share) ──
  app.post('/ipp/analyze/:collectionId', auth, async (req, res) => {
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

  // ── POST /ipp/rubric/:collectionId/apply — append accepted suggestions (governed by vocab) ──
  app.post('/ipp/rubric/:collectionId/apply', auth, async (req, res) => {
    try {
      const projectId = req.params.collectionId;
      const keys = (req.body && req.body.keys) || [];
      const col = await engine.getCollection(projectId);
      const m = meta(col);
      const rubric = m.ipp_rubric;
      if (!rubric) return res.status(400).json({ error: 'No rubric to extend' });

      const leads = await loadMinerLeads(projectId);
      const byKey = Object.fromEntries(mine(leads).suggested_signals.map((s) => [s.key, s]));
      const existing = new Set((rubric.signals || []).map((s) => s.key));
      const added = [], rejected = [];
      for (const key of keys) {
        const s = byKey[key];
        if (!s || existing.has(key)) continue;
        if (!VOCAB_KEYS.includes(key)) { rejected.push(key); continue; } // keep the vocabulary governed
        rubric.signals.push({ key: s.key, label: s.label, weight: s.suggested_weight, type: s.type, description: s.rationale, source: 'pattern_miner' });
        added.push(key);
      }
      m.ipp_rubric = rubric;
      await saveCollectionMeta(projectId, m);
      res.json({ ok: true, added, rejected_out_of_vocab: rejected, rubric });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Resolve a vendor name to a domain (Serper if available) ──
  async function resolveDomain(name, url) {
    if (url) return bareDomain(url);
    if (/\./.test(name) && !/\s/.test(name)) return bareDomain(name);
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
      } catch { /* fall through */ }
    }
    return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '') + '.com';
  }

  function buildIppProfile(collectionId, vendor) {
    const gen = require('../core/partnerfit/partner_generator');
    return gen.generate(engine, collectionId, vendor || {});
  }

  // Pull high-value pages that reveal who a vendor's partners are.
  async function ingestEvidencePages(collectionId, baseUrl, label) {
    const base = baseUrl.replace(/\/+$/, '');
    const paths = ['partners', 'partner', 'become-a-partner', 'partner-program', 'reseller',
      'resellers', 'channel', 'find-a-partner', 'partner-locator', 'where-to-buy'];
    for (const p of paths) {
      try { await engine.ingest(collectionId, 'web', base + '/' + p, { title: label + ' — ' + p }); }
      catch { /* page may not exist; skip */ }
    }
  }

  async function setIppStatus(collectionId, status, error) {
    const col = await engine.getCollection(collectionId);
    if (!col) return;
    const m = meta(col);
    m.ipp_status = status;
    m.ipp_status_at = new Date().toISOString();
    if (error) m.ipp_error = error; else if (status !== 'error') delete m.ipp_error;
    await saveCollectionMeta(collectionId, m);
  }

  // Background worker: research -> synthesize reseller discriminators -> save + mark ready.
  async function runGeneration(collectionId, opts) {
    const { name, domain, type, researchUrl, force } = opts;
    try {
      let stats = { atomCount: 0 };
      try { stats = await engine.getStats(collectionId); } catch { /* none yet */ }
      if ((stats.atomCount || 0) < 20 || force) {
        let webContent = '';
        try { const { extractWeb } = require('../ingest/web'); webContent = (await extractWeb(researchUrl)).text || ''; } catch { /* ok */ }
        const swarm = await runSwarm(researchUrl, name, webContent);
        const msipText = msipToText(swarm.msip, researchUrl);
        if (msipText.length > 100) await engine.ingest(collectionId, 'text', msipText, { title: (name || domain) + ' — MSIP' });
        if (webContent.length > 200) await engine.ingest(collectionId, 'web', researchUrl, { title: (name || domain) + ' — Website' }).catch(() => {});
        ingestEvidencePages(collectionId, researchUrl, name || domain).catch(() => {});
        await new Promise((r) => setTimeout(r, 2500));
        runDeepFill(engine, collectionId, researchUrl, name, swarm.msip).catch(() => {});
      }
      const profile = await buildIppProfile(collectionId, { name: name || domain, domain });
      const record = {
        vendor: { name: name || domain, domain, url: researchUrl, type: type || 'vendor' },
        profile, generated_at: new Date().toISOString(), ttl_days: IPP_TTL_DAYS,
      };
      const col = await engine.getCollection(collectionId);
      const m = meta(col); m.ipp_profile = record; m.ipp_status = 'ready'; m.ipp_status_at = new Date().toISOString(); delete m.ipp_error;
      await saveCollectionMeta(collectionId, m);
      const n = profile && profile.discriminators ? profile.discriminators.length : 0;
      console.log('  [IPP] ready: ' + collectionId + ' (' + n + ' discriminators)');
    } catch (e) {
      await setIppStatus(collectionId, 'error', e.message).catch(() => {});
      console.log('  [IPP] error ' + collectionId + ': ' + e.message);
    }
  }

  // ── PUBLIC: kick off (or return) an IPP. Returns immediately; poll GET for the result. ──
  // body: { name?, url?, type?, force? }
  app.post('/ipp/profile', async (req, res) => {
    try {
      const { name, url, type, force } = req.body || {};
      if (!name && !url) return res.status(400).json({ error: 'Provide a vendor name or website URL' });

      const domain = await resolveDomain(name, url);
      const collectionId = 'ipp_' + domain.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
      const researchUrl = url || ('https://' + domain);

      const existing = await engine.getCollection(collectionId);
      if (existing && !force) {
        const m = meta(existing);
        if (m.ipp_profile && isFresh(m.ipp_profile.generated_at, IPP_TTL_DAYS)) {
          return res.json({ status: 'ready', cached: true, ...m.ipp_profile });
        }
        if (m.ipp_status === 'generating' && isFresh(m.ipp_status_at, 0.02)) {
          return res.json({ status: 'generating', domain, collectionId });
        }
      }

      if (!existing) {
        await engine.createCollection(collectionId, name || domain, 'IPP research',
          { template: { id: 'business' }, templateId: 'business',
            resource_type: 'Vendor', solutionUrl: researchUrl });
      }
      await setIppStatus(collectionId, 'generating');
      runGeneration(collectionId, { name, domain, type, researchUrl, force }).catch(() => {});
      res.json({ status: 'generating', domain, collectionId });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── PUBLIC: poll for an IPP. ready -> 200; generating -> 202; none -> 404 ──
  app.get('/ipp/profile/:domain', async (req, res) => {
    try {
      const domain = bareDomain(req.params.domain);
      const col = await engine.getCollection('ipp_' + domain.replace(/[^a-z0-9]+/gi, '_').toLowerCase());
      const m = col ? meta(col) : {};
      if (m.ipp_profile) {
        return res.json({ status: 'ready', cached: true, fresh: isFresh(m.ipp_profile.generated_at, IPP_TTL_DAYS), ...m.ipp_profile });
      }
      if (m.ipp_status === 'generating') return res.status(202).json({ status: 'generating', domain });
      if (m.ipp_status === 'error') return res.json({ status: 'error', error: m.ipp_error, domain });
      return res.status(404).json({ status: 'none', error: 'No IPP for ' + domain });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── PUBLIC: serve the Drix IPP page ──
  const ippPage = (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'ipp.html'));
  app.get('/ipp', ippPage);
  app.get('/ideal-partner-profile', ippPage);

  async function loadMinerLeads(projectId) {
    const { rows } = await pg.query('SELECT domain, company_name, ippscore FROM company_intel WHERE ippscore ? $1', [projectId]);
    return rows.map((r) => {
      const fs = (typeof r.ippscore === 'string' ? safeJson(r.ippscore) : r.ippscore)[projectId] || {};
      return { id: r.domain, domain: r.domain, company_name: r.company_name,
        score: fs.score ?? null, colour: fs.colour ?? null, features: fs.features || {} };
    });
  }
};

function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }
