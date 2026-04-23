#!/usr/bin/env node
/**
 * TDE — Qdrant → Postgres Recovery Script
 * ═══════════════════════════════════════════════════════════════════
 *
 * One-shot recovery tool for cases where the Postgres/SQLite layer was wiped
 * (e.g., Railway redeploy without persistent DB) but Qdrant is still intact.
 *
 * Reads every point from every `tde_*` Qdrant collection and rehydrates the
 * corresponding collection, source, and atom rows in Postgres. Qdrant payloads
 * include the full atom text and 6D tags, so ~95% of the data is recoverable.
 *
 * WHAT IS RECOVERED (from Qdrant payloads + vectors):
 *   - Collections (id only — names will equal IDs; set description manually after)
 *   - Sources (IDs only — titles will be placeholders like "Recovered: <id>";
 *     URLs, authors, publishedAt, duration, page_count are NOT in payloads)
 *   - Atoms (full text, atom_index, atom_type, start_time, page_number, speaker,
 *     all 6 dimensional tags, embedding vectors)
 *
 * WHAT IS LOST (not in Qdrant):
 *   - Source titles, URLs, authors, published dates, durations
 *   - Collection display names, descriptions, template IDs
 *   - Intelligence records (analysis, engagement analytics, voice profiles, merged extractors)
 *   - Intel cache (company_intel, industry_intel)
 *
 * USAGE:
 *   # from the project root, with .env pointing at your production Postgres + Qdrant
 *   node scripts/recover-from-qdrant.js
 *
 *   # or via Railway CLI to inject Railway env vars:
 *   railway run node scripts/recover-from-qdrant.js
 *
 * IDEMPOTENT: safe to run multiple times. Postgres upserts on conflict.
 * READ-ONLY for Qdrant: never modifies vectors.
 */

const path    = require('path');
const config  = require(path.resolve(__dirname, '..', 'src', 'config'));
const Store   = require(path.resolve(__dirname, '..', 'src', 'core', 'store'));

let QdrantClient;
try { QdrantClient = require('@qdrant/js-client-rest').QdrantClient; }
catch { console.error('Missing @qdrant/js-client-rest — run npm install'); process.exit(1); }

// ── Config Sanity Checks ──────────────────────────────────────────────────────

if (!config.QDRANT_URL) {
  console.error('QDRANT_URL is not set. Cannot recover from Qdrant. Exiting.');
  process.exit(1);
}
if (!config.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Recovery needs Postgres. Exiting.');
  console.error('Tip: if running locally, use the external Railway Postgres URL (not .railway.internal).');
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const QDRANT_PREFIX = 'tde_';

function collectionIdFromQName(qName) {
  return qName.startsWith(QDRANT_PREFIX) ? qName.slice(QDRANT_PREFIX.length) : qName;
}

function inferSourceType(sourceId) {
  if (typeof sourceId !== 'string') return 'unknown';
  if (sourceId.endsWith('_pdf'))   return 'pdf';
  if (sourceId.endsWith('_docx'))  return 'docx';
  if (sourceId.endsWith('_pptx'))  return 'pptx';
  if (sourceId.endsWith('_audio')) return 'audio';
  if (sourceId.endsWith('_text'))  return 'text';
  if (sourceId.endsWith('_web'))   return 'web';
  // YouTube uses bare videoIds (no suffix). Everything else = unknown.
  return /^[a-zA-Z0-9_-]{11}$/.test(sourceId) ? 'youtube' : 'unknown';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main Recovery Flow ───────────────────────────────────────────────────────

async function recover() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('TDE — Qdrant → Postgres Recovery');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Qdrant:   ${config.QDRANT_URL}`);
  console.log(`Postgres: ${config.DATABASE_URL.replace(/:[^:@]*@/, ':***@')}`);
  console.log('');

  // Connect to Qdrant
  const qdrantOpts = { url: config.QDRANT_URL };
  if (config.QDRANT_API_KEY) qdrantOpts.apiKey = config.QDRANT_API_KEY;
  const qdrant = new QdrantClient(qdrantOpts);

  // Initialize Store (async inside — give it time to finish PG init)
  const store = new Store(config.DATA_DIR);
  // `Store` begins async Postgres init in its constructor. Its methods call
  // `_waitReady()` internally, so we don't need to await anything up-front,
  // but a short pause lets the "Storage: PostgreSQL" log land first for clarity.
  await sleep(1500);

  // List Qdrant collections
  let collections;
  try {
    const result = await qdrant.getCollections();
    collections = result.collections || [];
  } catch (err) {
    console.error(`Failed to list Qdrant collections: ${err.message}`);
    process.exit(1);
  }

  const tdeCollections = collections.filter(c => c.name && c.name.startsWith(QDRANT_PREFIX));
  console.log(`Found ${tdeCollections.length} TDE collection(s) in Qdrant:`);
  for (const c of tdeCollections) console.log(`  - ${c.name}`);
  console.log('');

  if (tdeCollections.length === 0) {
    console.log('Nothing to recover. Exiting.');
    process.exit(0);
  }

  // Totals for final summary
  let totalSources = 0;
  let totalAtoms   = 0;
  const perCollection = [];

  for (const qCol of tdeCollections) {
    const qName        = qCol.name;
    const collectionId = collectionIdFromQName(qName);
    console.log(`── Recovering "${collectionId}" (Qdrant: ${qName}) ──`);

    try {
      // 1) Recreate the collection record in Postgres
      await store.createCollection(
        collectionId,
        collectionId, // display name — you can rename later
        'Recovered from Qdrant',
        { recovered: true, recoveredAt: new Date().toISOString() }
      );

      // 2) Scroll through every point in the Qdrant collection
      const sourceMap = new Map(); // source_id -> source record
      const atomsBySource = new Map(); // source_id -> [atom, ...]

      let offset = null;
      let pagesScrolled = 0;
      const PAGE = 500;

      while (true) {
        let result;
        try {
          result = await qdrant.scroll(qName, {
            limit:        PAGE,
            offset,
            with_payload: true,
            with_vector:  true,
          });
        } catch (err) {
          console.log(`  Scroll error (page ${pagesScrolled + 1}): ${err.message}. Retrying once in 2s...`);
          await sleep(2000);
          result = await qdrant.scroll(qName, {
            limit:        PAGE,
            offset,
            with_payload: true,
            with_vector:  true,
          });
        }

        const points = result.points || [];
        pagesScrolled++;
        if (!points.length && !offset) {
          console.log(`  (empty collection)`);
          break;
        }

        for (const pt of points) {
          const p = pt.payload || {};
          if (!p.atom_id || !p.source_id) continue; // malformed, skip

          // Track source (first occurrence wins — placeholder metadata)
          if (!sourceMap.has(p.source_id)) {
            sourceMap.set(p.source_id, {
              id:          p.source_id,
              sourceType:  inferSourceType(p.source_id),
              sourceUrl:   '',
              filePath:    '',
              title:       `Recovered: ${p.source_id}`,
              author:      '',
              publishedAt: '',
              duration:    0,
              pageCount:   0,
              metadata:    { recovered: true, recoveredAt: new Date().toISOString() },
              status:      'ready',
            });
          }

          // Build atom record (match the shape store.storeAtoms expects)
          const atom = {
            id:            p.atom_id,
            atomIndex:     p.atom_index ?? 0,
            text:          p.text ?? '',
            atomType:      p.atom_type ?? 'general',
            confidence:    1.0, // not in payload — assume recovered means trusted
            startTime:     p.start_time ?? 0,
            endTime:       0,
            timestampUrl:  '',
            pageNumber:    p.page_number ?? 0,
            speaker:       p.speaker || null,
            d_persona:           p.d_persona           || '',
            d_buying_stage:      p.d_buying_stage      || '',
            d_emotional_driver:  p.d_emotional_driver  || '',
            d_evidence_type:     p.d_evidence_type     || '',
            d_credibility:       p.d_credibility ?? 3,
            d_recency:           p.d_recency           || '',
            embedding:     Array.isArray(pt.vector) ? pt.vector : null,
          };

          if (!atomsBySource.has(p.source_id)) atomsBySource.set(p.source_id, []);
          atomsBySource.get(p.source_id).push(atom);
        }

        if (!result.next_page_offset) break;
        offset = result.next_page_offset;
      }

      // 3) Write sources first, then atoms grouped by source
      for (const src of sourceMap.values()) {
        try {
          await store.addSource(collectionId, src);
        } catch (err) {
          console.log(`  addSource(${src.id}) failed: ${err.message}`);
        }
      }

      let atomWriteCount = 0;
      for (const [sourceId, atoms] of atomsBySource) {
        try {
          await store.storeAtoms(collectionId, sourceId, atoms);
          atomWriteCount += atoms.length;
        } catch (err) {
          console.log(`  storeAtoms(${sourceId}) failed: ${err.message}`);
        }
      }

      console.log(`  ✓ ${sourceMap.size} source(s), ${atomWriteCount} atom(s) rehydrated`);
      totalSources += sourceMap.size;
      totalAtoms   += atomWriteCount;
      perCollection.push({ collectionId, sources: sourceMap.size, atoms: atomWriteCount });
    } catch (err) {
      console.log(`  ✗ Collection "${collectionId}" failed: ${err.message}`);
      perCollection.push({ collectionId, error: err.message });
    }

    console.log('');
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Recovery complete.');
  console.log('');
  console.log(`Collections processed: ${tdeCollections.length}`);
  console.log(`Total sources recovered: ${totalSources}`);
  console.log(`Total atoms recovered:   ${totalAtoms}`);
  console.log('');
  console.log('Per-collection detail:');
  for (const r of perCollection) {
    if (r.error) {
      console.log(`  ✗ ${r.collectionId}: ERROR — ${r.error}`);
    } else {
      console.log(`  ✓ ${r.collectionId}: ${r.sources} sources, ${r.atoms} atoms`);
    }
  }
  console.log('');
  console.log('NEXT STEPS:');
  console.log('  1. Start the TDE server and verify collections appear in the admin UI.');
  console.log('  2. Source titles will read "Recovered: <id>" — rename in your DB or via');
  console.log('     a follow-up script once you know which sources are which.');
  console.log('  3. Intelligence records (analysis, engagement, voice profile) were NOT in');
  console.log('     Qdrant. Re-run analyzeCollection() on any collections you need those for.');
  console.log('');

  process.exit(0);
}

recover().catch(err => {
  console.error('');
  console.error('Recovery FAILED:', err);
  console.error(err.stack);
  process.exit(1);
});
