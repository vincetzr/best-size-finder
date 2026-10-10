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

/** ± in cm for a chest, given the scale's relative uncertainty. */
export function chestError({ chestCm, scaleRel }) {
  return Math.max(FLOOR_CM, chestCm * Math.hypot(SHAPE_REL, scaleRel || 0));
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
