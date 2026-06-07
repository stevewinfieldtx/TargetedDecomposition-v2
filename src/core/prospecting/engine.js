/**
 * Prospecting — one discovery cycle + the slow 24/7 loop.
 * A cycle: load the ICP, discover candidates, drop ones already in the DB,
 * qualify a small batch with free signals, store. The loop runs cycles for
 * every solution whose ICP has prospecting_enabled, slowly, forever.
 */
const { discoverCandidates } = require('./discover');
const { qualify } = require('./qualify');
const store = require('./store');

function parseMeta(col) {
  if (!col) return {};
  return typeof col.metadata === 'string' ? safe(col.metadata) : (col.metadata || {});
}
function safe(s) { try { return JSON.parse(s); } catch { return {}; } }

async function getIcp(engine, icpId) {
  const col = await engine.getCollection(icpId);
  return parseMeta(col).icp_profile || null;
}

async function runCycle(pg, engine, icpId, { maxNew = 5, maxQueries = 6 } = {}) {
  await store.ensureTable(pg);
  const icp = await getIcp(engine, icpId);
  if (!icp) return { error: 'No ICP found for ' + icpId };

  const candidates = await discoverCandidates(icp, { maxQueries });
  const known = await store.knownDomains(pg, icpId);
  const fresh = candidates.filter((c) => c.domain && !known.has(c.domain)).slice(0, maxNew);

  let stored = 0;
  for (const c of fresh) {
    try {
      const q = await qualify(c, icp);
      await store.upsert(pg, { icp_id: icpId, domain: c.domain, source: c.source, ...q });
      stored++;
    } catch (e) { console.log('  [prospect] qualify error ' + c.domain + ': ' + e.message); }
  }
  const s = await store.stats(pg, icpId);
  return { icp_id: icpId, discovered: candidates.length, new_qualified: stored, total_in_db: s.total, strong_fits: s.strong };
}

// 24/7 slow loop across enabled ICPs (gated by PROSPECTING_ENABLED=true)
function startLoop(pg, engine) {
  if (process.env.PROSPECTING_ENABLED !== 'true') {
    console.log('  Prospecting loop: OFF (set PROSPECTING_ENABLED=true to run 24/7)');
    return;
  }
  const intervalMin = parseInt(process.env.PROSPECT_INTERVAL_MIN || '30', 10);
  const batch = parseInt(process.env.PROSPECT_BATCH || '3', 10);
  console.log('  Prospecting loop: ON (every ' + intervalMin + 'm, ' + batch + ' new/cycle)');

  setInterval(async () => {
    try {
      const cols = await engine.listCollections();
      for (const col of cols) {
        const m = parseMeta(col);
        if (m.icp_profile && m.prospecting_enabled) {
          const r = await runCycle(pg, engine, col.id, { maxNew: batch });
          console.log('  [prospect] ' + col.id + ': +' + (r.new_qualified || 0) + ' (db ' + (r.total_in_db || 0) + ')');
        }
      }
    } catch (e) { console.log('  [prospect] cycle error: ' + e.message); }
  }, intervalMin * 60000);
}

module.exports = { runCycle, startLoop, getIcp };
