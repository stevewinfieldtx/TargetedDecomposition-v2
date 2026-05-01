const { Pool } = require('pg');

let pool = null;
let memoryCache = new Map(); // fallback when no PG

/**
 * Initialize the cache layer.
 * If pgUrl is provided, creates the table in Postgres.
 * Otherwise falls back to an in-memory Map.
 */
async function init(pgUrl) {
  if (!pgUrl) {
    console.log('[cache] No CACHE_DATABASE_URL — using in-memory fallback');
    return;
  }

  try {
    pool = new Pool({ connectionString: pgUrl });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orchestrator_cache (
        key          TEXT PRIMARY KEY,
        value        JSONB NOT NULL,
        collection_id TEXT,
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        expires_at   TIMESTAMPTZ
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_cache_collection_id ON orchestrator_cache (collection_id)
    `);
    console.log('[cache] PostgreSQL cache initialized');
  } catch (err) {
    console.error('[cache] PostgreSQL init failed, falling back to in-memory:', err.message);
    pool = null;
  }
}

/**
 * Get a cached value by key. Returns null if missing or expired.
 */
async function get(key) {
  if (pool) {
    try {
      const { rows } = await pool.query(
        `SELECT value FROM orchestrator_cache WHERE key = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
        [key]
      );
      return rows.length ? rows[0].value : null;
    } catch (err) {
      console.error('[cache] get error:', err.message);
      return null;
    }
  }

  // In-memory fallback
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value;
}

/**
 * Set a cached value.
 * @param {string} key
 * @param {*} value – must be JSON-serializable
 * @param {number} ttlSeconds – 0 means no caching (skip)
 * @param {string} collectionId – for invalidation grouping
 */
async function set(key, value, ttlSeconds, collectionId) {
  if (!ttlSeconds || ttlSeconds <= 0) return;

  if (pool) {
    try {
      await pool.query(
        `INSERT INTO orchestrator_cache (key, value, collection_id, expires_at)
         VALUES ($1, $2, $3, NOW() + INTERVAL '1 second' * $4)
         ON CONFLICT (key) DO UPDATE
           SET value = EXCLUDED.value,
               collection_id = EXCLUDED.collection_id,
               created_at = NOW(),
               expires_at = NOW() + INTERVAL '1 second' * $4`,
        [key, JSON.stringify(value), collectionId || null, ttlSeconds]
      );
    } catch (err) {
      console.error('[cache] set error:', err.message);
    }
    return;
  }

  // In-memory fallback
  memoryCache.set(key, {
    value,
    collectionId: collectionId || null,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

/**
 * Invalidate all cache entries for a given collection.
 */
async function invalidateCollection(collectionId) {
  if (!collectionId) return;

  if (pool) {
    try {
      const { rowCount } = await pool.query(
        `DELETE FROM orchestrator_cache WHERE collection_id = $1`,
        [collectionId]
      );
      console.log(`[cache] Invalidated ${rowCount} entries for collection ${collectionId}`);
    } catch (err) {
      console.error('[cache] invalidateCollection error:', err.message);
    }
    return;
  }

  // In-memory fallback
  let count = 0;
  for (const [k, v] of memoryCache) {
    if (v.collectionId === collectionId) {
      memoryCache.delete(k);
      count++;
    }
  }
  console.log(`[cache] Invalidated ${count} in-memory entries for collection ${collectionId}`);
}

module.exports = { init, get, set, invalidateCollection };
