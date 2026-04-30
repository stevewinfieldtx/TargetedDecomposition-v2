/**
 * TDE — CPPV (Spoken Voice Profile) Routes
 * ═══════════════════════════════════════════════════════════════════
 * CPPV is built INTERNALLY by TDE from video/audio transcript atoms
 * via engine._buildCPPV(). Unlike CPPW (which is pushed from
 * TrueWriting), CPPV has no inbound POST — it's produced as a
 * side-effect of analyzeCollection().
 *
 * These routes expose the stored CPPV for downstream consumers:
 *   - Eleven Labs conversational agents
 *   - External voice-cloning / text-gen pipelines
 *   - Audit / QA dashboards
 *
 * Endpoints:
 *   GET  /api/cppv/:collectionId              — retrieve the current (latest) CPPV JSON
 *   GET  /api/cppv/:collectionId/history       — list all historical versions
 *   GET  /api/cppv/:collectionId/voice-guide   — download a .docx voice guide
 *
 * Mount: require('./routes/cppv-routes')(app, auth, engine);
 */

module.exports = function mountCPPVRoutes(app, auth, engine) {
  if (!app || !auth || !engine) {
    console.log('  CPPV Routes: SKIPPED (missing app/auth/engine)');
    return;
  }

  // ── GET /api/cppv/:collectionId ────────────────────────────────────────────
  // Retrieve the most recent CPPV for a collection.
  app.get('/api/cppv/:collectionId', auth, async (req, res) => {
    const { collectionId } = req.params;
    try {
      const intel = await engine.store.getIntelligence(collectionId, 'cppv');
      if (!intel || !intel.data) {
        return res.status(404).json({ error: 'no CPPV on record for this collection' });
      }
      return res.json({ ok: true, collectionId, cppv: intel.data });
    } catch (err) {
      return res.status(500).json({ error: 'failed to retrieve CPPV', detail: err.message });
    }
  });

  // ── GET /api/cppv/:collectionId/history ────────────────────────────────────
  // List all CPPV versions (audit trail). Postgres returns full history;
  // SQLite fallback returns the single latest record.
  app.get('/api/cppv/:collectionId/history', auth, async (req, res) => {
    const { collectionId } = req.params;
    try {
      if (!engine.store._usePg()) {
        const intel = await engine.store.getIntelligence(collectionId, 'cppv');
        const versions = intel && intel.data ? [intel.data] : [];
        return res.json({ ok: true, collectionId, versions, note: 'SQLite fallback — history not available' });
      }

      const r = await engine.store.pg.query(
        `SELECT created_at, data FROM intelligence
         WHERE collection_id = $1 AND intel_type = 'cppv'
         ORDER BY created_at DESC`,
        [collectionId]
      );
      const versions = r.rows.map(row => ({
        created_at: row.created_at,
        data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
      }));
      return res.json({ ok: true, collectionId, version_count: versions.length, versions });
    } catch (err) {
      return res.status(500).json({ error: 'failed to retrieve CPPV history', detail: err.message });
    }
  });

  // ── GET /api/cppv/:collectionId/voice-guide ────────────────────────────────
  // Generate and download a .docx voice guide from the stored CPPV.
  // Structured in the 11-section format compatible with Eleven Labs
  // conversational agents and similar text-based collaborative tools.
  //
  // Query params:
  //   ?name=<string>  — the person/brand name for the guide title (default: collection name)
  //   ?format=json    — return the structured sections as JSON instead of .docx
  app.get('/api/cppv/:collectionId/voice-guide', auth, async (req, res) => {
    const { collectionId } = req.params;
    const { name, format } = req.query;

    try {
      // 1. Fetch CPPV
      const intel = await engine.store.getIntelligence(collectionId, 'cppv');
      if (!intel || !intel.data) {
        return res.status(404).json({ error: 'no CPPV on record — run analyzeCollection() first with 3+ video/audio sources' });
      }

      // 2. Resolve display name
      const col = await engine.getCollection(collectionId);
      const displayName = name || col?.name || collectionId;

      // 3. Generate voice guide (lazy require so routes mount even if docx pkg missing)
      const { generateVoiceGuide } = require('../utils/voice-guide-renderer');
      const guide = await generateVoiceGuide(intel.data, displayName, engine);

      // 4. Return as JSON or .docx
      if (format === 'json') {
        return res.json({ ok: true, collectionId, name: displayName, sections: guide.sections, generated_at: guide.generated_at });
      }

      // Default: .docx download
      const docxBuffer = guide.docxBuffer;
      const filename = `${displayName.replace(/[^a-zA-Z0-9_-]/g, '_')}_Voice_Guide.docx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(docxBuffer);
    } catch (err) {
      console.error(`  CPPV voice-guide error: ${err.message}`);
      return res.status(500).json({ error: 'failed to generate voice guide', detail: err.message });
    }
  });

  // ── GET /api/cpp-status ─────────────────────────────────────────────────────
  // Bulk endpoint: returns CPPV and CPPW presence for ALL collections in one call.
  // Used by the Voice Guide dashboard to avoid N+1 API calls.
  app.get('/api/cpp-status', auth, async (req, res) => {
    try {
      const collections = await engine.listCollections();
      const results = {};

      for (const col of collections) {
        const status = { cppv: null, cppw: null };
        try {
          const cppv = await engine.store.getIntelligence(col.id, 'cppv');
          if (cppv && cppv.data && Object.keys(cppv.data).length > 0) {
            status.cppv = {
              profile_type: cppv.data.profile_type || 'CPPV',
              source_count: cppv.data.source_count || cppv.data.sources_used?.length || null,
              built_at: cppv.data.built_at || null,
            };
          }
        } catch {}
        try {
          const cppw = await engine.store.getIntelligence(col.id, 'cppw');
          if (cppw && cppw.data && Object.keys(cppw.data).length > 0) {
            status.cppw = {
              profile_type: cppw.data.profile_type || 'CPPW',
              email_count: cppw.data.metadata?.email_count_analyzed || null,
              received_at: cppw.data.received_at || null,
            };
          }
        } catch {}
        results[col.id] = status;
      }

      return res.json({ ok: true, collections: results });
    } catch (err) {
      return res.status(500).json({ error: 'failed to retrieve CPP status', detail: err.message });
    }
  });

  console.log('  CPPV Routes: mounted (/api/cppv/:collectionId, /api/cpp-status)');
};
