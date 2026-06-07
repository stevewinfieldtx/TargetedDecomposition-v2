/**
 * Prospecting routes — PRIVATE (auth-required). Findings are never public.
 *
 * Generic across any solution: the ICP id is derived from the solution domain
 * (icp_<domain>), so the same endpoints work for Trustifi, Lenovo, VMware, etc.
 *
 * Mount (server.js, pg-ready block):
 *   require('./routes/prospecting-routes')(app, auth, engine.store.pg, engine);
 */
const store = require('../core/prospecting/store');
const { runCycle, startLoop } = require('../core/prospecting/engine');
const { bareDomain } = require('../core/fitscore/firmographics');

module.exports = (app, auth, pg, engine) => {
  store.ensureTable(pg)
    .then(() => console.log('  Prospecting: prospects table ready'))
    .catch((e) => console.log('  Prospecting table note: ' + e.message));

  const icpIdFor = (d) => 'icp_' + bareDomain(d).replace(/[^a-z0-9]+/gi, '_').toLowerCase();

  // Run one discovery cycle on demand for a solution's ICP
  app.post('/icp/prospect/run', auth, async (req, res) => {
    try {
      const { domain, url, icpId, maxNew } = req.body || {};
      const id = icpId || icpIdFor(domain || url || '');
      if (!id || id === 'icp_') return res.status(400).json({ error: 'Provide domain, url, or icpId' });
      const result = await runCycle(pg, engine, id, { maxNew: maxNew || 5 });
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Turn 24/7 prospecting on/off for a solution
  app.post('/icp/prospect/enable', auth, async (req, res) => {
    try {
      const { domain, url, icpId, enabled = true } = req.body || {};
      const id = icpId || icpIdFor(domain || url || '');
      const col = await engine.getCollection(id);
      if (!col) return res.status(404).json({ error: 'No ICP collection ' + id + ' — generate its ICP first.' });
      const m = typeof col.metadata === 'string' ? JSON.parse(col.metadata) : (col.metadata || {});
      m.prospecting_enabled = !!enabled;
      if (engine.store._usePg && engine.store._usePg()) {
        await pg.query('UPDATE collections SET metadata = $1, updated_at = NOW() WHERE id = $2', [JSON.stringify(m), id]);
      } else if (engine.store.db) {
        engine.store.db.prepare('UPDATE collections SET metadata = ? WHERE id = ?').run(JSON.stringify(m), id);
      }
      res.json({ ok: true, icpId: id, prospecting_enabled: m.prospecting_enabled });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // List collected prospects for a solution (private)
  app.get('/icp/prospect/:domain', auth, async (req, res) => {
    try {
      const id = icpIdFor(req.params.domain);
      const rows = await store.list(pg, id, {
        minScore: parseInt(req.query.minScore || '0', 10),
        status: req.query.status,
        limit: parseInt(req.query.limit || '200', 10),
      });
      res.json({ icpId: id, count: rows.length, prospects: rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Diagnostics: see the generated queries + which search engine works + sample hits
  app.post('/icp/prospect/debug', auth, async (req, res) => {
    try {
      const { domain, url, icpId } = req.body || {};
      const id = icpId || icpIdFor(domain || url || '');
      const { getIcp } = require('../core/prospecting/engine');
      const { generateQueries } = require('../core/prospecting/discover');
      const { webSearchDebug } = require('../core/prospecting/search');
      const icp = await getIcp(engine, id);
      if (!icp) return res.status(404).json({ error: 'No ICP for ' + id + ' — generate it first.' });
      const queries = await generateQueries(icp, 6);
      const sample = queries[0] || ((icp.profile && icp.profile.target_industries && icp.profile.target_industries[0]) || 'companies');
      const sr = await webSearchDebug(sample, 8);
      res.json({
        icpId: id,
        openrouter_key: !!process.env.OPENROUTER_API_KEY,
        prospect_model: process.env.PROSPECT_MODEL || 'meta-llama/llama-3.1-8b-instruct',
        brave_key: !!process.env.BRAVE_API_KEY,
        serper_key: !!process.env.SERPER_API_KEY,
        query_count: queries.length,
        queries,
        sample_query: sample,
        search_engine: sr.engine,
        result_count: sr.count,
        sample_urls: sr.results.slice(0, 5).map((x) => x.url),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Start the background loop (no-op unless PROSPECTING_ENABLED=true)
  startLoop(pg, engine);
};
