/**
 * THE SECOND RULER: THE EYES.
 *
 * The visible iris is 11.71 ± 0.42 mm across in adults (Rüfer, Schröder and
 * Erb 2005, 390 eyes by Orbscan; MediaPipe's own iris model assumes 11.7),
 * which makes it a ruler every customer carries — good to about 3.6 per cent,
 * against gravity's one, but needing nothing done at all.
 *
 * Two difficulties, two answers. At the hopping distance an iris is three to
 * five pixels, too small to read; but when a customer taps Start they are at
 * arm's length and it is twenty-odd. So it is read then, as a ratio: the
 * distance between the two iris centres over the iris's own diameter, which
 * needs neither the distance nor the camera's focal length. That gives the
 * distance between the eyes in millimetres, and the distance between the eyes
 * is still thirty pixels across the room, measured to a fraction of one over a
 * few dozen frames.
 *
 * And the eyes are not where the trunk is: they are a few centimetres in front
 * of the shoulders' plane, so a scale read at the face is a little large for
 * the body. The correction needs the distance, which needs a focal length;
 * only roughly, because the correction itself is a few per cent.
 */

/** Horizontal visible iris diameter, adults (Rüfer et al. 2005). */
export const HVID_MM = 11.71;
export const HVID_SD_MM = 0.42;

// How far in front of the trunk's middle plane the eyes are, standing upright
// facing the camera: about the distance from the front of the eye back to the
// ear, which sits roughly over the shoulder joint (anthropometric tables put
// eye-to-tragus at 7–9 cm). The trunk's widths are read at its silhouette,
// whose edges are in that middle plane. A guess, held loosely.
const FACE_AHEAD_OF_TRUNK_M = 0.08;
const FACE_AHEAD_SD_M = 0.03;
const FOCAL_REL_SD = 0.2; // the page's focal length is a nominal field of view

// A frame is used only if the head faces the camera: the two irises the same
// size to within this, and the nose tip within this share of the eye spacing
// of the point between the eyes (about seven degrees of turn).
const IRIS_PAIR_TOLERANCE = 0.15;
const NOSE_OFF_CENTRE = 0.12;
const MIN_NEAR_FRAMES = 8;
const MIN_FAR_FRAMES = 10;

// MediaPipe face landmarks with iris refinement (vision_bundle.mjs,
// FACE_LANDMARKS_LEFT_IRIS / RIGHT_IRIS): each iris is a centre and a ring of
// four points; the horizontal pair is found from the points themselves rather
// than assumed from their order.
const RIGHT = { centre: 468, ring: [469, 470, 471, 472] };
const LEFT = { centre: 473, ring: [474, 475, 476, 477] };
const NOSE_TIP = 1;

const median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mad = (a) => {
  const m = median(a);
  return 1.4826 * median(a.map((x) => Math.abs(x - m)));
};

function pt(face, i, W, H) {
  const q = face[i];
  return q ? { x: q.x * W, y: q.y * H } : null;
}

/** The ring's horizontal diameter: of its two opposite pairs, the one lying more across. */
function horizontalDiameter(face, ring, W, H) {
  const p = ring.map((i) => pt(face, i, W, H));
  if (p.some((q) => !q)) return NaN;
  const a = { dx: p[2].x - p[0].x, dy: p[2].y - p[0].y };
  const b = { dx: p[3].x - p[1].x, dy: p[3].y - p[1].y };
  const across = Math.abs(a.dx) >= Math.abs(b.dx) ? a : b;
  return Math.hypot(across.dx, across.dy);
}

/** Horizontal iris diameters in image pixels. */
export function irisDiametersPx(face, W, H) {
  if (!face || face.length < 478) return { left: NaN, right: NaN };
  return { left: horizontalDiameter(face, LEFT.ring, W, H), right: horizontalDiameter(face, RIGHT.ring, W, H) };
}

/** Iris centres in image pixels. */
export function irisCentresPx(face, W, H) {
  if (!face || face.length < 478) return null;
  return { left: pt(face, LEFT.centre, W, H), right: pt(face, RIGHT.centre, W, H) };
}

/** Distance between the iris centres, and whether the head faces the camera. */
function eyes(face, W, H) {
  const c = irisCentresPx(face, W, H);
  if (!c || !c.left || !c.right) return null;
  const ipd = Math.hypot(c.left.x - c.right.x, c.left.y - c.right.y);
  const nose = pt(face, NOSE_TIP, W, H);
  const mid = { x: (c.left.x + c.right.x) / 2, y: (c.left.y + c.right.y) / 2 };
  // the nose's offset along the line between the eyes, as a share of it
  const ux = (c.left.x - c.right.x) / ipd;
  const uy = (c.left.y - c.right.y) / ipd;
  const off = nose ? Math.abs((nose.x - mid.x) * ux + (nose.y - mid.y) * uy) / ipd : 0;
  return { ipd, facing: off < NOSE_OFF_CENTRE };
}

export class IrisRuler {
  constructor() {
    this.near = []; // eye spacing over iris diameter, one per accepted frame
    this.far = []; // eye spacing in pixels across the room
  }

  /** A frame with the customer close. Returns whether it was used. */
  addNear(face, W, H) {
    const e = eyes(face, W, H);
    if (!e || !e.facing) return false;
    const d = irisDiametersPx(face, W, H);
    const mean = (d.left + d.right) / 2;
    if (!(mean > 0) || Math.abs(d.left - d.right) / mean > IRIS_PAIR_TOLERANCE) return false;
    this.near.push(e.ipd / mean);
    return true;
  }

  /** The distance between this customer's eyes, in millimetres. */
  ipdMm() {
    if (this.near.length < MIN_NEAR_FRAMES) return null;
    const r = median(this.near);
    // the median of n frames scatters as about 1.25 σ / √n
    const scatterRel = (1.25 * mad(this.near)) / Math.sqrt(this.near.length) / r;
    return { mm: r * HVID_MM, rel: Math.hypot(HVID_SD_MM / HVID_MM, scatterRel), frames: this.near.length };
  }

  /** A frame at the measuring distance. Returns whether it was used. */
  addFar(face, W, H) {
    const e = eyes(face, W, H);
    if (!e || !e.facing || !(e.ipd > 0)) return false;
    this.far.push(e.ipd);
    return true;
  }

  /**
   * Pixels per metre at the trunk, from the eyes. focalPx is the page's
   * nominal focal length, used only for the eyes-to-trunk correction.
   */
  scaleAtTrunk({ focalPx }) {
    const near = this.ipdMm();
    if (!near || this.far.length < MIN_FAR_FRAMES || !(focalPx > 0)) return null;
    const ipdPx = median(this.far);
    const farScatterRel = (1.25 * mad(this.far)) / Math.sqrt(this.far.length) / ipdPx;
    const atFace = ipdPx / (near.mm / 1000);
    const zFace = focalPx / atFace;
    const zTrunk = zFace + FACE_AHEAD_OF_TRUNK_M;
    const pxPerMetre = (atFace * zFace) / zTrunk;
    const offsetRel = Math.hypot(FACE_AHEAD_SD_M, FOCAL_REL_SD * FACE_AHEAD_OF_TRUNK_M) / zTrunk;
    return { pxPerMetre, rel: Math.hypot(near.rel, farScatterRel, offsetRel), faceToTrunkM: FACE_AHEAD_OF_TRUNK_M, distanceM: zTrunk };
  }
}

/**
 * Do the two rulers agree? `gravity` and `iris` are each { pxPerMetre, rel }.
 * The ratio is iris over gravity; z is its logarithm in units of their
 * combined uncertainty. More than three apart, something is wrong with one.
 */
export function agree(gravity, iris) {
  if (!gravity || !iris) return null;
  const ratio = iris.pxPerMetre / gravity.pxPerMetre;
  const z = Math.log(ratio) / Math.hypot(gravity.rel, iris.rel);
  return { ratio, z, verdict: Math.abs(z) > 3 ? 'disagree' : 'agree' };
}
