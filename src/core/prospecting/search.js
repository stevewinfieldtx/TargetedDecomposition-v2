/**
 * Prospecting — free/cheap web search with multiple fallbacks.
 * Order: Brave API (free tier) -> Serper (Google, free trial credits) -> DuckDuckGo HTML.
 * Brave & Serper are real APIs that work from datacenter IPs (Railway); the
 * DuckDuckGo HTML scrape is the last resort and is often blocked on datacenter IPs.
 * Returns [{ title, url, snippet }].
 */
const cheerio = require('cheerio');

async function braveSearch(query, count = 10) {
  if (!process.env.BRAVE_API_KEY) return null;
  try {
    const r = await fetch(
      'https://api.search.brave.com/res/v1/web/search?q=' + encodeURIComponent(query) + '&count=' + count,
      { headers: { 'X-Subscription-Token': process.env.BRAVE_API_KEY, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const j = await r.json();
    return ((j.web && j.web.results) || []).map((x) => ({ title: x.title, url: x.url, snippet: x.description }));
  } catch { return null; }
}

async function serperSearch(query, count = 10) {
  if (!process.env.SERPER_API_KEY) return null;
  try {
    const r = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: count }), signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return (j.organic || []).map((x) => ({ title: x.title, url: x.link, snippet: x.snippet }));
  } catch { return null; }
}

async function duckSearch(query) {
  try {
    const r = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query),
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DrixProspectBot/1.0)' },
        signal: AbortSignal.timeout(15000) });
    if (!r.ok) return [];
    const $ = cheerio.load(await r.text());
    const out = [];
    $('.result__a').each((i, el) => {
      const a = $(el);
      let href = a.attr('href') || '';
      const m = href.match(/uddg=([^&]+)/);
      if (m) href = decodeURIComponent(m[1]);
      const snippet = $(el).closest('.result').find('.result__snippet').text();
      if (href) out.push({ title: a.text().trim(), url: href, snippet });
    });
    return out;
  } catch { return []; }
}

async function webSearchDebug(query, count = 10) {
  let r = await braveSearch(query, count); if (r && r.length) return { engine: 'brave', count: r.length, results: r };
  r = await serperSearch(query, count); if (r && r.length) return { engine: 'serper', count: r.length, results: r };
  r = await duckSearch(query); return { engine: 'duckduckgo', count: r.length, results: r };
}

async function webSearch(query, count = 10) {
  return (await webSearchDebug(query, count)).results;
}

module.exports = { webSearch, webSearchDebug, braveSearch, serperSearch, duckSearch };
