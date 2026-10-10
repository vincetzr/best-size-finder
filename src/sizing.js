/**
 * BEST'S CHART, AND WHICH SIZE A CHEST IS.
 *
 * Ported as it was from the August page (index.html, built from
 * product_extractor; line numbers below are of a prettier-formatted copy of its
 * bundle), so the two pages answer the same chest with the same size. The
 * only changes are two the readers of that bundle found: the advice to order
 * the larger of two sizes was given even when there was no larger one, and the
 * second size's chance lost its "per cent". This returns numbers and lets the
 * page say them.
 */

/** BEST's vest chart: chest girth and garment length (neck–shoulder point to hem). Pc, line 12358. */
export const CHART = Object.freeze(
  [
    ['3X Small', 92, '36 1/4"', 74, '29 1/8"'],
    ['2X Small', 96, '37 ¾"', 76, '29 ¾"'],
    ['X Small', 100, '39 ¼"', 78, '30 ½"'],
    ['Small', 104, '41"', 80, '31 ½"'],
    ['Medium', 108, '42 ½"', 82, '32 ½"'],
    ['Large', 112, '44"', 84, '33"'],
    ['X Large', 120, '47 1/8"', 86, '33 ¾"'],
    ['2X Large', 128, '50 1/8"', 87, '34 ¼"'],
    ['3X Large', 136, '53 ½"', 87, '34 ¼"'],
    ['4X Large', 144, '56 ¾"', 88, '34 ½"'],
    ['5X Large', 152, '59 7/8"', 88, '34 ½"'],
    ['6X Large', 160, '63"', 89, '35"'],
    ['7X Large', 168, '66 1/8"', 90, '35 ¼"'],
  ].map(([name, chestCm, chestInches, lengthCm, lengthInches]) => Object.freeze({ name, chestCm, chestInches, lengthCm, lengthInches })),
);

// Chest from width (front) and depth (side), both in cm: a straight line
// fitted to about 1,400 tape-measured bodies, inside the box of widths and
// depths it was fitted on (vd and Xu, lines 9226 and 9294); outside it,
// Ramanujan's ellipse through the two, scaled up by 1.177 because a chest is
// fuller than an ellipse (SE, line 9211). The two disagree by several cm near
// the box's edge — about 9 at (40, 30) — and a chest just inside and one just
// outside can jump by that much. Kept as it was; see the tests.
const LINE = [1.418, 1.015, 33.52];
const BOX = { width: [24, 62], depth: [13, 44] };
const ELLIPSE_FULLNESS = 1.177;
/** A chest outside this is a measurement gone wrong (Do). */
export const CHEST_RANGE = Object.freeze([60, 200]);

/** Perimeter of an ellipse with semi-axes a and b, by Ramanujan's second approximation (kE). */
export function ramanujan(a, b) {
  if (!(a > 0) || !(b > 0)) return 0;
  const h = ((a - b) * (a - b)) / ((a + b) * (a + b));
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

/** Chest girth from width and depth (AE, line 9219). */
export function girthFromWidthDepth(widthCm, depthCm) {
  if (!(widthCm > 0) || !(depthCm > 0)) return { chestCm: 0, method: 'none' };
  const inside = widthCm >= BOX.width[0] && widthCm <= BOX.width[1] && depthCm >= BOX.depth[0] && depthCm <= BOX.depth[1];
  if (inside) return { chestCm: LINE[0] * widthCm + LINE[1] * depthCm + LINE[2], method: 'regression' };
  return { chestCm: ramanujan(widthCm / 2, depthCm / 2) * ELLIPSE_FULLNESS, method: 'ellipse' };
}

// The chest's own uncertainty, from the August page's error model (yS, line
// 9723): a 4 per cent shape error for a chest worked out from a width and a
// depth (a chest is not an ellipse, nor exactly the fitted line), combined
// with the scale's, and never under 4 cm. These are asserted there, not
// measured; FIELD.md is how to measure them.
const SHAPE_REL = 0.04;
const FLOOR_CM = 4;
const COIN_TOSS = 0.2;

// A chest measured all the way round (chestFromTurn) assumes no shape, so its
// own error is smaller: 2 per cent and 2 cm, the August page's figures for
// its turn (og and the floor in yS's turn branch). Asserted there too.
const TURN_REL = 0.02;
const TURN_FLOOR_CM = 2;

/**
 * The part of a chest's ± that is the method's own — the shape assumed, or the
 * turn's reading of it — and not the scale's, which every method shares.
 */
export function shapeError(chestCm, method = 'two-view') {
  if (method === 'turn') return Math.max(TURN_FLOOR_CM, chestCm * TURN_REL);
  return Math.max(FLOOR_CM, chestCm * SHAPE_REL);
}

/** ± in cm for a chest, given the scale's relative uncertainty and how it was read. */
export function chestError({ chestCm, scaleRel, method = 'two-view' }) {
  return Math.hypot(shapeError(chestCm, method), chestCm * (scaleRel || 0));
}

// A quarter turn read into this many bins of angle, at least this share of
// them seen and no run of empty ones longer than this (the August page's AS:
// bc, kS and sg).
const TURN_BINS = 12;
const TURN_COVERAGE = 0.75;
const TURN_MAX_GAP = 2;

/**
 * Chest girth measured, not assumed: by Cauchy's formula the perimeter of a
 * convex outline is the integral of its width over half a turn, and a tape
 * round a chest follows exactly the convex outline. A body is (near enough)
 * the same on its left as its right, so a quarter turn is half the integral:
 * girth = π × the mean width over angles from facing (0) to side on (π/2).
 *
 * samples: [{ angle (radians, 0 facing, π/2 side on), widthCm }]. The widths
 * are averaged within each bin of angle and then over the bins, so a customer
 * who turns slowly at one angle does not count it twice; a bin nobody passed
 * through is filled from its neighbours, up to a short gap.
 */
export function chestFromTurn(samples) {
  const bins = Array.from({ length: TURN_BINS }, () => []);
  for (const q of samples || []) {
    if (!Number.isFinite(q.angle) || !(q.widthCm > 0)) continue;
    const a = Math.min(Math.PI / 2 - 1e-9, Math.max(0, q.angle));
    bins[Math.floor((a / (Math.PI / 2)) * TURN_BINS)].push(q.widthCm);
  }
  const mean = bins.map((b) => {
    if (!b.length) return NaN;
    const s = [...b].sort((x, y) => x - y);
    return s[s.length >> 1]; // median within a bin: one stray frame does not move it
  });
  const seen = mean.filter(Number.isFinite).length;
  const coverage = seen / TURN_BINS;
  if (coverage < TURN_COVERAGE) return { ok: false, coverage, reason: 'Not enough of the turn was seen. Turn more slowly, all the way until one shoulder points at the tablet.' };
  // the ends must be seen, to within a bin: facing and side on are where the
  // width is its widest and narrowest. Within a bin is enough because a body
  // the same on both sides has its width level there (as wide as it gets, as
  // narrow), so the bin next to an end stands in for it — which it has to for
  // a customer standing off to one side, who is already turned a few degrees
  // to the camera's line of sight when facing the tablet
  if (!(Number.isFinite(mean[0]) || Number.isFinite(mean[1])) || !(Number.isFinite(mean[TURN_BINS - 1]) || Number.isFinite(mean[TURN_BINS - 2])))
    return { ok: false, coverage, reason: 'The turn has to start facing the tablet and end side on.' };
  if (!Number.isFinite(mean[0])) mean[0] = mean[1];
  if (!Number.isFinite(mean[TURN_BINS - 1])) mean[TURN_BINS - 1] = mean[TURN_BINS - 2];
  let gap = 0;
  for (const m of mean) {
    gap = Number.isFinite(m) ? 0 : gap + 1;
    if (gap > TURN_MAX_GAP) return { ok: false, coverage, reason: 'Part of the turn went by too fast. Turn slowly and steadily.' };
  }
  // fill the short gaps by straight lines between their neighbours
  const filled = mean.slice();
  for (let i = 0; i < TURN_BINS; i++) {
    if (Number.isFinite(filled[i])) continue;
    let l = i - 1;
    while (!Number.isFinite(mean[l])) l--;
    let r = i + 1;
    while (!Number.isFinite(mean[r])) r++;
    filled[i] = mean[l] + ((mean[r] - mean[l]) * (i - l)) / (r - l);
  }
  const avg = filled.reduce((a, b) => a + b, 0) / TURN_BINS;
  return { ok: true, chestCm: Math.PI * avg, coverage, bins: filled };
}

/**
 * The angle a turning chest is seen at, from the shoulders' span in the level
 * picture against facing, r. A turn changes the span as the cosine of the
 * angle to the line of sight — not to the camera's axis: a customer standing
 * off to one side faces the tablet already turned a little to the line they
 * are seen along (cosOff, the cosine of how far off the axis they stand), and
 * their shoulders meet in the picture when one points at the tablet, not when
 * they have turned a right angle in the room. So cos θ = r · cosOff. Past side
 * on the span grows again; a body the same on both sides looks the same at
 * 90° + x as at 90° − x, which is what taking |r| does.
 */
export function viewAngleFromSpan(r, cosOff = 1) {
  return Math.acos(Math.min(1, Math.abs(r) * cosOff));
}

/**
 * The chest's depth from a width read a little short of side on (or past
 * it): viewAngle in radians from facing, the width seen there and the width
 * facing. Read as an ellipse, w(θ)² = W² cos²θ + D² sin²θ; ten degrees short
 * of side on the width is about one per cent more than the depth, and the
 * correction's own error is a small part of that. Not for angles under 70°,
 * where it would be guessing rather than correcting.
 */
export function depthNearSide(widthCm, frontWidthCm, viewAngle) {
  if (!(viewAngle >= (70 * Math.PI) / 180)) return NaN;
  const c = Math.cos(Math.min(Math.PI / 2, viewAngle));
  const s2 = 1 - c * c;
  return Math.sqrt(Math.max(0, (widthCm * widthCm - frontWidthCm * frontWidthCm * c * c) / s2));
}

/**
 * One chest from two readings of it, each { chestCm, shapeCm } with shapeCm
 * its own error apart from the scale. Both were read with the same scale, so
 * that part of their error is shared: it neither shrinks by averaging nor shows
 * in their difference. So they are weighed, and their agreement judged, by
 * their own errors alone, and the scale's is added back once at the end.
 * When they agree to within three of their combined own errors: weighted.
 * When not: their middle, wide enough to cover both, and a flag, because one
 * of them is wrong. Never surer than the turn alone could be (its floor).
 */
export function fuseChests(a, b, scaleRel = 0) {
  const own = Math.hypot(a.shapeCm, b.shapeCm);
  const diff = a.chestCm - b.chestCm;
  if (Math.abs(diff) <= 3 * own) {
    const wa = 1 / (a.shapeCm * a.shapeCm);
    const wb = 1 / (b.shapeCm * b.shapeCm);
    const chestCm = (wa * a.chestCm + wb * b.chestCm) / (wa + wb);
    const shape = Math.max(TURN_FLOOR_CM, 1 / Math.sqrt(wa + wb));
    return { chestCm, errCm: Math.hypot(shape, chestCm * scaleRel), agree: true, diffCm: diff };
  }
  const chestCm = (a.chestCm + b.chestCm) / 2;
  const shape = Math.max(a.shapeCm, b.shapeCm, Math.abs(diff) / 2);
  return { chestCm, errCm: Math.hypot(shape, chestCm * scaleRel), agree: false, diffCm: diff };
}

/** The standard normal CDF, Abramowitz and Stegun 7.1.26, as the August page had it (Hg). */
export function normalCdf(z) {
  const t = 1 / (1 + (0.3275911 * Math.abs(z)) / Math.SQRT2);
  const e = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp((-z * z) / 2);
  return z >= 0 ? 0.5 * (1 + e) : 0.5 * (1 - e);
}

/**
 * The chance of each size (ck, line 12468). A size's chest on the chart is
 * taken as the largest body chest it fits, with no ease: a size covers chests
 * above the size below's figure and up to its own. The smallest size starts
 * from nothing and the largest has no top. σ is never under 0.3 cm, and 3 cm
 * if the error is not a number.
 */
export function rankSizes(chestCm, errCm) {
  if (!Number.isFinite(chestCm) || chestCm <= 0) return [];
  const s = Math.max(0.3, Number.isFinite(errCm) ? Math.abs(errCm) : 3);
  return CHART.map((size, i) => {
    const lo = i > 0 ? CHART[i - 1].chestCm : 0;
    const hiP = i === CHART.length - 1 ? 1 : normalCdf((size.chestCm - chestCm) / s);
    return { ...size, p: hiP - normalCdf((lo - chestCm) / s) };
  }).sort((a, b) => b.p - a.p);
}

/**
 * What to say: the likeliest size and the next, how much room the likeliest
 * leaves, and whether the margin is too wide to separate them.
 *
 * `over` is a chest above the likeliest size's figure. Then the larger of the
 * two is the safer order — if there is a larger one (`largerIsSafer`); above
 * the largest size there is not, and `offChart` says so instead.
 */
export function verdict(chestCm, errCm) {
  const r = rankSizes(chestCm, errCm);
  if (!r.length) return null;
  const [best, second] = r;
  const roomCm = best.chestCm - chestCm;
  const over = roomCm < 0;
  const largest = CHART[CHART.length - 1];
  return {
    best,
    second: second && second.p > 0 ? second : null,
    pBest: best.p,
    pSecond: second ? second.p : 0,
    roomCm,
    over,
    largerIsSafer: over && !!second && second.chestCm > best.chestCm,
    offChart: chestCm > largest.chestCm,
    // the August page called it a coin toss past ±4 cm; but its own 4 per cent
    // shape error puts every chest over 100 cm past that, so here it means what
    // it says: the two likeliest sizes within twenty points of each other
    coinToss: !!second && best.p - second.p < COIN_TOSS,
  };
}
