/**
 * FitScore — deterministic ICP scoring.
 * ───────────────────────────────────────────────────────────────────
 * Maps resolved signal points -> 0..100 score -> colour band.
 * This is FitScore's own IP; TDE supplies the underlying intel/firmographics.
 */

const DEFAULT_THRESHOLDS = { dark_green: 80, green: 60, yellow: 40 };

function colourFor(score, thresholds = DEFAULT_THRESHOLDS) {
  const t = { ...DEFAULT_THRESHOLDS, ...(thresholds || {}) };
  if (score >= t.dark_green) return 'dark_green';
  if (score >= t.green) return 'green';
  if (score >= t.yellow) return 'yellow';
  return 'unqualified';
}

/**
 * Deterministic score from resolved signals { signalKey: points }.
 * Sums points, clamps to 0..100, assigns colour from rubric thresholds.
 */
function scoreFromSignals(rubric, signals) {
  const vals = Object.values(signals || {}).filter((v) => typeof v === 'number');
  let total = vals.reduce((a, b) => a + b, 0);
  total = Math.max(0, Math.min(100, total));
  const score = Math.round(total * 100) / 100;
  return { score, colour: colourFor(score, (rubric || {}).thresholds) };
}

module.exports = { DEFAULT_THRESHOLDS, colourFor, scoreFromSignals };
