// Robust, small-sample statistical primitives for the focus/energy estimator.
//
// Everything here is pure, dependency-free, and closed-form. It is written for
// the sparse, noisy data a single student produces (tens of sessions, not
// thousands), so each primitive degrades gracefully on tiny inputs rather than
// throwing or returning NaN. Robust estimators (median / MAD / Theil-Sen) are
// preferred over mean / SD / least-squares because a couple of outlier sessions
// should not swing a personal estimate. Unit-tested in `stats/__tests__`.

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function clamp01(n: number): number {
  return Number.isFinite(n) ? clamp(n, 0, 1) : 0;
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
  return Math.sqrt(v);
}

/** Median of a numeric array (0 on empty). Does not mutate the input. */
export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Median absolute deviation, scaled by 1.4826 so it estimates the standard
 * deviation for normal data. A robust, outlier-resistant spread. Returns 0 when
 * there is no spread (which callers treat as "fall back to a floor").
 */
export function mad(xs: number[], center?: number): number {
  if (xs.length === 0) return 0;
  const c = center ?? median(xs);
  const devs = xs.map((x) => Math.abs(x - c));
  return 1.4826 * median(devs);
}

/** Robust z-score: (x - center) / scale, with a scale floor to avoid blow-ups. */
export function robustZ(x: number, center: number, scale: number, scaleFloor = 1e-6): number {
  const s = Math.max(Math.abs(scale), scaleFloor);
  return (x - center) / s;
}

export function weightedMean(xs: number[], ws: number[]): number {
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i += 1) {
    num += xs[i] * ws[i];
    den += ws[i];
  }
  return den > 0 ? num / den : 0;
}

/**
 * Empirical-Bayes shrinkage weight for partial pooling: how much to trust a
 * per-user estimate built from `n` observations vs. a population prior.
 * `w = n / (n + k)` → 0 with no data (all prior), → 1 as n grows. `k` is the
 * "prior strength" in pseudo-observations.
 */
export function shrinkageWeight(n: number, k: number): number {
  if (n <= 0) return 0;
  return n / (n + Math.max(0, k));
}

/** Blend a personal estimate toward a prior by a shrinkage weight. */
export function shrink(personal: number, prior: number, n: number, k: number): number {
  const w = shrinkageWeight(n, k);
  return w * personal + (1 - w) * prior;
}

/**
 * Time-decayed (exponential) weighted mean. Points are {t, v} where t is a day
 * number (or any monotone time unit); more recent points (closer to `nowT`)
 * count more, with the given `halfLifeDays`. Recency weighting replaces hard
 * trailing windows so stale data fades instead of dropping off a cliff.
 */
export function ewma(
  points: { t: number; v: number }[],
  halfLifeDays: number,
  nowT?: number,
): number {
  if (points.length === 0) return 0;
  const now = nowT ?? Math.max(...points.map((p) => p.t));
  const lambda = Math.LN2 / Math.max(1e-6, halfLifeDays);
  let num = 0;
  let den = 0;
  for (const p of points) {
    // Weight by distance from the reference time. With the default nowT (= the
    // latest point) every point is in the past, so this is a standard trailing
    // EWMA; abs() just keeps it well-behaved if nowT sits inside the series.
    const w = Math.exp(-lambda * Math.abs(now - p.t));
    num += w * p.v;
    den += w;
  }
  return den > 0 ? num / den : 0;
}

/**
 * Theil-Sen robust slope: the median of pairwise slopes. Resistant to outliers,
 * works on tiny samples, and needs no distribution assumption. Intercept is the
 * median of (y - slope*x). Returns slope 0 for < 2 points.
 */
export function theilSen(points: { x: number; y: number }[]): { slope: number; intercept: number } {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: n === 1 ? points[0].y : 0 };
  const slopes: number[] = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const dx = points[j].x - points[i].x;
      if (dx !== 0) slopes.push((points[j].y - points[i].y) / dx);
    }
  }
  if (slopes.length === 0) return { slope: 0, intercept: median(points.map((p) => p.y)) };
  const slope = median(slopes);
  const intercept = median(points.map((p) => p.y - slope * p.x));
  return { slope, intercept };
}

/**
 * Theil-Sen slope with a rank-based confidence interval on the pairwise slopes.
 * Not a rigorous CI for small n, but an honest "how sure is the direction"
 * spread: the central (level) fraction of pairwise slopes.
 */
export function theilSenSlopeCI(
  points: { x: number; y: number }[],
  level = 0.9,
): { slope: number; lo: number; hi: number } {
  const n = points.length;
  if (n < 3) {
    const { slope } = theilSen(points);
    return { slope, lo: slope, hi: slope };
  }
  const slopes: number[] = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const dx = points[j].x - points[i].x;
      if (dx !== 0) slopes.push((points[j].y - points[i].y) / dx);
    }
  }
  slopes.sort((a, b) => a - b);
  const tail = (1 - level) / 2;
  const lo = slopes[Math.floor(tail * (slopes.length - 1))];
  const hi = slopes[Math.ceil((1 - tail) * (slopes.length - 1))];
  return { slope: median(slopes), lo, hi };
}

/**
 * Solve A·x = b by Gaussian elimination with partial pivoting. A is square
 * (N×N, N small). Returns a zero vector if the system is singular rather than
 * throwing — callers fall back to the prior.
 */
export function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  // Work on copies.
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col += 1) {
    // Partial pivot: largest magnitude in this column.
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) return new Array(n).fill(0); // singular
    [M[col], M[pivot]] = [M[pivot], M[col]];
    // Eliminate below.
    for (let r = col + 1; r < n; r += 1) {
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c += 1) M[r][c] -= f * M[col][c];
    }
  }
  // Back-substitute.
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i -= 1) {
    let s = M[i][n];
    for (let c = i + 1; c < n; c += 1) s -= M[i][c] * x[c];
    x[i] = s / M[i][i];
  }
  return x;
}

/**
 * Ridge regression with a NON-ZERO prior mean (Tikhonov / MAP with a Gaussian
 * prior centered at `priorMean`): minimize ||Xβ − y||² + Σ_j λ_j (β_j − m_j)².
 * Closed form: (XᵀX + Λ)β = Xᵀy + Λ·m, Λ = diag(λ).
 *
 * This is the engine of the partial-pooling model: `priorMean` is the existing
 * heuristic's coefficients and `lambda` scales with inverse data volume, so with
 * few labels β stays near the heuristic and with many labels the user's own data
 * takes over. `X` rows are feature vectors (include a bias column yourself if
 * wanted); `lambda` is a scalar or per-coefficient vector.
 */
export function ridgeSolve(
  X: number[][],
  y: number[],
  lambda: number | number[],
  priorMean?: number[],
): number[] {
  const rows = X.length;
  const p = rows > 0 ? X[0].length : 0;
  if (p === 0) return [];
  const lam = Array.isArray(lambda) ? lambda : new Array(p).fill(lambda);
  const m = priorMean ?? new Array(p).fill(0);
  // XᵀX + Λ
  const A: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  const rhs = new Array(p).fill(0);
  for (let a = 0; a < p; a += 1) {
    for (let b = 0; b < p; b += 1) {
      let s = 0;
      for (let r = 0; r < rows; r += 1) s += X[r][a] * X[r][b];
      A[a][b] = s + (a === b ? lam[a] : 0);
    }
    let ry = 0;
    for (let r = 0; r < rows; r += 1) ry += X[r][a] * y[r];
    rhs[a] = ry + lam[a] * m[a];
  }
  return solveLinear(A, rhs);
}

export interface CvResult {
  /** Mean absolute error of the leave-one-out predictions. */
  mae: number;
  /** Leave-one-out R² (coefficient of determination); can be negative. */
  r2: number;
  /** Per-point leave-one-out predictions, in input order. */
  preds: number[];
}

/**
 * Leave-one-out cross-validation for the ridge-with-prior model. Refits n times
 * (n is small). This is what lets us report an HONEST validated accuracy for the
 * personal model instead of asserting a made-up confidence.
 */
export function looCV(
  X: number[][],
  y: number[],
  lambda: number | number[],
  priorMean?: number[],
): CvResult {
  const n = y.length;
  if (n < 3) return { mae: NaN, r2: NaN, preds: new Array(n).fill(NaN) };
  const preds = new Array(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    const Xtr = X.filter((_, k) => k !== i);
    const ytr = y.filter((_, k) => k !== i);
    const beta = ridgeSolve(Xtr, ytr, lambda, priorMean);
    preds[i] = X[i].reduce((s, xj, j) => s + xj * beta[j], 0);
  }
  const errs = preds.map((p, i) => Math.abs(p - y[i]));
  const mae = mean(errs);
  const yMean = mean(y);
  const ssTot = y.reduce((s, yi) => s + (yi - yMean) * (yi - yMean), 0);
  const ssRes = preds.reduce((s, p, i) => s + (p - y[i]) * (p - y[i]), 0);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  return { mae, r2, preds };
}

/** Pearson correlation with an optional integer lag (y shifted forward by `lag`). */
export function correlation(xs: number[], ys: number[], lag = 0): number {
  const pairs: [number, number][] = [];
  for (let i = 0; i < xs.length; i += 1) {
    const j = i + lag;
    if (j >= 0 && j < ys.length) pairs.push([xs[i], ys[j]]);
  }
  if (pairs.length < 2) return 0;
  const mx = mean(pairs.map((p) => p[0]));
  const my = mean(pairs.map((p) => p[1]));
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (const [x, y] of pairs) {
    num += (x - mx) * (y - my);
    dx += (x - mx) ** 2;
    dy += (y - my) ** 2;
  }
  const den = Math.sqrt(dx * dy);
  return den > 0 ? clamp(num / den, -1, 1) : 0;
}
