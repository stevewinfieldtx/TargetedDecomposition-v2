const config = require('../config');

/**
 * API key authentication middleware.
 * Checks x-api-key header against API_SECRET_KEY.
 * If API_SECRET_KEY is unset, warns and allows through (dev mode).
 */
function auth(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  // Dev mode — no secret configured
  if (!config.API_SECRET_KEY) {
    if (!req._authWarned) {
      console.warn('[auth] API_SECRET_KEY is not set — running in dev mode, all requests allowed');
      req._authWarned = true;
    }
    return next();
  }

  if (!apiKey) {
    console.warn(`[auth] Missing x-api-key header from ${req.ip} ${req.method} ${req.path}`);
    return res.status(401).json({ success: false, error: 'Missing x-api-key header' });
  }

  if (apiKey !== config.API_SECRET_KEY) {
    console.warn(`[auth] Invalid API key from ${req.ip} ${req.method} ${req.path}`);
    return res.status(401).json({ success: false, error: 'Invalid API key' });
  }

  next();
}

module.exports = auth;
