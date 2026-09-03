/**
 * Pure helpers for researcher item-analysis highlights.
 * Operates on summary.items[] count histograms [c1..c7] (Likert 1–7).
 *
 * Formulas (presentation only; underlying counts unchanged):
 *   n = Σ counts
 *   mean = Σ(v * c_v) / n for v = 1..7
 *   sample SD (n > 1): sqrt( Σ(c_v * (v - mean)^2) / (n - 1) )
 *   population SD (n ≤ 1 or fallback): sqrt( Σ(c_v * (v - mean)^2) / n )
 *   polarization P = (c1 + c7) / n
 */

export const LIKERT_MIN = 1;
export const LIKERT_MAX = 7;
export const DEFAULT_HIGHLIGHT_COUNT = 5;

function asCounts(counts) {
  const raw = Array.isArray(counts) ? counts : [];
  const out = [];
  for (let i = 0; i < 7; i += 1) {
    const value = Number(raw[i]) || 0;
    out.push(value >= 0 ? value : 0);
  }
  return out;
}

/**
 * @param {number[]} counts - length-7 histogram for values 1..7
 * @returns {{ n: number, mean: number|null, sd: number|null, sdKind: 'sample'|'population'|null, polarization: number|null }}
 */
export function statsFromCounts(counts) {
  const c = asCounts(counts);
  const n = c.reduce((sum, value) => sum + value, 0);
  if (n <= 0) {
    return { n: 0, mean: null, sd: null, sdKind: null, polarization: null };
  }

  let weighted = 0;
  for (let i = 0; i < 7; i += 1) {
    weighted += (i + 1) * c[i];
  }
  const mean = weighted / n;

  let sumSq = 0;
  for (let i = 0; i < 7; i += 1) {
    const delta = i + 1 - mean;
    sumSq += c[i] * delta * delta;
  }

  const useSample = n > 1;
  const sd = Math.sqrt(sumSq / (useSample ? n - 1 : n));
  const polarization = (c[0] + c[6]) / n;

  return {
    n,
    mean,
    sd,
    sdKind: useSample ? 'sample' : 'population',
    polarization,
  };
}

/**
 * @param {{ id: string, counts?: number[] }[]} items
 * @param {{ labels?: Record<string, string>, highlightCount?: number }} [options]
 */
export function rankItemHighlights(items, options = {}) {
  const highlightCount = Math.max(1, Number(options.highlightCount) || DEFAULT_HIGHLIGHT_COUNT);
  const labels = options.labels || {};
  const scored = (Array.isArray(items) ? items : [])
    .map((item) => {
      const id = String(item?.id || '');
      const counts = asCounts(item?.counts);
      const stats = statsFromCounts(counts);
      return {
        id,
        label: labels[id] || '',
        counts,
        ...stats,
      };
    })
    .filter((row) => row.id && row.n > 0 && row.mean != null);

  const byMeanDesc = [...scored].sort((a, b) => b.mean - a.mean || a.id.localeCompare(b.id));
  const byMeanAsc = [...scored].sort((a, b) => a.mean - b.mean || a.id.localeCompare(b.id));
  const byPolarizationDesc = [...scored].sort(
    (a, b) =>
      b.polarization - a.polarization ||
      (b.sd ?? 0) - (a.sd ?? 0) ||
      a.id.localeCompare(b.id)
  );

  return {
    highest: byMeanDesc.slice(0, highlightCount),
    lowest: byMeanAsc.slice(0, highlightCount),
    mostDivided: byPolarizationDesc.slice(0, highlightCount),
    all: scored,
  };
}
