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

const PROBE_STAMPS = 300;

const quantile = (a, q) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
};

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
  // the period, roughly, from the shortest gaps: when frames are being lost the
  // typical gap is two frames or a mix, and a search round it would find a
  // grid the camera never had (in a browser busy enough to lose every other
  // frame, a 55 ms "period" for a 33 ms camera)
  const short = quantile(dts, 0.2);
  let P = median(dts.filter((d) => d < 1.5 * short));
  if (!(P > 0)) return null;
  // The period is the one that puts every stamp at the same phase: a
  // periodogram over periods within a tenth of the typical gap (so a lost
  // frame, or half the period, cannot be mistaken for it). Dividing by the
  // typical gap directly would lose a frame over a few hundred; counting gaps
  // one at a time would miscount wherever two jittered stamps fall half a frame
  // wrong. Every stamp votes here, so neither happens.
  // the search runs over the last few hundred stamps only — a periodogram is
  // every candidate period against every stamp, and a long recording on a
  // phone would stall the page for seconds — and the least squares below then
  // uses them all
  const probe = times.length > PROBE_STAMPS ? times.slice(-PROBE_STAMPS) : times;
  const span = probe[probe.length - 1] - probe[0];
  const phaseAt = (p) => {
    let c = 0;
    let s = 0;
    for (const t of probe) {
      const a = (2 * Math.PI * (t - times[0])) / p;
      c += Math.cos(a);
      s += Math.sin(a);
    }
    return { R: Math.hypot(c, s) / probe.length, theta: Math.atan2(s, c) };
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
  const R = phaseAt(P).R;
  const abs = residual.map(Math.abs);
  const jitter = 1.4826 * median(abs);
  return { period: P, offset: t0, n, residual, jitter, R };
}

/**
 * Times to fit gravity with. Returns { times, regular, jitterMs, periodMs }.
 *
 * Stamps already within a third of a millisecond of a grid are used as they
 * are. Noisier ones are snapped to the grid only if the scatter is white — the
 * residuals of neighbouring frames uncorrelated — and small against a frame.
 */
export function regulariseTimes(times, frameNumbers) {
  const grid = (frameNumbers && gridFromFrameNumbers(times, frameNumbers)) || fitFrameGrid(times);
  if (!grid) return { times, regular: false, jitterMs: NaN, periodMs: NaN };
  const jitterMs = grid.jitter * 1000;
  const out = { times, regular: false, jitterMs, periodMs: grid.period * 1000 };
  if (grid.jitter < 0.0003) return out;
  if (grid.jitter > 0.3 * grid.period) return out; // beyond this, frames could be miscounted
  // every stamp must clearly share the grid's phase, and no two frames may land
  // in the same slot; otherwise the grid is a guess, and the real stamps are
  // better than a guess
  if (!(grid.R > 0.25)) return { ...out, R: grid.R };
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
  // Two stamps a long way out can land in one slot (with 5 ms of jitter, one
  // pair in a thousand frames). The camera did not take two frames at once,
  // so one of them is in the wrong slot — but which is a guess, and guessing
  // wrong puts a point a whole frame out. Those two keep their own stamps;
  // every other frame takes the grid's.
  const snapped = grid.n.map((k) => grid.offset + grid.period * k);
  let collided = 0;
  for (let i = 1; i < grid.n.length; i++)
    if (grid.n[i] <= grid.n[i - 1]) {
      snapped[i] = times[i];
      snapped[i - 1] = times[i - 1];
      collided++;
    }
  if (collided > 0.05 * grid.n.length) return { ...out, collided }; // a grid that fits that badly is no grid
  return { times: snapped, regular: true, jitterMs, periodMs: grid.period * 1000, rho, collided };
}

/**
 * The grid straight from the browser's own frame count, where it has one:
 * requestVideoFrameCallback's presentedFrames goes up by one for every frame
 * the camera delivered, so a frame the page was too busy for is a known gap,
 * and nothing has to be guessed. Only used if it rises strictly and agrees
 * with the stamps.
 */
export function gridFromFrameNumbers(times, frames) {
  if (!frames || frames.length !== times.length || times.length < 10) return null;
  for (let i = 0; i < frames.length; i++) if (!Number.isFinite(frames[i])) return null;
  for (let i = 1; i < frames.length; i++) if (!(frames[i] > frames[i - 1])) return null;
  const n = frames.map((f) => f - frames[0]);
  let sn = 0;
  let st = 0;
  let snn = 0;
  let snt = 0;
  const m = n.length;
  for (let i = 0; i < m; i++) {
    sn += n[i];
    st += times[i];
    snn += n[i] * n[i];
    snt += n[i] * times[i];
  }
  const det = m * snn - sn * sn;
  if (!(det > 0)) return null;
  const P = (m * snt - sn * st) / det;
  const t0 = (st - P * sn) / m;
  if (!(P > 0.004 && P < 0.1)) return null;
  const residual = times.map((t, i) => t - (t0 + P * n[i]));
  const jitter = 1.4826 * median(residual.map(Math.abs));
  // a count that does not match the clock (a display slower than the camera,
  // say) is no grid at all
  if (!(jitter < 0.3 * P)) return null;
  return { period: P, offset: t0, n, residual, jitter, R: 1, fromCount: true };
}

/**
 * Is this frame's stamp its own? Safari, when two camera frames arrive while
 * the page is busy, hands over the newest pixels with the oldest frame's
 * capture time (MediaPlayerPrivateMediaStreamAVFObjC::processNewVideoFrame),
 * and counts one frame, not two — so the count cannot tell either. What does
 * tell is the delay: a frame stamped one camera period early looks a period
 * older when it is delivered than frames usually are. So each frame's delay
 * (when the page was told, less its stamp; any constant between the two
 * clocks cancels) is held against the recent median, and a frame more than
 * three quarters of a period over it is not trusted. A frame that was merely
 * delivered late, behind a long callback, is caught as well; it costs one
 * sample, which the fit does not miss. The period is the short end of the
 * recent stamp gaps, which frames being lost cannot stretch.
 */
export class StampCheck {
  constructor({ keep = 31 } = {}) {
    this.keep = keep;
    this.delays = [];
    this.gaps = [];
    this.lastT = NaN;
  }
  /** nowS: when the page was told (seconds); t: the frame's stamp (seconds). True if t is not to be trusted. */
  stale(nowS, t) {
    if (Number.isFinite(this.lastT) && t > this.lastT) {
      this.gaps.push(t - this.lastT);
      if (this.gaps.length > this.keep) this.gaps.shift();
    }
    this.lastT = t;
    const delay = nowS - t;
    let out = false;
    if (this.delays.length >= 10 && this.gaps.length >= 10) out = delay - median(this.delays) > 0.75 * quantile(this.gaps, 0.2);
    this.delays.push(delay);
    if (this.delays.length > this.keep) this.delays.shift();
    return out;
  }
}
