const express = require('express');
const config = require('./config');
const auth = require('./middleware/auth');
const cache = require('./cache');

// Route modules
const craftRouter = require('./routes/craft');
const respondRouter = require('./routes/respond');
const intelRouter = require('./routes/intel');
const researchRouter = require('./routes/research');
const collectionsRouter = require('./routes/collections');
const jobsRouter = require('./routes/jobs');

const app = express();

// ── Body parser ───────────────────────────────────────
app.use(express.json({ limit: '50mb' }));

// ── Health check (no auth) ────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'tde-orchestrator',
    version: '1.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ── Auth middleware (all routes below require it) ──────
app.use(auth);

// ── Route groups ──────────────────────────────────────
app.use('/craft', craftRouter);
app.use('/respond', respondRouter);
app.use('/intel', intelRouter);
app.use('/research', researchRouter);
app.use('/collections', collectionsRouter);
app.use('/jobs', jobsRouter);

// ── 404 catch-all ─────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.path}`,
  });
});

// ── Global error handler ──────────────────────────────
app.use((err, req, res, _next) => {
  console.error(`[server] Unhandled error on ${req.method} ${req.path}:`, err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────
async function start() {
  // Initialize cache
  await cache.init(config.CACHE_DATABASE_URL || null);

  app.listen(config.PORT, () => {
    console.log('');
    console.log('==========================================================');
    console.log('  THE ORCHESTRATOR  —  OppIntelAI Central Control Plane');
    console.log('==========================================================');
    console.log(`  Port:            ${config.PORT}`);
    console.log(`  TDE engine:      ${config.TDE_INTERNAL_URL}`);
    console.log(`  TrueArtifact:    ${config.TRUEARTIFACT_INTERNAL_URL}`);
    console.log(`  Auth:            ${config.API_SECRET_KEY ? 'ENABLED' : 'DEV MODE (no key)'}`);
    console.log(`  Cache:           ${config.CACHE_DATABASE_URL ? 'PostgreSQL' : 'In-memory'}`);
    console.log('');
    console.log('  Endpoints:');
    console.log('    GET  /health');
    console.log('    POST /craft');
    console.log('    POST /respond');
    console.log('    POST /intel');
    console.log('    POST /research');
    console.log('    GET  /collections');
    console.log('    GET  /collections/:id');
    console.log('    GET  /collections/:id/health');
    console.log('    GET  /jobs/:jobId');
    console.log('==========================================================');
    console.log('');
  });
}

start().catch((err) => {
  console.error('[server] Fatal startup error:', err);
  process.exit(1);
});
