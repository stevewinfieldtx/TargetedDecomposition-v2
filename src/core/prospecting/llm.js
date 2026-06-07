/**
 * Prospecting — cheap LLM via OpenRouter.
 * Defaults to an inexpensive model; override with PROSPECT_MODEL (you can point
 * this at a ":free" OpenRouter model to make discovery effectively $0).
 */
const MODEL = process.env.PROSPECT_MODEL || 'meta-llama/llama-3.1-8b-instruct';

async function cheapChat(system, user, { json = false, temperature = 0.2 } = {}) {
  if (!process.env.OPENROUTER_API_KEY) return json ? {} : '';
  const body = {
    model: MODEL, temperature,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  };
  if (json) body.response_format = { type: 'json_object' };
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.OPENROUTER_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(45000),
    });
    if (!r.ok) return json ? {} : '';
    const txt = ((await r.json()).choices?.[0]?.message?.content) || '';
    if (!json) return txt;
    try { return JSON.parse(txt); } catch { const m = txt.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : {}; }
  } catch { return json ? {} : ''; }
}

module.exports = { cheapChat, MODEL };
