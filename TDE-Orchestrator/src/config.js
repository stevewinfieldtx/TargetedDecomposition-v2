require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 8500,
  TDE_INTERNAL_URL: process.env.TDE_INTERNAL_URL || 'http://localhost:8400',
  TRUEARTIFACT_INTERNAL_URL: process.env.TRUEARTIFACT_INTERNAL_URL || 'http://localhost:8600',
  API_SECRET_KEY: process.env.API_SECRET_KEY || '',
  TRUEARTIFACT_AUTH_TOKEN: process.env.TRUEARTIFACT_AUTH_TOKEN || '',
  CACHE_DATABASE_URL: process.env.CACHE_DATABASE_URL || '',
  CACHE_TTL: {
    email: 7 * 24 * 3600,
    deck: 14 * 24 * 3600,
    social_image: 7 * 24 * 3600,
    one_pager: 7 * 24 * 3600,
    battlecard: 7 * 24 * 3600,
    intel: 24 * 3600,
    respond: 0,
  },
  SUPPORTED_FORMATS: ['email', 'deck', 'social_image', 'one_pager', 'battlecard'],
  ASYNC_FORMATS: ['deck'],
  SUPPORTED_INTENTS: [
    'competitive_brief',
    'executive_summary',
    'discovery_questions',
    'enrichment',
    'objection_handling',
    'custom',
  ],
};
