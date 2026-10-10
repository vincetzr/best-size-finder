/**
 * THE GRAVITY RULER.
 *
 * A photograph has no size in it. Gravity does: between take-off and landing a
 * hopping body is in free fall, and everything in free fall accelerates at
 * 9.81 metres per second per second whoever it is, whatever they weigh and
 * however far from the camera they stand. Follow a point on the trunk through a
 * hop and its acceleration comes out in pixels per second per second; divide by
 * g and what is left is pixels per metre — at the body itself, which is the one
 * place a card held against the chest was never quite at.
 *
 * Nothing about the customer goes in. Not height, not weight, not a card, not a
 * person of known height standing on a mark first. What has to be true instead:
 *
 *  - the frames carry the time they were captured (the browser gives this; see
 *    timing.js), because the answer is in metres per second squared;
 *  - the trunk moves with the centre of mass while in the air, which it does if
 *    the body is held still — knees straight, hands on hips — and only the
 *    ankles do the hopping;
 *  - the samples used are the flight and not the landing. Ground force rises
 *    from nothing at touch-down, so the first frame on the ground sits almost on
 *    the parabola. Contact only ever holds the body UP against free fall, never
 *    pulls it down, so the test for the end of a flight is one-sided.
 *
 * Every hop gives its own reading; they share one acceleration, so they are
 * fitted together, and the spread between them is the honest error bar.
 */

/** Standard gravity. Local g differs by ±0.27 per cent between equator and pole. */
export const G = 9.806;
const G_LOCAL_REL = 0.0027;

const DEFAULTS = {
  minArcSamples: 5, // fewer than this cannot tell a parabola from noise
  zUp: 2.5, // one-sided: how far above free fall a sample may sit before it is ground
  zOther: 4, // any other direction: noise, or a tracking slip
  maxFlight: 0.8, // seconds; nobody hopping on the spot is in the air longer
  minApexGap: 0.15, // seconds between two tops
  // Samples dropped from each end of every arc once it is grown. Ground force
  // rises from nothing at touch-down, so the last frame accepted as flight is
  // often a frame of contact too small to see — and it always errs the same
  // way, holding the arc up. On the simulated hopper this one sample is the
  // difference between a bias of −0.8 per cent and one of 0.1.
  trimEnds: 1,
  iterations: 3,
  // a sub-pixel tracker on a compressed picture does not do better: on the
  // end-to-end video, JPEG blocks and bilinear placement leave residuals of
  // a few tenths of a pixel that a tighter floor reads as slips
  noiseFloorPx: 0.2,
};

const median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const quantile = (a, q) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const i = Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))));
  return s[i];
};

/**
 * Least-squares parabola y = c0 + c1 τ + c2 τ²/2 through points (τ, y), with an
 * optional fixed c2. Returns coefficients, the inverse normal matrix (for
 * prediction variance) and the residual sum of squares.
 */
function fitParabola(tau, y, fixedC2) {
  const n = tau.length;
  if (fixedC2 !== undefined) {
    // two parameters, after removing the known curvature
    let s0 = n;
    let s1 = 0;
    let s2 = 0;
    let b0 = 0;
    let b1 = 0;
    for (let i = 0; i < n; i++) {
      const t = tau[i];
      const r = y[i] - (fixedC2 * t * t) / 2;
      s1 += t;
      s2 += t * t;
      b0 += r;
      b1 += r * t;
    }
    const det = s0 * s2 - s1 * s1;
    if (!(Math.abs(det) > 1e-18)) return null;
    const inv = [
      [s2 / det, -s1 / det],
      [-s1 / det, s0 / det],
    ];
    const c0 = inv[0][0] * b0 + inv[0][1] * b1;
    const c1 = inv[1][0] * b0 + inv[1][1] * b1;
    let rss = 0;
    for (let i = 0; i < n; i++) {
      const e = y[i] - (c0 + c1 * tau[i] + (fixedC2 * tau[i] * tau[i]) / 2);
      rss += e * e;
    }
    return { c: [c0, c1, fixedC2], inv, rss, k: 2 };
  }
  // three parameters: normal equations on [1, τ, τ²/2]
  const M = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const b = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const x = [1, tau[i], (tau[i] * tau[i]) / 2];
    for (let r = 0; r < 3; r++) {
      b[r] += x[r] * y[i];
      for (let c = 0; c < 3; c++) M[r][c] += x[r] * x[c];
    }
  }
  const inv = invert3(M);
  if (!inv) return null;
  const c = [0, 1, 2].map((r) => inv[r][0] * b[0] + inv[r][1] * b[1] + inv[r][2] * b[2]);
  let rss = 0;
  for (let i = 0; i < n; i++) {
    const e = y[i] - (c[0] + c[1] * tau[i] + (c[2] * tau[i] * tau[i]) / 2);
    rss += e * e;
  }
  return { c, inv, rss, k: 3 };
}

function invert3(m) {
  const [a, b, c] = m[0];
  const [d, e, f] = m[1];
  const [g, h, i] = m[2];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!(Math.abs(det) > 1e-24)) return null;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

/** Variance factor of a prediction at τ (in units of σ²), excluding the point's own noise. */
function predictionVariance(fit, tau) {
  if (fit.k === 2) {
    const x = [1, tau];
    let s = 0;
    for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) s += x[r] * fit.inv[r][c] * x[c];
    return s;
  }
  const x = [1, tau, (tau * tau) / 2];
  let s = 0;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) s += x[r] * fit.inv[r][c] * x[c];
  return s;
}

const evalParabola = (c, tau) => c[0] + c[1] * tau + (c[2] * tau * tau) / 2;

/**
 * Noise of the tracked position, in pixels, from third differences: a parabola
 * has none, so on flight and on standing still they are noise alone (variance
 * 20 σ²). Contact has a real jerk, so the lower quartile is used rather than
 * the median — it is the quiet frames that say what the tracker's noise is.
 */
export function estimateNoise(t, x, period) {
  const d = [];
  for (let i = 0; i + 3 < x.length; i++) {
    const ok =
      Math.abs(t[i + 1] - t[i] - period) < 0.3 * period &&
      Math.abs(t[i + 2] - t[i + 1] - period) < 0.3 * period &&
      Math.abs(t[i + 3] - t[i + 2] - period) < 0.3 * period;
    if (ok) d.push(Math.abs(x[i + 3] - 3 * x[i + 2] + 3 * x[i + 1] - x[i]));
  }
  if (d.length < 8) return NaN;
  return quantile(d, 0.25) / 0.3186 / Math.sqrt(20);
}

/**
 * Tops of the hops: local maxima of height h (pixels, up positive) that stand
 * clear of their surroundings.
 */
function findApexes(t, h, sigma, opts) {
  const n = t.length;
  // a five-point median first: one slipped frame must not become the top of a hop
  const sm = h.map((_, i) => median(h.slice(Math.max(0, i - 2), Math.min(n, i + 3))));
  const cands = [];
  for (let i = 1; i < n - 1; i++) {
    if (!(sm[i] >= sm[i - 1] && sm[i] > sm[i + 1])) continue;
    // prominence on each side within one flight-and-contact
    let leftMin = Infinity;
    let rightMin = Infinity;
    for (let j = i - 1; j >= 0 && t[i] - t[j] <= opts.maxFlight; j--) leftMin = Math.min(leftMin, sm[j]);
    for (let j = i + 1; j < n && t[j] - t[i] <= opts.maxFlight; j++) rightMin = Math.min(rightMin, sm[j]);
    const prom = Math.min(sm[i] - leftMin, sm[i] - rightMin);
    if (prom >= Math.max(8 * sigma, 3)) cands.push({ i, prom, h: sm[i] });
  }
  // two tops closer than a hop can be are one top
  cands.sort((a, b) => b.h - a.h);
  const kept = [];
  for (const c of cands) if (!kept.some((k) => Math.abs(t[k.i] - t[c.i]) < opts.minApexGap)) kept.push(c);
  return kept.map((k) => k.i).sort((a, b) => a - b);
}

/**
 * Grow a flight window outwards from the top of a hop, one sample at a time,
 * for as long as the next sample is where free fall says it should be.
 * `up` is the unit vector of "up" in image coordinates; `fixedA` (optional) is
 * the shared acceleration so far, which makes the test much sharper.
 *
 * A single sample that is wrong in a way contact cannot explain — below the
 * parabola, or off to one side — while the one beyond it is right, is a
 * tracking slip: it is stepped over rather than taken as the end of the flight.
 * Contact cannot be stepped over that way, because it does not stop after one
 * frame.
 */
function growWindow(S, apex, sigma, up, opts, fixedA, limits) {
  const { t, u, v } = S;
  const gapOK = (i, j) => Math.abs(t[j] - t[i]) < 2.6 * S.period;
  const t0 = t[apex];
  const fitIdx = (idx) => {
    const tau = idx.map((i) => t[i] - t0);
    const fu = fitParabola(tau, idx.map((i) => u[i]), fixedA ? fixedA[0] : undefined);
    const fv = fitParabola(tau, idx.map((i) => v[i]), fixedA ? fixedA[1] : undefined);
    return fu && fv ? { fu, fv } : null;
  };
  const test = (fit, i) => {
    const tau = t[i] - t0;
    const pv = predictionVariance(fit.fv, tau); // same design for u and v
    const sd = sigma * Math.sqrt(1 + pv);
    const ru = u[i] - evalParabola(fit.fu.c, tau);
    const rv = v[i] - evalParabola(fit.fv.c, tau);
    const along = ru * up[0] + rv * up[1]; // positive: higher than free fall
    const across = -ru * up[1] + rv * up[0];
    const zA = along / sd;
    const zX = across / sd;
    const ok = zA < opts.zUp && zA > -opts.zOther && Math.abs(zX) < opts.zOther;
    // could contact explain it? only if it is held up and not knocked sideways
    const contactLike = zA >= opts.zUp && Math.abs(zX) < opts.zOther;
    return { ok, contactLike, score: Math.max(Math.abs(zA), Math.abs(zX)) };
  };

  // seed: the top and its neighbours, with the worst point swapped out while
  // any of them sits far off a parabola through the rest
  const need = fixedA ? 3 : opts.minArcSamples;
  let idx = [apex];
  let lo = apex;
  let hi = apex;
  const skipped = new Set();
  const extend = () => {
    const canL = lo - 1 >= limits.lo && gapOK(lo - 1, lo);
    const canR = hi + 1 <= limits.hi && gapOK(hi, hi + 1);
    if (!canL && !canR) return false;
    if (canL && (!canR || apex - lo <= hi - apex)) idx.unshift(--lo);
    else idx.push(++hi);
    return true;
  };
  while (idx.length < need) if (!extend()) return null;
  for (let tries = 0; tries < 3 && idx.length >= 4; tries++) {
    let worst = -1;
    let worstZ = 0;
    for (const i of idx) {
      const rest = idx.filter((j) => j !== i);
      const f = fitIdx(rest);
      if (!f) continue;
      const z = test(f, i).score;
      if (z > worstZ) {
        worstZ = z;
        worst = i;
      }
    }
    if (worstZ < opts.zOther + 2) break;
    idx = idx.filter((j) => j !== worst);
    skipped.add(worst);
    if (!extend()) return null;
  }

  let fit = fitIdx(idx);
  if (!fit) return null;
  let openL = true;
  let openR = true;
  const within = (i) => (i < lo ? t[hi] - t[i] : t[i] - t[lo]) <= opts.maxFlight;
  const nextOut = (side) => (side < 0 ? lo - 1 : hi + 1);
  const inRange = (i) => i >= limits.lo && i <= limits.hi;
  while (openL || openR) {
    const cand = [];
    for (const side of [-1, 1]) {
      if (side < 0 ? !openL : !openR) continue;
      const i = nextOut(side);
      const edge = side < 0 ? lo : hi;
      if (inRange(i) && gapOK(i, edge) && within(i)) cand.push({ i, side });
      else if (side < 0) openL = false;
      else openR = false;
    }
    if (!cand.length) break;
    const scored = cand.map((c) => ({ ...c, ...test(fit, c.i) })).sort((a, b) => a.score - b.score);
    let took = false;
    for (const c of scored) {
      if (c.ok) {
        if (c.side < 0) idx.unshift((lo = c.i));
        else idx.push((hi = c.i));
        took = true;
        break;
      }
      // a slip is stepped over if the sample beyond it is free fall
      const beyond = c.i + c.side;
      if (!c.contactLike && inRange(beyond) && gapOK(beyond, c.i) && within(beyond) && test(fit, beyond).ok) {
        skipped.add(c.i);
        if (c.side < 0) {
          lo = beyond;
          idx.unshift(beyond);
        } else {
          hi = beyond;
          idx.push(beyond);
        }
        took = true;
        break;
      }
      if (c.side < 0) openL = false;
      else openR = false;
    }
    if (took) {
      const nf = fitIdx(idx);
      if (!nf) break;
      fit = nf;
    }
  }
  const trim = opts.trimEnds;
  if (trim && idx.length - 2 * trim >= opts.minArcSamples) idx = idx.slice(trim, idx.length - trim);
  if (idx.length < opts.minArcSamples) return null;
  return { idx, apex, skipped: skipped.size };
}

/**
 * Shared-acceleration fit over all flight windows: each arc has its own
 * position and velocity, all share one acceleration vector. Linear, so it is
 * solved by projecting each arc's quadratic column off its own [1, τ].
 */
function jointFit(S, arcs) {
  const out = { u: null, v: null, perArc: [] };
  let N = 0;
  const acc = { u: { num: 0, den: 0 }, v: { num: 0, den: 0 } };
  const proj = [];
  for (const a of arcs) {
    const idx = a.idx;
    const n = idx.length;
    const tm = idx.reduce((s, i) => s + S.t[i], 0) / n;
    const tau = idx.map((i) => S.t[i] - tm);
    const q = tau.map((x) => (x * x) / 2);
    // orthogonalise q against [1, τ]
    const st = tau.reduce((s, x) => s + x, 0);
    const stt = tau.reduce((s, x) => s + x * x, 0);
    const sq = q.reduce((s, x) => s + x, 0);
    const stq = tau.reduce((s, x, k) => s + x * q[k], 0);
    const det = n * stt - st * st;
    const c0 = (stt * sq - st * stq) / det;
    const c1 = (n * stq - st * sq) / det;
    const qp = q.map((x, k) => x - c0 - c1 * tau[k]);
    const qq = qp.reduce((s, x) => s + x * x, 0);
    const per = { n, tm, qq };
    for (const ax of ['u', 'v']) {
      const num = qp.reduce((s, x, k) => s + x * S[ax][idx[k]], 0);
      acc[ax].num += num;
      acc[ax].den += qq;
      per[ax] = num / qq;
    }
    proj.push({ idx, tau });
    out.perArc.push(per);
    N += n;
  }
  const K = arcs.length;
  for (const ax of ['u', 'v']) out[ax] = acc[ax].num / acc[ax].den;
  // residuals with the shared acceleration: refit the linear terms per arc
  let rss = 0;
  const all = [];
  out.resid = proj.map((p) => {
    const r = { idx: p.idx, e: p.idx.map(() => 0) };
    for (const ax of ['u', 'v']) {
      const A = out[ax];
      const y = p.idx.map((i, k) => S[ax][i] - (A * p.tau[k] * p.tau[k]) / 2);
      const n = y.length;
      const st = p.tau.reduce((s, x) => s + x, 0);
      const stt = p.tau.reduce((s, x) => s + x * x, 0);
      const sy = y.reduce((s, x) => s + x, 0);
      const sty = p.tau.reduce((s, x, k) => s + x * y[k], 0);
      const det = n * stt - st * st;
      const b0 = (stt * sy - st * sty) / det;
      const b1 = (n * sty - st * sy) / det;
      for (let k = 0; k < n; k++) {
        const e = y[k] - b0 - b1 * p.tau[k];
        rss += e * e;
        all.push(Math.abs(e));
        r.e[k] = Math.max(r.e[k], Math.abs(e));
      }
    }
    return r;
  });
  const dof = 2 * N - 4 * K - 2;
  out.sigma = dof > 0 ? Math.sqrt(rss / dof) : NaN;
  // the same, but not moved by a few tracking slips: what thresholds are set from
  out.sigmaRobust = dof > 0 ? 1.4826 * median(all) * Math.sqrt(all.length / dof) : NaN;
  out.den = acc.v.den;
  out.N = N;
  out.K = K;
  return out;
}

/** Drop samples the shared fit leaves far out, and refit, until none are. */
function robustJointFit(S, arcs, opts) {
  let fit = jointFit(S, arcs);
  for (let pass = 0; pass < 4; pass++) {
    // never tighter than the noise floor: on a very clean recording the robust
    // spread is a few hundredths of a pixel, and four of those would throw out
    // samples a compressed picture puts a quarter of a pixel out, flight by flight
    const lim = 4 * Math.max(fit.sigmaRobust, opts.noiseFloorPx);
    let removed = 0;
    arcs = arcs
      .map((a, k) => {
        const bad = new Set(fit.resid[k].idx.filter((_, j) => fit.resid[k].e[j] > lim));
        removed += bad.size;
        return bad.size ? { ...a, idx: a.idx.filter((i) => !bad.has(i)), skipped: (a.skipped || 0) + bad.size } : a;
      })
      .filter((a) => a.idx.length >= opts.minArcSamples);
    if (!removed || !arcs.length) break;
    fit = jointFit(S, arcs);
  }
  return { fit, arcs };
}

/**
 * Fit gravity to a tracked trunk.
 *
 * samples: [{ t: seconds (capture time), u, v: pixels }], in any order.
 * Returns the image-plane acceleration of free fall, its uncertainty, the
 * flight windows used, and a reason when it would not give an answer.
 */
export function fitGravity(samples, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const clean = samples
    .filter((s) => Number.isFinite(s.t) && Number.isFinite(s.u) && Number.isFinite(s.v))
    .sort((a, b) => a.t - b.t)
    .filter((s, i, a) => i === 0 || s.t - a[i - 1].t > 1e-6);
  if (clean.length < 20) return fail('too-few-frames', 'Not enough frames were seen to time a hop.');
  const S = {
    t: clean.map((s) => s.t),
    u: clean.map((s) => s.u),
    v: clean.map((s) => s.v),
  };
  const dts = [];
  for (let i = 1; i < S.t.length; i++) dts.push(S.t[i] - S.t[i - 1]);
  S.period = median(dts);
  if (!(S.period > 0) || S.period > 0.1) return fail('frame-rate', 'The camera is giving fewer than ten frames a second.');

  let sigma = Math.max(
    opts.noiseFloorPx,
    Math.max(estimateNoise(S.t, S.u, S.period) || 0, estimateNoise(S.t, S.v, S.period) || 0),
  );
  if (!Number.isFinite(sigma)) sigma = 1;

  // "up" in the image: assume the camera is roughly upright to start with,
  // then take it from the fitted acceleration itself
  let up = [0, -1];
  let arcs = [];
  let fit = null;
  let fixedA = null;
  let apexes = [];
  for (let iter = 0; iter < opts.iterations; iter++) {
    const h = S.u.map((x, i) => x * up[0] + S.v[i] * up[1]);
    apexes = findApexes(S.t, h, sigma, opts);
    if (apexes.length === 0) return fail('no-hops', 'No hops were seen.');
    const grown = [];
    for (let k = 0; k < apexes.length; k++) {
      // a window may not run into the next hop's top
      const lo = k > 0 ? apexes[k - 1] + 1 : 0;
      const hi = k + 1 < apexes.length ? apexes[k + 1] - 1 : S.t.length - 1;
      const w = growWindow(S, apexes[k], sigma, up, opts, fixedA, { lo, hi });
      if (w) grown.push(w);
    }
    if (grown.length === 0) return fail('short-flight', 'The hops were too short to time — hop a little higher.', { apexes: apexes.length });
    ({ fit, arcs } = robustJointFit(S, grown, opts));
    if (!arcs.length) return fail('short-flight', 'The hops were too short to time — hop a little higher.', { apexes: apexes.length });
    if (!(fit.v > 0) && !(Math.hypot(fit.u, fit.v) > 0)) return fail('no-fall', 'What was tracked was not falling.');
    const mag = Math.hypot(fit.u, fit.v);
    const newUp = [-fit.u / mag, -fit.v / mag];
    if (Number.isFinite(fit.sigmaRobust) && fit.sigmaRobust > 0) sigma = Math.max(opts.noiseFloorPx, fit.sigmaRobust);
    const settled =
      fixedA &&
      Math.abs(fixedA[0] - fit.u) + Math.abs(fixedA[1] - fit.v) < 1e-3 * mag &&
      Math.abs(newUp[0] - up[0]) < 1e-3;
    up = newUp;
    fixedA = [fit.u, fit.v];
    if (settled) break;
  }

  // per-arc agreement: if the hops disagree by more than their own noise, the
  // body was not rigid in the air, or contact crept in. Either way the error
  // bar has to grow by that much (the Birge ratio), and one wild hop is dropped.
  const perOf = (f) => {
    const m = Math.hypot(f.u, f.v);
    const dir = [f.u / m, f.v / m];
    const sg = Math.max(opts.noiseFloorPx, f.sigma || sigma);
    return f.perArc.map((p) => ({ ...p, a: p.u * dir[0] + p.v * dir[1], sd: sg / Math.sqrt(p.qq) }));
  };
  let per = perOf(fit);
  let dropped = 0;
  while (per.length >= 3 && dropped < 2) {
    const scores = per.map((p, k) => {
      const others = per.filter((_, j) => j !== k);
      const w = others.reduce((s, o) => s + 1 / (o.sd * o.sd), 0);
      const m = others.reduce((s, o) => s + o.a / (o.sd * o.sd), 0) / w;
      return Math.abs(p.a - m) / Math.sqrt(p.sd * p.sd + 1 / w);
    });
    const worst = scores.indexOf(Math.max(...scores));
    if (!(scores[worst] > 5)) break;
    ({ fit, arcs } = robustJointFit(S, arcs.filter((_, j) => j !== worst), opts));
    per = perOf(fit);
    dropped++;
  }
  const mag2 = Math.hypot(fit.u, fit.v);
  const sdStat = fit.sigma / Math.sqrt(fit.den); // per axis
  let chi2 = 0;
  for (const p of per) chi2 += ((p.a - mag2) / p.sd) ** 2;
  const K = arcs.length;
  const birge = K >= 2 ? Math.sqrt(Math.max(1, chi2 / (K - 1))) : 1;
  const sdA = sdStat * birge;
  const rel = sdA / mag2;

  const result = {
    ok: true,
    accel: { u: fit.u, v: fit.v, mag: mag2, sd: sdA, rel },
    rollDeg: (Math.atan2(fit.u, fit.v) * 180) / Math.PI, // 0 when the camera is upright
    noisePx: sigma,
    arcs: arcs.map((a) => ({ t0: S.t[a.idx[0]], t1: S.t[a.idx[a.idx.length - 1]], n: a.idx.length, apexT: S.t[a.apex], skipped: a.skipped || 0 })),
    hopsSeen: apexes.length,
    hopsUsed: K,
    hopsDropped: dropped,
    birge,
    period: S.period,
  };
  if (K < 2) return { ...result, ok: false, reason: 'one-hop', message: 'Only one hop could be timed; two or more are needed to check each other.' };
  if (rel > 0.03) return { ...result, ok: false, reason: 'unsteady', message: 'The hops did not agree closely enough. Hop again, knees straight, hands on hips.' };
  return result;
}

function fail(reason, message, extra = {}) {
  return { ok: false, reason, message, ...extra };
}

/**
 * The whole gravity ruler: tracked samples in, pixels per metre out, with the
 * picture rectified to a level camera when the device says how it is tilted.
 *
 * attitude: { pitchRad, rollRad } from level.js, or null when the device has
 * no accelerometer (a laptop): then roll is read off the fall itself and the
 * camera is taken to be within five degrees of upright, which the page asks for.
 * camera: { focalPx, cx, cy } — focalPx only roughly (see level.js).
 *
 * Returns { ok, pxPerMetre, rel, rectify, fit } — and widths must be measured
 * through `rectify` too, so that they are in the same picture as the scale.
 */
export function gravityScale(samples, { attitude = null, camera, rectifierFactory, fitOptions } = {}) {
  const ASSUMED_PITCH_SD = (5 * Math.PI) / 180;
  if (attitude) {
    const rectify = rectifierFactory({ ...camera, pitchRad: attitude.pitchRad, rollRad: attitude.rollRad });
    const fit = fitGravity(samples.map((s) => ({ t: s.t, ...rectify(s.u, s.v) })), fitOptions);
    if (!fit.ok) return { ok: false, fit, reason: fit.reason, message: fit.message };
    // the attitude itself is good to about half a degree; at small pitch that
    // is nothing, and the rectified fall is exact
    const pitchSd = (0.5 * Math.PI) / 180;
    const angRel = Math.abs(Math.tan(attitude.pitchRad)) * pitchSd;
    const rel = Math.hypot(fit.accel.rel, G_LOCAL_REL, angRel);
    return { ok: true, pxPerMetre: fit.accel.mag / G, rel, rectify, fit };
  }
  const fit = fitGravity(samples, fitOptions);
  if (!fit.ok) return { ok: false, fit, reason: fit.reason, message: fit.message };
  // roll from the fall: the hop's direction is straight down. Rectify for roll
  // only; the pitch is unknown, taken as zero with five degrees of doubt
  const rollRad = -(fit.rollDeg * Math.PI) / 180;
  const rectify = rectifierFactory({ ...camera, pitchRad: 0, rollRad });
  const unknownPitch = 1 - Math.cos(ASSUMED_PITCH_SD); // the mean shortfall, about 0.4 per cent
  // and, with the trunk off the middle of the picture, the fall's component
  // along the line of sight that rectification would have removed: up to a per
  // cent at five degrees (simulated: −0.9 per cent at three degrees, off-centre)
  const rel = Math.hypot(fit.accel.rel, G_LOCAL_REL, unknownPitch, 0.01);
  // the expected value of cos(pitch) under the assumption is 1 − unknownPitch/2
  return { ok: true, pxPerMetre: fit.accel.mag / (G * (1 - unknownPitch / 2)), rel, rectify, fit, pitchAssumed: true };
}

/**
 * FROM THE TRACKED SURFACE TO THE BODY'S MIDDLE.
 *
 * The ruler is pixels per metre where the tracked box is: the front of the
 * trunk. Everything measured with it is read at the body's middle plane —
 * the outline's edges, side to side and front to back, the top of the head,
 * the heels — and that is further from the camera, by about half the chest's
 * depth. At two and a half metres, twelve centimetres is five per cent.
 *
 * Not all of the box is in front, though. The tracker follows whatever lines
 * run across the picture, and for the up-and-down of a hop those are the tops
 * of the shoulders and the elbows against the room, which are in the middle
 * plane, and the shirt's own collar, seams and pattern, which are on the
 * front. A plain shirt is mostly outline; a striped one mostly front. So the
 * tracked surface is taken as a quarter of the chest's depth ahead of the
 * middle, plus a centimetre for the collar, and the doubt is the whole of
 * that range: a seventh of the depth, as a standard deviation. The distance,
 * which turns centimetres into a share, needs the focal length, which the
 * page knows only roughly; that adds a little more.
 *
 * pxPerMetre and rel are the ruler's, at the tracked surface; depthM the
 * chest's depth, measured or typical. Returns the ruler at the middle plane.
 */
export const TYPICAL_CHEST_DEPTH_M = 0.24;
export function middlePlane({ pxPerMetre, rel, focalPx, depthM = TYPICAL_CHEST_DEPTH_M, focalRelSd = 0.2 }) {
  const ahead = 0.25 * depthM + 0.01;
  const aheadSd = depthM / 7;
  const zTracked = focalPx / pxPerMetre;
  const z = zTracked + ahead;
  const factor = zTracked / z;
  const aheadRel = Math.hypot(aheadSd, focalRelSd * ahead) / z;
  return { pxPerMetre: pxPerMetre * factor, rel: Math.hypot(rel, aheadRel), factor, aheadM: ahead, distanceM: z, depthM };
}
