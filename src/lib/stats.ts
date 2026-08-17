/** Small statistics helpers. No dependencies — everything here is exact or a
 *  well-known closed-form approximation, and each is unit-testable in isolation. */

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Percentile rank of `x` within `sorted` (ascending), 0-100.
 * Uses the midpoint of the tied block so identical values get identical ranks.
 */
export function percentileRank(sorted: number[], x: number): number {
  const n = sorted.length;
  if (n === 0) return 50;
  if (n === 1) return 50;
  let below = 0;
  let equal = 0;
  for (const v of sorted) {
    if (v < x) below++;
    else if (v === x) equal++;
  }
  return ((below + equal / 2) / n) * 100;
}

/** Value at the given percentile (0-100) of an unsorted sample. */
export function quantile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

/**
 * Empirical-Bayes shrinkage toward the cohort mean.
 *   smoothed = (x + mu*k) / (n + k)
 * `k` is a pseudo-count in units of impressions: a post needs roughly `k`
 * impressions before its own rate outweighs the prior.
 */
export function shrink(x: number, n: number, mu: number, k = 300): number {
  if (n <= 0) return mu;
  return (x + mu * k) / (n + k);
}

/** Spearman rank correlation. Returns 0 for degenerate input. */
export function spearman(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const rank = (xs: number[]) => {
    const idx = xs.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(xs.length);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(a.slice(0, n));
  const rb = rank(b.slice(0, n));
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = ra[i] - ma;
    const y = rb[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (da === 0 || db === 0) return 0;
  return num / Math.sqrt(da * db);
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26 via erf). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p =
    d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

/**
 * Two-proportion z-test. Returns a two-sided p-value.
 * Used for A/B pairs where the metric is (successes / impressions).
 */
export function twoProportionTest(
  x1: number,
  n1: number,
  x2: number,
  n2: number,
): { p: number; lift: number; z: number } {
  if (n1 <= 0 || n2 <= 0) return { p: 1, lift: 0, z: 0 };
  const p1 = x1 / n1;
  const p2 = x2 / n2;
  const pooled = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return { p: 1, lift: 0, z: 0 };
  const z = (p2 - p1) / se;
  const p = 2 * (1 - normalCdf(Math.abs(z)));
  const lift = p1 === 0 ? 0 : (p2 - p1) / p1;
  return { p, lift, z };
}

/** Gamma sampler (Marsaglia-Tsang), needed for Beta sampling. */
function sampleGamma(shape: number): number {
  if (shape < 1) {
    const u = Math.random();
    return sampleGamma(shape + 1) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = gaussian();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function gaussian(): number {
  // Box-Muller
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Draw from Beta(alpha, beta). */
export function sampleBeta(alpha: number, beta: number): number {
  const a = Math.max(alpha, 1e-6);
  const b = Math.max(beta, 1e-6);
  const x = sampleGamma(a);
  const y = sampleGamma(b);
  return x / (x + y);
}
