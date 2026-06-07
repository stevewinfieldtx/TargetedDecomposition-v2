/**
 * Prospecting — private storage of discovered prospects in TDE Postgres.
 * Keyed by (icp_id, domain) so the swarm never re-processes the same company
 * for the same solution. Rich enough to drive export / outreach / dashboards later.
 */
async function ensureTable(pg) {
  await pg.query(`CREATE TABLE IF NOT EXISTS prospects (
    id BIGSERIAL PRIMARY KEY,
    icp_id TEXT NOT NULL,
    domain TEXT NOT NULL,
    company_name TEXT,
    industry TEXT,
    fit_score NUMERIC,
    reasons TEXT,
    matches JSONB DEFAULT '[]'::jsonb,
    signals JSONB DEFAULT '{}'::jsonb,
    source TEXT,
    status TEXT DEFAULT 'new',
    discovered_at TIMESTAMPTZ DEFAULT NOW(),
    last_checked_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (icp_id, domain)
  )`);
}

async function knownDomains(pg, icpId) {
  const { rows } = await pg.query('SELECT domain FROM prospects WHERE icp_id = $1', [icpId]);
  return new Set(rows.map((r) => r.domain));
}

async function upsert(pg, rec) {
  await pg.query(
    `INSERT INTO prospects (icp_id, domain, company_name, industry, fit_score, reasons, matches, signals, source, status, discovered_at, last_checked_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'new',NOW(),NOW())
     ON CONFLICT (icp_id, domain) DO UPDATE SET
       company_name = COALESCE(EXCLUDED.company_name, prospects.company_name),
       industry = COALESCE(EXCLUDED.industry, prospects.industry),
       fit_score = EXCLUDED.fit_score, reasons = EXCLUDED.reasons,
       matches = EXCLUDED.matches, signals = EXCLUDED.signals,
       last_checked_at = NOW()`,
    [rec.icp_id, rec.domain, rec.company_name, rec.industry, rec.fit_score, rec.reasons,
     JSON.stringify(rec.matches || []), JSON.stringify(rec.signals || {}), rec.source]
  );
}

async function list(pg, icpId, { minScore = 0, status, limit = 200 } = {}) {
  const params = [icpId, minScore];
  let sql = 'SELECT * FROM prospects WHERE icp_id = $1 AND COALESCE(fit_score,0) >= $2';
  if (status) { params.push(status); sql += ' AND status = $' + params.length; }
  params.push(limit);
  sql += ' ORDER BY fit_score DESC NULLS LAST, discovered_at DESC LIMIT $' + params.length;
  const { rows } = await pg.query(sql, params);
  return rows;
}

async function stats(pg, icpId) {
  const { rows } = await pg.query(
    'SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE fit_score >= 70)::int AS strong FROM prospects WHERE icp_id = $1',
    [icpId]);
  return rows[0] || { total: 0, strong: 0 };
}

module.exports = { ensureTable, knownDomains, upsert, list, stats };
