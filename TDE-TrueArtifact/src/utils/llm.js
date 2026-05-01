const config = require('../config');

async function callLLM(prompt, options = {}) {
  const { model = config.ANALYSIS_MODEL, maxTokens = 4000, temperature = 0.3, system = '' } = options;
  if (!config.OPENROUTER_API_KEY) { console.error('  OPENROUTER_API_KEY not set'); return null; }
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  try {
    const resp = await fetch(`${config.OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${config.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
    });
    if (!resp.ok) { const text = await resp.text(); console.error(`  LLM error ${resp.status}: ${text.slice(0, 200)}`); return null; }
    const data = await resp.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (err) { console.error(`  LLM call failed: ${err.message}`); return null; }
}

async function callLLMFast(prompt, options = {}) {
  const { maxTokens = 4000, temperature = 0.3, system = '' } = options;
  if (config.CEREBRAS_API_KEY) {
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });
    try {
      const t0 = Date.now();
      const resp = await fetch(`${config.CEREBRAS_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${config.CEREBRAS_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.CEREBRAS_MODEL, messages, max_tokens: maxTokens, temperature }),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        console.error(`  [Cerebras] error ${resp.status}: ${errText.slice(0, 200)} — falling back`);
      } else {
        const data = await resp.json();
        const content = data.choices?.[0]?.message?.content;
        if (content) { console.log(`  [Cerebras] ${config.CEREBRAS_MODEL}: ${((Date.now() - t0) / 1000).toFixed(2)}s`); return content; }
        console.error(`  [Cerebras] empty response — falling back`);
      }
    } catch (err) { console.error(`  [Cerebras] call failed: ${err.message} — falling back`); }
  }
  return callLLM(prompt, options);
}

async function callLLMJSON(prompt, options = {}) {
  const raw = await callLLM(prompt, options);
  if (!raw) return null;
  return parseJSONResponse(raw);
}

function parseJSONResponse(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const codeMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeMatch) { try { return JSON.parse(codeMatch[1]); } catch {} }
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) { try { return JSON.parse(objMatch[0]); } catch {} }
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch) { try { return JSON.parse(arrMatch[0]); } catch {} }
  return null;
}

module.exports = { callLLM, callLLMFast, callLLMJSON, parseJSONResponse };
