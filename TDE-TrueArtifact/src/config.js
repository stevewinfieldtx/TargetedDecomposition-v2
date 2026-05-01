require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 8600,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '',
  OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  CEREBRAS_API_KEY: process.env.CEREBRAS_API_KEY || '',
  CEREBRAS_BASE_URL: process.env.CEREBRAS_BASE_URL || 'https://api.cerebras.ai/v1',
  CEREBRAS_MODEL: process.env.CEREBRAS_MODEL || 'llama-3.3-70b',
  ANALYSIS_MODEL: process.env.ANALYSIS_MODEL || 'qwen/qwen-2.5-72b-instruct',
  CONTENT_MODEL: process.env.CONTENT_MODEL || 'meta-llama/llama-3.1-70b-instruct',
  INTERNAL_AUTH_TOKEN: process.env.INTERNAL_AUTH_TOKEN || '',
};
