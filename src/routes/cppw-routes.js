/**
 * TDE — CPPW (Written Voice Profile) Routes
 * ═══════════════════════════════════════════════════════════════════
 * CPPW is built ENTIRELY OUTSIDE of TDE by TrueWriting's on-prem email
 * analyzer. TDE never sees raw emails, never performs written-style
 * analysis. This route is the inbound surface that receives the
 * resulting fingerprint and stores it on the appropriate collection.
 *
 * Storage is versioned (keepHistory=true): each push creates a new
 * timestamped record. The most recent is used at generation time, but
 * prior versions remain in the database for audit ("which CPPW was
 * active when we sent the email in Q2?").
 *
 * Endpoints:
 *   POST /api/cppw/:collectionId   — push a new CPPW fingerprint
 *   GET  /api/cppw/:collectionId   — retrieve the current (latest) CPPW
 *   GET  /api/cppw/:collectionId/history — list all historical versions
 *
 * All endpoints require x-api-key matching config.API_SECRET_KEY.
 *
 * Mount: require('./routes/cppw-routes')(app, auth, engine);
 */

module.exports = function mountCPPWRoutes(app, auth, engine) {
  if (!app || !auth || !engine) {
    console.log('  CPPW Routes: SKIPPED (missing app/auth/engine)');
    return;
  }

  // ── POST /api/cppw/:collectionId ───────────────────────────────────────────
  // Push a fingerprint from TrueWriting.
  // Body: { profile: <fingerprint JSON from TrueWriting>, metadata?: { ... } }
  app.post('/api/cppw/:collectionId', auth, async (req, res) => {
    const { collectionId } = req.params;
    const { profile, metadata } = req.body || {};

    if (!collectionId) {
      return res.status(400).json({ error: 'collectionId required in URL' });
    }
    if (!profile || typeof profile !== 'object') {
      return res.status(400).json({ error: 'request body must include a non-empty "profile" object' });
    }

    try {
      // Verify the collection exists before attaching a CPPW to it
      const col = await engine.getCollection(collectionId);
      if (!col) {
        return res.status(404).json({ error: `collection not found: ${collectionId}` });
      }

      // Wrap with our own metadata so the stored record is self-describing.
      // `profile` is stored exactly as TrueWriting sent it — we don't interpret the schema.
      const record = {
        profile,
        profile_type: 'CPPW',
        source_modality: 'written',
        source_system: 'TrueWriting',
        received_at: new Date().toISOString(),
        metadata: {
          mailbox: metadata?.mailbox || null,
          email_count_analyzed: metadata?.email_count_analyzed || null,
          date_range: metadata?.date_range || null,
          analyzed_at: metadata?.analyzed_at || null,
          analyzer_version: metadata?.analyzer_version || null,
          ...(metadata || {}),
        },
      };

      await engine.store.storeIntelligence(collectionId, 'cppw', record, { keepHistory: true });

      console.log(`  CPPW: stored new fingerprint for ${collectionId}` +
        (metadata?.mailbox ? ` (mailbox: ${metadata.mailbox})` : '') +
        (metadata?.email_count_analyzed ? ` (${metadata.email_count_analyzed} emails analyzed)` : ''));

      return res.json({
        ok: true,
        collectionId,
        stored_at: record.received_at,
        profile_type: 'CPPW',
      });
    } catch (err) {
      console.error(`  CPPW POST error: ${err.message}`);
      return res.status(500).json({ error: 'failed to store CPPW', detail: err.message });
    }
  });

  // ── GET /api/cppw/:collectionId ────────────────────────────────────────────
  // Retrieve the most recent CPPW for a collection.
  app.get('/api/cppw/:collectionId', auth, async (req, res) => {
    const { collectionId } = req.params;
    try {
      const intel = await engine.store.getIntelligence(collectionId, 'cppw');
      if (!intel || !intel.data) {
        return res.status(404).json({ error: 'no CPPW on record for this collection' });
      }
      return res.json({ ok: true, collectionId, cppw: intel.data });
    } catch (err) {
      return res.status(500).json({ error: 'failed to retrieve CPPW', detail: err.message });
    }
  });

  // ── GET /api/cppw/:collectionId/history ────────────────────────────────────
  // List all CPPW versions (audit trail). Only works when Postgres is active —
  // SQLite fallback returns the single latest record.
  app.get('/api/cppw/:collectionId/history', auth, async (req, res) => {
    const { collectionId } = req.params;
    try {
      if (!engine.store._usePg()) {
        // SQLite fallback: just return the single current record
        const intel = await engine.store.getIntelligence(collectionId, 'cppw');
        const versions = intel && intel.data ? [intel.data] : [];
        return res.json({ ok: true, collectionId, versions, note: 'SQLite fallback — history not available' });
      }

      const r = await engine.store.pg.query(
        `SELECT created_at, data FROM intelligence
         WHERE collection_id = $1 AND intel_type = 'cppw'
         ORDER BY created_at DESC`,
        [collectionId]
      );
      const versions = r.rows.map(row => ({
        created_at: row.created_at,
        data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
      }));
      return res.json({ ok: true, collectionId, version_count: versions.length, versions });
    } catch (err) {
      return res.status(500).json({ error: 'failed to retrieve CPPW history', detail: err.message });
    }
  });

  console.log('  CPPW Routes: mounted (/api/cppw/:collectionId)');
};
