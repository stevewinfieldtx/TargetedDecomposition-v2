const express = require('express');
const config = require('./config');
const { route } = require('./router');

const app = express();

app.use(express.json({ limit: '50mb' }));

// Health check — no auth required
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'TrueArtifact', timestamp: new Date().toISOString() });
});

// Bearer token auth middleware
function authMiddleware(req, res, next) {
  if (!config.INTERNAL_AUTH_TOKEN) return next(); // no token configured = open
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token !== config.INTERNAL_AUTH_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Main render endpoint
app.post('/render', authMiddleware, async (req, res) => {
  const t0 = Date.now();
  const { format, atoms, audience, solutionName, context } = req.body;

  if (!format) return res.status(400).json({ error: 'Missing required field: format' });
  if (!atoms || !Array.isArray(atoms)) return res.status(400).json({ error: 'Missing or invalid field: atoms (must be array)' });

  console.log(`\n[Render] format=${format} atoms=${atoms.length} audience=${audience || 'unset'} solution=${solutionName || 'unset'}`);

  try {
    const result = await route(format, { atoms, audience, solutionName, context: context || {} });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    console.log(`[Render] ${format} completed in ${elapsed}s`);
    res.json({ ok: true, elapsed_seconds: parseFloat(elapsed), ...result });
  } catch (err) {
    console.error(`[Render] ${format} failed:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(config.PORT, () => {
  console.log(`\n========================================`);
  console.log(`  TrueArtifact v1.0.0`);
  console.log(`  Port:       ${config.PORT}`);
  console.log(`  Auth:       ${config.INTERNAL_AUTH_TOKEN ? 'ENABLED' : 'DISABLED (no token)'}`);
  console.log(`  OpenRouter: ${config.OPENROUTER_API_KEY ? 'configured' : 'MISSING'}`);
  console.log(`  Cerebras:   ${config.CEREBRAS_API_KEY ? 'configured' : 'not set (will use OpenRouter)'}`);
  console.log(`  Analysis:   ${config.ANALYSIS_MODEL}`);
  console.log(`  Content:    ${config.CONTENT_MODEL}`);
  console.log(`========================================\n`);
});
