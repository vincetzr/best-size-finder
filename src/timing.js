/**
 * WHEN EACH FRAME WAS TAKEN.
 *
 * The gravity ruler measures an acceleration, and an acceleration is in seconds
 * squared: a frame stamped two milliseconds late is a position put in the wrong
 * place on the parabola. So the time a frame was captured matters more than
 * anything else the browser reports about it.
 *
 * requestVideoFrameCallback hands each frame over with metadata. `captureTime`
 * (Chrome, for camera streams) is the sensor's own clock; `mediaTime` is the
 * frame's presentation timestamp, which for a live camera is the capture time
 * on a different origin. Either is good to a fraction of a millisecond. The
 * callback's own `now` is when the page was told, which carries every scheduling
 * delay in between, and is the last resort.
 *
 * A camera captures on a fixed cadence — 30 or 60 frames a second, with the odd
 * frame lost — so jittery stamps on a regular camera can be put back on the
 * grid they came from. That is only done when the stamps really do scatter
 * round a grid (white jitter, nothing systematic), so a camera that changes its
 * frame rate in a dim room keeps its real times.
 */

/** Pick the best clock from requestVideoFrameCallback's arguments. Seconds. */
export function frameTime(now, meta) {
  if (meta && Number.isFinite(meta.captureTime) && meta.captureTime > 0) return { t: meta.captureTime / 1000, source: 'capture' };
  if (meta && Number.isFinite(meta.mediaTime) && meta.mediaTime > 0) return { t: meta.mediaTime, source: 'media' };
  return { t: now / 1000, source: 'callback' };
}

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Fit t_i ≈ t0 + P n_i with integer frame numbers n_i, robustly.
 * Returns { period, offset, n: [...], residual: [...], jitter } or null.
 */
export function fitFrameGrid(times) {
  if (times.length < 10) return null;
  const dts = [];
  for (let i = 1; i < times.length; i++) dts.push(times[i] - times[i - 1]);
  let P = median(dts);
  if (!(P > 0)) return null;
  // The period is the one that puts every stamp at the same phase: a
  // periodogram over periods within a tenth of the typical gap (so a lost
  // frame, or half the period, cannot be mistaken for it). Dividing by the
  // typical gap directly would lose a frame over a few hundred; counting gaps
  // one at a time would miscount wherever two jittered stamps fall half a frame
  // wrong. Every stamp votes here, so neither happens.
  const span = times[times.length - 1] - times[0];
  const phaseAt = (p) => {
    let c = 0;
    let s = 0;
    for (const t of times) {
      const a = (2 * Math.PI * (t - times[0])) / p;
      c += Math.cos(a);
      s += Math.sin(a);
    }
    return { R: Math.hypot(c, s) / times.length, theta: Math.atan2(s, c) };
  };
  let best = { R: -1, p: P };
  let step = (0.02 * P * P) / Math.max(span, P);
  for (let p = 0.9 * P; p <= 1.1 * P; p += step) {
    const { R } = phaseAt(p);
    if (R > best.R) best = { R, p };
  }
  for (let k = 0; k < 3; k++) {
    const lo = best.p - step;
    step /= 10;
    for (let p = lo; p <= best.p + 10 * step; p += step) {
      const { R } = phaseAt(p);
      if (R > best.R) best = { R, p };
    }
  }
  P = best.p;
  let t0 = times[0] + (phaseAt(P).theta / (2 * Math.PI)) * P;
  let n = times.map((t) => Math.round((t - t0) / P));
  // least squares on those frame numbers, leaving out anything ambiguous
  {
    let sn = 0;
    let st = 0;
    let snn = 0;
    let snt = 0;
    let m = 0;
    for (let i = 0; i < times.length; i++) {
      if (Math.abs(times[i] - (t0 + P * n[i])) > 0.35 * P) continue;
      sn += n[i];
      st += times[i];
      snn += n[i] * n[i];
      snt += n[i] * times[i];
      m++;
    }
    const det = m * snn - sn * sn;
    if (!(det > 0)) return null;
    P = (m * snt - sn * st) / det;
    t0 = (st - P * sn) / m;
    n = times.map((t) => Math.round((t - t0) / P));
  }
  const residual = times.map((t, i) => t - (t0 + P * n[i]));
  const abs = residual.map(Math.abs);
  const jitter = 1.4826 * median(abs);
  return { period: P, offset: t0, n, residual, jitter };
}

/**
 * Times to fit gravity with. Returns { times, regular, jitterMs, periodMs }.
 *
 * Stamps already within a third of a millisecond of a grid are used as they
 * are. Noisier ones are snapped to the grid only if the scatter is white — the
 * residuals of neighbouring frames uncorrelated — and small against a frame.
 */
export function regulariseTimes(times) {
  const grid = fitFrameGrid(times);
  if (!grid) return { times, regular: false, jitterMs: NaN, periodMs: NaN };
  const jitterMs = grid.jitter * 1000;
  const out = { times, regular: false, jitterMs, periodMs: grid.period * 1000 };
  if (grid.jitter < 0.0003) return out;
  if (grid.jitter > 0.3 * grid.period) return out; // beyond this, frames could be miscounted
  // lag-one autocorrelation of the residuals: a drifting clock or a changing
  // frame rate shows up as long runs of the same sign
  const r = grid.residual;
  const mean = r.reduce((s, x) => s + x, 0) / r.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < r.length; i++) {
    den += (r[i] - mean) ** 2;
    if (i) num += (r[i] - mean) * (r[i - 1] - mean);
  }
  const rho = den > 0 ? num / den : 0;
  if (rho > 0.5) return { ...out, rho };
  return { times: grid.n.map((k) => grid.offset + grid.period * k), regular: true, jitterMs, periodMs: grid.period * 1000, rho };
}
