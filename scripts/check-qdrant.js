#!/usr/bin/env node
/**
 * Quick check: what's actually in Qdrant?
 */
require('dotenv').config();
const config = require('../src/config');
let QdrantClient;
try { QdrantClient = require('@qdrant/js-client-rest').QdrantClient; }
catch { console.error('Missing @qdrant/js-client-rest — run npm install'); process.exit(1); }

(async () => {
  console.log('QDRANT_URL:', config.QDRANT_URL || '(not set)');
  console.log('QDRANT_API_KEY:', config.QDRANT_API_KEY ? 'SET' : '(not set)');
  if (!config.QDRANT_URL) { console.log('\nNo QDRANT_URL — run this with: railway run node scripts/check-qdrant.js'); process.exit(0); }
  const opts = { url: config.QDRANT_URL };
  if (config.QDRANT_API_KEY) opts.apiKey = config.QDRANT_API_KEY;
  const q = new QdrantClient(opts);
  const result = await q.getCollections();
  const cols = result.collections || [];
  console.log('\nQdrant collections found:', cols.length);
  for (const c of cols) {
    try {
      const info = await q.getCollection(c.name);
      console.log(`  ${c.name}: ${info.points_count} points`);
    } catch (e) { console.log(`  ${c.name}: error — ${e.message}`); }
  }
  if (!cols.length) console.log('  (none)');
})();
