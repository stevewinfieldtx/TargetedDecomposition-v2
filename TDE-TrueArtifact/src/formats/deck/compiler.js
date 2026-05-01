/**
 * Deck Compiler — takes synthesized slide data and renders a complete HTML deck.
 * Each archetype has a dedicated renderer for visual variety.
 */

const { resolveBrand } = require('../../utils/brand');

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

function compileDeck(slides, { solutionName, audience, brand: brandOverrides, agendaLabels }) {
  const brand = resolveBrand(brandOverrides);
  const agenda = agendaLabels || slides.map(s => s.title);

  const slideHtml = slides.map((slide, i) => {
    const renderer = RENDERERS[slide.archetype] || renderGeneric;
    return renderer(slide, i, { brand, solutionName, audience, agenda, totalSlides: slides.length });
  }).join('\n');

  return wrapShell(slideHtml, { brand, solutionName, totalSlides: slides.length });
}

// ─────────────────────────────────────────────
// Per-archetype renderers
// ─────────────────────────────────────────────

function renderTitle(slide, idx, ctx) {
  return slideFrame(idx, ctx, `
    <div style="display:flex;flex-direction:column;justify-content:center;align-items:center;height:100%;text-align:center;">
      ${ctx.brand.logoUrl ? `<img src="${esc(ctx.brand.logoUrl)}" style="max-height:80px;margin-bottom:32px;" alt="logo">` : ''}
      <h1 style="font-size:48px;color:${ctx.brand.accent};margin:0 0 16px;">${esc(slide.title)}</h1>
      ${slide.bullets[0] ? `<p style="font-size:22px;color:${ctx.brand.textMuted};max-width:700px;">${esc(slide.bullets[0])}</p>` : ''}
      ${ctx.brand.sellerName ? `<p style="margin-top:48px;color:${ctx.brand.textMuted};font-size:16px;">Presented by ${esc(ctx.brand.sellerName)}</p>` : ''}
    </div>
  `);
}

function renderAgenda(slide, idx, ctx) {
  const items = ctx.agenda.filter((_, i) => i !== 0 && i !== ctx.totalSlides - 1); // skip title & appendix
  return slideFrame(idx, ctx, `
    <h2 style="color:${ctx.brand.accent};margin-bottom:24px;">${esc(slide.title)}</h2>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px 32px;">
      ${items.map((item, i) => `
        <div style="display:flex;align-items:center;gap:12px;">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;background:${ctx.brand.accent};color:#fff;font-weight:700;font-size:14px;flex-shrink:0;">${i + 1}</span>
          <span style="font-size:17px;">${esc(item)}</span>
        </div>
      `).join('')}
    </div>
  `);
}

function renderMarketOpportunity(slide, idx, ctx) {
  return renderStatHighlight(slide, idx, ctx);
}

function renderClientDemand(slide, idx, ctx) {
  return renderStatHighlight(slide, idx, ctx);
}

function renderPainPoints(slide, idx, ctx) {
  return slideFrame(idx, ctx, `
    <h2 style="color:${ctx.brand.accent};margin-bottom:24px;">${esc(slide.title)}</h2>
    <div style="display:flex;flex-direction:column;gap:16px;">
      ${slide.bullets.map(b => `
        <div style="display:flex;align-items:start;gap:12px;padding:14px 18px;background:rgba(239,68,68,0.08);border-left:4px solid #ef4444;border-radius:6px;">
          <span style="color:#ef4444;font-size:20px;flex-shrink:0;">&#9888;</span>
          <span style="font-size:17px;">${esc(b)}</span>
        </div>
      `).join('')}
    </div>
  `);
}

function renderThreatLandscape(slide, idx, ctx) {
  return slideFrame(idx, ctx, `
    <h2 style="color:${ctx.brand.accent};margin-bottom:24px;">${esc(slide.title)}</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px;">
      ${slide.bullets.map((b, i) => `
        <div style="background:${ctx.brand.bgCard};border:1px solid rgba(239,68,68,0.25);border-radius:10px;padding:24px;text-align:center;">
          <div style="font-size:36px;color:#ef4444;margin-bottom:8px;">${extractLeadNumber(b) || '!'}</div>
          <p style="font-size:16px;color:${ctx.brand.text};">${esc(stripLeadNumber(b))}</p>
        </div>
      `).join('')}
    </div>
  `);
}

function renderProductOverview(slide, idx, ctx) {
  return slideFrame(idx, ctx, `
    <h2 style="color:${ctx.brand.accent};margin-bottom:24px;">${esc(slide.title)}</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px;">
      ${slide.bullets.map((b, i) => `
        <div style="background:${ctx.brand.bgCard};border-radius:10px;padding:24px;border-top:3px solid ${ctx.brand.accent};">
          <div style="font-size:28px;margin-bottom:8px;">${['&#128737;','&#9889;','&#128640;','&#127919;','&#128161;','&#128736;'][i % 6]}</div>
          <p style="font-size:16px;">${esc(b)}</p>
        </div>
      `).join('')}
    </div>
  `);
}

function renderProductDeepDive(slide, idx, ctx) {
  return slideFrame(idx, ctx, `
    <h2 style="color:${ctx.brand.accent};margin-bottom:24px;">${esc(slide.title)}</h2>
    <div style="display:flex;flex-direction:column;gap:14px;">
      ${slide.bullets.map(b => `
        <div style="display:flex;align-items:start;gap:12px;padding:12px 16px;background:${ctx.brand.bgCard};border-radius:8px;">
          <span style="color:${ctx.brand.accent};font-size:18px;flex-shrink:0;">&#9654;</span>
          <span style="font-size:16px;">${esc(b)}</span>
        </div>
      `).join('')}
    </div>
  `);
}

function renderCompetitiveComparison(slide, idx, ctx) {
  return slideFrame(idx, ctx, `
    <h2 style="color:${ctx.brand.accent};margin-bottom:24px;">${esc(slide.title)}</h2>
    <table style="width:100%;border-collapse:collapse;font-size:15px;">
      ${slide.bullets.map((b, i) => `
        <tr style="border-bottom:1px solid ${ctx.brand.bgCard};">
          <td style="padding:12px 16px;color:${ctx.brand.accent};font-weight:600;">&#10003;</td>
          <td style="padding:12px 16px;">${esc(b)}</td>
        </tr>
      `).join('')}
    </table>
  `);
}

function renderRevenueModel(slide, idx, ctx) {
  return renderStatHighlight(slide, idx, ctx);
}

function renderRetentionPlay(slide, idx, ctx) {
  return slideFrame(idx, ctx, `
    <h2 style="color:${ctx.brand.accent};margin-bottom:24px;">${esc(slide.title)}</h2>
    <div style="display:flex;flex-direction:column;gap:16px;">
      ${slide.bullets.map(b => `
        <div style="display:flex;align-items:center;gap:14px;padding:16px 20px;background:${ctx.brand.bgCard};border-radius:10px;border-left:4px solid ${ctx.brand.success};">
          <span style="color:${ctx.brand.success};font-size:22px;">&#8635;</span>
          <span style="font-size:16px;">${esc(b)}</span>
        </div>
      `).join('')}
    </div>
  `);
}

function renderSalesPlaybook(slide, idx, ctx) {
  return slideFrame(idx, ctx, `
    <h2 style="color:${ctx.brand.accent};margin-bottom:24px;">${esc(slide.title)}</h2>
    <div style="display:flex;flex-direction:column;gap:14px;">
      ${slide.bullets.map((b, i) => `
        <div style="display:flex;align-items:start;gap:14px;padding:14px 18px;background:${ctx.brand.bgCard};border-radius:10px;">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:${ctx.brand.accent};color:#fff;font-weight:700;font-size:13px;flex-shrink:0;">${i + 1}</span>
          <span style="font-size:16px;">${esc(b)}</span>
        </div>
      `).join('')}
    </div>
  `);
}

function renderPartnerTracks(slide, idx, ctx) {
  return renderCardGrid(slide, idx, ctx);
}

function renderDistributorValue(slide, idx, ctx) {
  return renderCardGrid(slide, idx, ctx);
}

function renderOnboardingTimeline(slide, idx, ctx) {
  return slideFrame(idx, ctx, `
    <h2 style="color:${ctx.brand.accent};margin-bottom:24px;">${esc(slide.title)}</h2>
    <div style="position:relative;padding-left:36px;">
      <div style="position:absolute;left:14px;top:0;bottom:0;width:3px;background:${ctx.brand.accent};border-radius:2px;"></div>
      ${slide.bullets.map((b, i) => `
        <div style="position:relative;margin-bottom:20px;padding:14px 18px;background:${ctx.brand.bgCard};border-radius:10px;">
          <div style="position:absolute;left:-30px;top:16px;width:14px;height:14px;border-radius:50%;background:${ctx.brand.accent};border:3px solid ${ctx.brand.bg};"></div>
          <p style="font-size:16px;margin:0;">${esc(b)}</p>
        </div>
      `).join('')}
    </div>
  `);
}

function renderObjectionHandling(slide, idx, ctx) {
  return slideFrame(idx, ctx, `
    <h2 style="color:${ctx.brand.accent};margin-bottom:24px;">${esc(slide.title)}</h2>
    <div style="display:flex;flex-direction:column;gap:14px;">
      ${slide.bullets.map(b => `
        <div style="padding:14px 18px;background:${ctx.brand.bgCard};border-radius:10px;border-left:4px solid ${ctx.brand.warning};">
          <p style="font-size:16px;margin:0;">${esc(b)}</p>
        </div>
      `).join('')}
    </div>
  `);
}

function renderProofPoints(slide, idx, ctx) {
  return slideFrame(idx, ctx, `
    <h2 style="color:${ctx.brand.accent};margin-bottom:24px;">${esc(slide.title)}</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px;">
      ${slide.bullets.map(b => `
        <div style="background:${ctx.brand.bgCard};border-radius:10px;padding:24px;border-left:4px solid ${ctx.brand.success};">
          <p style="font-size:16px;font-style:italic;margin:0;">"${esc(b)}"</p>
        </div>
      `).join('')}
    </div>
  `);
}

function renderCTA(slide, idx, ctx) {
  return slideFrame(idx, ctx, `
    <div style="display:flex;flex-direction:column;justify-content:center;align-items:center;height:100%;text-align:center;">
      <h2 style="font-size:40px;color:${ctx.brand.accent};margin-bottom:16px;">${esc(slide.title)}</h2>
      ${slide.bullets.map(b => `<p style="font-size:20px;color:${ctx.brand.text};margin:6px 0;">${esc(b)}</p>`).join('')}
      <div style="margin-top:36px;padding:16px 48px;background:${ctx.brand.accent};color:#fff;border-radius:8px;font-size:20px;font-weight:600;">
        Let's Talk
      </div>
      ${ctx.brand.sellerName ? `<p style="margin-top:24px;color:${ctx.brand.textMuted};">${esc(ctx.brand.sellerName)}</p>` : ''}
    </div>
  `);
}

function renderAppendix(slide, idx, ctx) {
  return slideFrame(idx, ctx, `
    <h2 style="color:${ctx.brand.accent};margin-bottom:24px;">${esc(slide.title)}</h2>
    <div style="columns:2;column-gap:32px;font-size:14px;color:${ctx.brand.textMuted};">
      ${slide.bullets.map(b => `<p style="break-inside:avoid;margin:0 0 10px;">${esc(b)}</p>`).join('')}
    </div>
  `);
}

function renderComplianceMapping(slide, idx, ctx) {
  return slideFrame(idx, ctx, `
    <h2 style="color:${ctx.brand.accent};margin-bottom:24px;">${esc(slide.title)}</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;">
      ${slide.bullets.map(b => `
        <div style="background:${ctx.brand.bgCard};border-radius:10px;padding:20px;display:flex;align-items:start;gap:12px;">
          <span style="color:${ctx.brand.success};font-size:20px;flex-shrink:0;">&#10004;</span>
          <span style="font-size:15px;">${esc(b)}</span>
        </div>
      `).join('')}
    </div>
  `);
}

function renderBundlingStrategy(slide, idx, ctx) {
  return renderCardGrid(slide, idx, ctx);
}

function renderEnterpriseReadiness(slide, idx, ctx) {
  return slideFrame(idx, ctx, `
    <h2 style="color:${ctx.brand.accent};margin-bottom:24px;">${esc(slide.title)}</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;">
      ${slide.bullets.map(b => `
        <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:${ctx.brand.bgCard};border-radius:8px;">
          <span style="color:${ctx.brand.success};font-size:18px;">&#9745;</span>
          <span style="font-size:15px;">${esc(b)}</span>
        </div>
      `).join('')}
    </div>
  `);
}

function renderAttachPlaybook(slide, idx, ctx) {
  return renderSalesPlaybook(slide, idx, ctx); // same numbered-step layout
}

function renderROICalculator(slide, idx, ctx) {
  return renderStatHighlight(slide, idx, ctx);
}

function renderUseCases(slide, idx, ctx) {
  return renderCardGrid(slide, idx, ctx);
}

// ─────────────────────────────────────────────
// Shared layout helpers
// ─────────────────────────────────────────────

function renderGeneric(slide, idx, ctx) {
  return slideFrame(idx, ctx, `
    <h2 style="color:${ctx.brand.accent};margin-bottom:24px;">${esc(slide.title)}</h2>
    <ul style="list-style:none;padding:0;display:flex;flex-direction:column;gap:12px;">
      ${slide.bullets.map(b => `
        <li style="padding:10px 16px;background:${ctx.brand.bgCard};border-radius:8px;font-size:16px;">
          <span style="color:${ctx.brand.accent};margin-right:8px;">&#8226;</span>${esc(b)}
        </li>
      `).join('')}
    </ul>
  `);
}

function renderStatHighlight(slide, idx, ctx) {
  return slideFrame(idx, ctx, `
    <h2 style="color:${ctx.brand.accent};margin-bottom:24px;">${esc(slide.title)}</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px;">
      ${slide.bullets.map(b => {
        const num = extractLeadNumber(b);
        const text = stripLeadNumber(b);
        return `
          <div style="background:${ctx.brand.bgCard};border-radius:10px;padding:28px;text-align:center;">
            ${num ? `<div style="font-size:36px;font-weight:700;color:${ctx.brand.accent};margin-bottom:8px;">${num}</div>` : ''}
            <p style="font-size:15px;color:${ctx.brand.text};margin:0;">${esc(text)}</p>
          </div>
        `;
      }).join('')}
    </div>
  `);
}

function renderCardGrid(slide, idx, ctx) {
  return slideFrame(idx, ctx, `
    <h2 style="color:${ctx.brand.accent};margin-bottom:24px;">${esc(slide.title)}</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px;">
      ${slide.bullets.map(b => `
        <div style="background:${ctx.brand.bgCard};border-radius:10px;padding:24px;border-top:3px solid ${ctx.brand.accent};">
          <p style="font-size:16px;margin:0;">${esc(b)}</p>
        </div>
      `).join('')}
    </div>
  `);
}

function slideFrame(idx, ctx, inner) {
  return `
    <section class="slide" data-index="${idx}" style="
      width:960px;min-height:540px;padding:48px 56px;
      background:${ctx.brand.bg};color:${ctx.brand.text};
      font-family:${ctx.brand.fontFamily};
      box-sizing:border-box;page-break-after:always;
      position:relative;margin:0 auto 24px;
      border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.3);
    ">
      ${inner}
      <div style="position:absolute;bottom:18px;right:24px;font-size:12px;color:${ctx.brand.textMuted};">
        ${idx + 1} / ${ctx.totalSlides}
      </div>
    </section>
  `;
}

// ─────────────────────────────────────────────
// HTML shell with nav
// ─────────────────────────────────────────────

function wrapShell(slideHtml, { brand, solutionName, totalSlides }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(solutionName)} — Deck</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#000; font-family:${brand.fontFamily}; }
  .deck-container { max-width:1020px; margin:0 auto; padding:24px; }
  .slide { transition: opacity 0.3s ease; }
  .nav-bar {
    position:fixed; bottom:0; left:0; right:0;
    background:rgba(15,23,42,0.95); backdrop-filter:blur(8px);
    padding:12px 24px; display:flex; justify-content:center; gap:16px;
    z-index:100; border-top:1px solid rgba(255,255,255,0.1);
  }
  .nav-bar button {
    background:${brand.accent}; color:#fff; border:none;
    padding:10px 24px; border-radius:6px; cursor:pointer;
    font-size:15px; font-weight:600;
  }
  .nav-bar button:hover { opacity:0.85; }
  .nav-bar span { color:${brand.textMuted}; line-height:42px; font-size:14px; }
  @media print {
    .nav-bar { display:none; }
    .slide { break-inside:avoid; box-shadow:none; margin:0; border-radius:0; }
  }
</style>
</head>
<body>
<div class="deck-container" id="deck">
${slideHtml}
</div>
<div class="nav-bar">
  <button onclick="navigate(-1)">&#9664; Prev</button>
  <span id="slideCounter">1 / ${totalSlides}</span>
  <button onclick="navigate(1)">Next &#9654;</button>
  <button onclick="toggleView()" id="viewToggle">Presenter View</button>
</div>
<script>
(function(){
  const slides = document.querySelectorAll('.slide');
  let current = 0;
  let presenterMode = false;

  function showSlide(n) {
    if (presenterMode) return;
    slides.forEach((s, i) => {
      s.style.display = i === n ? 'block' : 'none';
    });
    document.getElementById('slideCounter').textContent = (n+1) + ' / ' + slides.length;
  }

  window.navigate = function(dir) {
    if (presenterMode) return;
    current = Math.max(0, Math.min(slides.length - 1, current + dir));
    showSlide(current);
  };

  window.toggleView = function() {
    presenterMode = !presenterMode;
    slides.forEach(s => s.style.display = 'block');
    document.getElementById('viewToggle').textContent = presenterMode ? 'Slide View' : 'Presenter View';
    if (!presenterMode) showSlide(current);
  };

  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight' || e.key === ' ') navigate(1);
    if (e.key === 'ArrowLeft') navigate(-1);
  });

  showSlide(0);
})();
</script>
</body>
</html>`;
}

// ─────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function extractLeadNumber(text) {
  const m = String(text).match(/^(\$?[\d,.]+[%+BMKx]?)/);
  return m ? m[1] : null;
}

function stripLeadNumber(text) {
  return String(text).replace(/^(\$?[\d,.]+[%+BMKx]?\s*[-—:]*\s*)/, '').trim();
}

// ─────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────

const RENDERERS = {
  title: renderTitle,
  agenda: renderAgenda,
  market_opportunity: renderMarketOpportunity,
  client_demand: renderClientDemand,
  pain_points_reflected: renderPainPoints,
  threat_landscape: renderThreatLandscape,
  product_overview: renderProductOverview,
  product_deep_dive: renderProductDeepDive,
  competitive_comparison: renderCompetitiveComparison,
  revenue_model: renderRevenueModel,
  retention_play: renderRetentionPlay,
  sales_playbook: renderSalesPlaybook,
  partner_tracks: renderPartnerTracks,
  distributor_value: renderDistributorValue,
  onboarding_timeline: renderOnboardingTimeline,
  objection_handling: renderObjectionHandling,
  proof_points: renderProofPoints,
  cta: renderCTA,
  appendix: renderAppendix,
  compliance_mapping: renderComplianceMapping,
  bundling_strategy: renderBundlingStrategy,
  enterprise_readiness: renderEnterpriseReadiness,
  attach_playbook: renderAttachPlaybook,
  roi_calculator: renderROICalculator,
  use_cases: renderUseCases,
};

module.exports = { compileDeck, RENDERERS };
