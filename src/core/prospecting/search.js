/**
 * Prospecting — free/cheap web search.
 * Brave Search API (free tier) if BRAVE_API_KEY is set, else DuckDuckGo HTML
 * (no key, no quota). Returns [{ title, url, snippet }].
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
      const m = href.match(/uddg=([^&]+)/); // DDG wraps the real URL
      if (m) href = decodeURIComponent(m[1]);
      const snippet = $(el).closest('.result').find('.result__snippet').text();
      if (href) out.push({ title: a.text().trim(), url: href, snippet });
    });
    return out;
  } catch { return []; }
}

async function webSearch(query, count = 10) {
  const b = await braveSearch(query, count);
  if (b && b.length) return b;
  return duckSearch(query);
}

module.exports = { webSearch, braveSearch, duckSearch };
