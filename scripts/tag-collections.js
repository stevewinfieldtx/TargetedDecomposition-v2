#!/usr/bin/env node
/**
 * Tag Collections with Resource Types
 * ════════════════════════════════════
 * Run this once after deploying the updated server.js.
 * It lists all your collections and lets you assign each one
 * to a resource type (CPP Primary, CPP Secondary, Vendor,
 * Solution, Partner, Company).
 *
 * Usage:
 *   node scripts/tag-collections.js
 *
 * Requires API_SECRET_KEY in your .env file (or pass via env):
 *   API_SECRET_KEY=your_key node scripts/tag-collections.js
 */

require('dotenv').config();
const readline = require('readline');

const API_URL = process.env.TDE_URL || 'https://targeteddecomposition-production.up.railway.app';
const API_KEY = process.env.API_SECRET_KEY;

if (!API_KEY) {
  console.error('\n  ERROR: API_SECRET_KEY not set.');
  console.error('  Set it in your .env file or run:');
  console.error('    API_SECRET_KEY=your_key node scripts/tag-collections.js\n');
  process.exit(1);
}

const TYPES = ['CPP Primary', 'CPP Secondary', 'Vendor', 'Solution', 'Partner', 'Company'];

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

async function main() {
  console.log('\n  ═══════════════════════════════════════════');
  console.log('  TDE — Collection Resource Type Tagger');
  console.log('  ═══════════════════════════════════════════\n');
  console.log(`  API: ${API_URL}\n`);

  // Fetch all collections
  const resp = await fetch(API_URL + '/collections', {
    headers: { 'x-api-key': API_KEY },
  });
  if (!resp.ok) {
    console.error('  Failed to fetch collections:', resp.status, await resp.text());
    process.exit(1);
  }

  const collections = await resp.json();
  console.log(`  Found ${collections.length} collection(s):\n`);

  for (let i = 0; i < collections.length; i++) {
    const col = collections[i];
    const meta = col.metadata || {};
    const currentType = meta.resource_type || '(none)';
    const atoms = col.stats?.atomCount || 0;
    const sources = col.stats?.sourceCount || 0;

    console.log(`  ─────────────────────────────────────────`);
    console.log(`  [${i + 1}/${collections.length}]  ${col.name}`);
    console.log(`     ID:       ${col.id}`);
    console.log(`     Template: ${meta.templateId || 'default'}`);
    console.log(`     Atoms:    ${atoms}   Sources: ${sources}`);
    console.log(`     Current:  ${currentType}`);
    console.log();

    TYPES.forEach((t, j) => console.log(`     ${j + 1}. ${t}`));
    console.log(`     s. Skip (keep "${currentType}")`);
    console.log();

    const choice = await ask('     Enter choice (1-6 or s): ');

    if (choice.toLowerCase() === 's' || choice.trim() === '') {
      console.log('     → Skipped\n');
      continue;
    }

    const idx = parseInt(choice) - 1;
    if (idx < 0 || idx >= TYPES.length) {
      console.log('     → Invalid choice, skipping\n');
      continue;
    }

    const resourceType = TYPES[idx];

    const patchResp = await fetch(`${API_URL}/collections/${col.id}/resource-type`, {
      method: 'PATCH',
      headers: {
        'x-api-key': API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ resource_type: resourceType }),
    });

    if (patchResp.ok) {
      console.log(`     ✓ Tagged as "${resourceType}"\n`);
    } else {
      console.log(`     ✗ Failed: ${await patchResp.text()}\n`);
    }
  }

  console.log('\n  Done! Your /public/dashboard endpoint now reflects these tags.');
  console.log('  The brain visualization on tde.html will pick them up automatically.\n');
  rl.close();
}

main().catch(err => { console.error(err); rl.close(); process.exit(1); });
