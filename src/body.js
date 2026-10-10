/**
 * WHAT THE PAGE READS OFF A BODY.
 *
 * For every frame the pose model hands over 33 landmarks — points on the body,
 * as fractions of the picture's width and height — and a mask that says, cell by
 * cell, how sure it is that the cell is person. This file turns those two into
 * what the page needs, in image pixels:
 *
 *  - where the hop tracker should look (trunkBox), and whether the customer is
 *    standing as asked: hands on hips, knees straight (handsOnHips, legLength);
 *  - the centre of mass of the whole body, from a standard table of what each
 *    part of a body weighs and where its own centre lies. Only the centre of
 *    mass is in free fall. The trunk is what gets tracked, because it is big and
 *    holds its shape, and comOffset is what has to be added to it: it changes
 *    when the legs fold in the air;
 *  - the chest line, and how wide the person is along it, out of the mask;
 *  - how tall the person stands in the picture, for the display.
 *
 * Coordinates. Image pixels, u (x) to the right and v (y) down, measured from the
 * top-left CORNER of the picture: pixel column i runs from x = i to x = i + 1 and
 * its centre is at i + 0.5. That is MediaPipe's own convention — normalised 0
 * and 1 are the edges of the picture — so a landmark converts by multiplying,
 * and the centre of mask cell i is at (i + 0.5) × W / mw however coarse the mask
 * is. Get that half cell wrong and every edge read off a 256-wide mask of a
 * 720-wide picture moves by 1.4 px.
 *
 * Nothing here cares whether the picture is mirrored, as long as the landmarks
 * and the mask come from the same picture: 'left' is the person's own left
 * wherever it lands, and it is only ever paired with its own side.
 *
 * Visibility. MediaPipe also says how likely each point is to be in view. Where
 * an answer means nothing without a point — the shoulders for the tracker's box,
 * the feet for a height — a point below MIN_VISIBILITY counts as missing.
 * Everywhere else the model's best guess is taken as it stands: a wrist hidden
 * behind a hip is still put where it most likely is, and a hand is half a per
 * cent of the body. Whether the whole person is in the picture is for the caller
 * to check. The landmarks' z is not used: everything here is in the picture.
 */

/**
 * Below this a landmark counts as not seen. It is the threshold MediaPipe's own
 * drawing utilities use to decide whether a landmark is worth drawing at all.
 */
const MIN_VISIBILITY = 0.5;

/**
 * The tracker's box, in shoulder spans (the distance between the two shoulder
 * landmarks, which is the one length every frame has). These are the page's
 * choices for the hop tracker, not measurements of anyone:
 *  - BOX_SIDE beyond the outermost shoulder or elbow, so the outline of the arms
 *    stays inside the box when the landmarks are a few centimetres out (a tenth
 *    of an adult span is about 3.5 cm);
 *  - BOX_ABOVE the shoulder line, which takes in the neck and the line of the
 *    jaw. The hop is up and down, so the tracker needs edges that run across:
 *    the shoulders, the collar, the jaw. A shirt front seldom has any;
 *  - BOX_BELOW the shoulder line, about a third of a metre on an adult, which in
 *    the hands-on-hips pose is past the elbows — and never past the hips, below
 *    which the thighs move against the trunk whenever the knees bend.
 */
const BOX_SIDE = 0.1;
const BOX_ABOVE = 0.3;
const BOX_BELOW = 0.9;

/**
 * Hands on hips: each wrist within this many shoulder spans of its own hip
 * landmark. A wrist resting on the crest of the hip bone sits above and outside
 * the hip joint, about a third of a span from it; the rest is room for landmark
 * error. It does not tell hands on hips from arms hanging straight down — a
 * hanging wrist is about as close to the hip joint (see the tests).
 */
const HANDS_ON_HIPS = 0.45;

/**
 * The chest line, as a fraction of the way from the shoulder line down to the
 * hip line. BEST's tape goes round the fullest part of the chest, a hand's
 * breadth below the shoulders; shoulder joints to hip joints is about half a
 * metre on an adult, so a fifth of it is about 10 cm, a hand's breadth.
 */
const CHEST_DOWN = 0.2;

/**
 * Half the width of the band of columns searched for the top of the head, in
 * shoulder spans either side of the nose. A head is about 15 cm across against a
 * span of about 35, so a quarter span either side (about 9 cm) holds the crown
 * however the head is turned.
 */
const HEAD_BAND = 0.25;

/** Where the mask is as sure the cell is person as not. */
const MASK_LEVEL = 0.5;

/** MediaPipe Pose landmark indices, by name. 'left' is the person's left. */
export const LM = Object.freeze({
  nose: 0,
  leftEyeInner: 1,
  leftEye: 2,
  leftEyeOuter: 3,
  rightEyeInner: 4,
  rightEye: 5,
  rightEyeOuter: 6,
  leftEar: 7,
  rightEar: 8,
  mouthLeft: 9,
  mouthRight: 10,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftPinky: 17,
  rightPinky: 18,
  leftIndex: 19,
  rightIndex: 20,
  leftThumb: 21,
  rightThumb: 22,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
});

/**
 * How a body's mass is shared out, and where each part's own centre lies.
 *
 * de Leva P (1996), Adjustments to Zatsiorsky–Seluyanov's segment inertia
 * parameters, J Biomech 29(9):1223–1230, Table 4: the mean of the female and the
 * male values. `mass` is the fraction of the whole body; `com` is how far along
 * the segment its own centre of mass lies, from the `from` end to the `to` end,
 * and each end is the mean of the landmarks listed for it.
 *
 * Where MediaPipe's points are not de Leva's, the nearest are used:
 *  - head and neck: the centre is put midway between the ears. de Leva's lies a
 *    little lower, about 60 per cent of the way from the crown to the base of
 *    the neck;
 *  - trunk: from the middle of the shoulders to the middle of the hips, with the
 *    centre half way. This is a simplification — de Leva measures the trunk from
 *    the base of the neck and puts its centre a little above half way. For the
 *    hop it costs nothing: the trunk's centre is then a fixed blend of the same
 *    four points comOffset is measured from, so a wrong fraction only adds a
 *    constant, and a constant does not accelerate. The same goes for the head,
 *    which moves with the trunk;
 *  - hand: half way from the wrist to the index-finger point, which MediaPipe
 *    puts near the knuckles rather than at de Leva's third knuckle. At half a
 *    per cent of the body the difference is a fraction of a millimetre;
 *  - foot: from the heel point to the toe point.
 *
 * The rounded means happen to add up to 100 per cent. They are divided by their
 * sum all the same, so that the centre of mass stays a weighted mean whatever is
 * done to the table.
 */
const LIMBS = [
  // part, mass fraction, centre from the first end, first end, second end
  ['upper arm', 0.0263, 0.576, 'Shoulder', 'Elbow'],
  ['forearm', 0.015, 0.457, 'Elbow', 'Wrist'],
  ['hand', 0.00585, 0.5, 'Wrist', 'Index'],
  ['thigh', 0.1447, 0.385, 'Hip', 'Knee'],
  ['shank', 0.0457, 0.444, 'Knee', 'Ankle'],
  ['foot', 0.0133, 0.42, 'Heel', 'FootIndex'],
];
const DE_LEVA = [
  { name: 'head and neck', mass: 0.0681, com: 0.5, from: [LM.leftEar], to: [LM.rightEar] },
  { name: 'trunk', mass: 0.4302, com: 0.5, from: [LM.leftShoulder, LM.rightShoulder], to: [LM.leftHip, LM.rightHip] },
  ...['left', 'right'].flatMap((side) =>
    LIMBS.map(([part, mass, com, a, b]) => ({ name: `${side} ${part}`, mass, com, from: [LM[side + a]], to: [LM[side + b]] })),
  ),
];
const DE_LEVA_TOTAL = DE_LEVA.reduce((s, x) => s + x.mass, 0);

export const SEGMENTS = Object.freeze(
  DE_LEVA.map((s) => Object.freeze({ ...s, mass: s.mass / DE_LEVA_TOTAL, from: Object.freeze(s.from), to: Object.freeze(s.to) })),
);

/** A normalised landmark in image pixels. */
export function px(landmark, W, H) {
  if (!landmark) return { x: NaN, y: NaN };
  return { x: landmark.x * W, y: landmark.y * H };
}

/** Landmark i in image pixels, or null if it is missing. */
function point(landmarks, i, W, H) {
  const l = landmarks && landmarks[i];
  if (!l || !Number.isFinite(l.x) || !Number.isFinite(l.y)) return null;
  return { x: l.x * W, y: l.y * H };
}

/** Whether landmark i is in view; a landmark that does not say is taken to be. */
function seen(landmarks, i) {
  const l = landmarks && landmarks[i];
  if (!l) return false;
  return l.visibility === undefined || l.visibility === null || l.visibility >= MIN_VISIBILITY;
}

function meanOf(landmarks, idx, W, H) {
  let x = 0;
  let y = 0;
  for (const i of idx) {
    const p = point(landmarks, i, W, H);
    if (!p) return null;
    x += p.x;
    y += p.y;
  }
  return { x: x / idx.length, y: y / idx.length };
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function shoulders(landmarks, W, H) {
  const l = point(landmarks, LM.leftShoulder, W, H);
  const r = point(landmarks, LM.rightShoulder, W, H);
  if (!l || !r) return null;
  const span = dist(l, r);
  if (!(span > 0)) return null;
  return { l, r, span, x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 };
}

/**
 * The box the hop tracker takes its template from, in the hands-on-hips pose:
 * across the shoulders and elbows with a margin, from the jaw to past the elbows
 * but not past the hips. Clipped to the picture. Null if a shoulder is not seen.
 */
export function trunkBox(landmarks, W, H) {
  if (!seen(landmarks, LM.leftShoulder) || !seen(landmarks, LM.rightShoulder)) return null;
  const s = shoulders(landmarks, W, H);
  if (!s) return null;
  const xs = [s.l.x, s.r.x];
  for (const i of [LM.leftElbow, LM.rightElbow]) {
    const p = point(landmarks, i, W, H);
    if (p && seen(landmarks, i)) xs.push(p.x);
  }
  let x0 = Math.min(...xs) - BOX_SIDE * s.span;
  let x1 = Math.max(...xs) + BOX_SIDE * s.span;
  let y0 = s.y - BOX_ABOVE * s.span;
  let y1 = s.y + BOX_BELOW * s.span;
  if (seen(landmarks, LM.leftHip) && seen(landmarks, LM.rightHip)) {
    const hips = meanOf(landmarks, [LM.leftHip, LM.rightHip], W, H);
    if (hips) y1 = Math.min(y1, hips.y);
  }
  x0 = Math.max(0, x0);
  y0 = Math.max(0, y0);
  x1 = Math.min(W, x1);
  y1 = Math.min(H, y1);
  if (!(x1 > x0 && y1 > y0)) return null;
  return { x0, y0, x1, y1 };
}

/**
 * The whole body's centre of mass in the picture: each segment's own centre,
 * weighted by its share of the mass (SEGMENTS). Null if a landmark is missing.
 *
 * This is the centre of mass of the body as the picture shows it, every point
 * where the camera put it. Parts nearer or further than the trunk are drawn
 * larger or smaller, and nearer or further from the middle of the picture, than
 * a flat body would be; what that costs when the legs fold back in the air is
 * measured in the tests.
 */
export function centreOfMass(landmarks, W, H) {
  let x = 0;
  let y = 0;
  let m = 0;
  for (const s of SEGMENTS) {
    const a = meanOf(landmarks, s.from, W, H);
    const b = meanOf(landmarks, s.to, W, H);
    if (!a || !b) return null;
    x += s.mass * (a.x + s.com * (b.x - a.x));
    y += s.mass * (a.y + s.com * (b.y - a.y));
    m += s.mass;
  }
  return { x: x / m, y: y / m };
}

/**
 * The centre of mass less the trunk reference point (the mean of the two
 * shoulders and the two hips). The hop fit adds this to the tracked trunk:
 * when the legs fold in the air the centre of mass rises against the trunk, and
 * only the centre of mass is in free fall. Anything that moves the whole set of
 * landmarks at once — the model's frame-to-frame jitter is mostly that — cancels
 * in the difference.
 */
export function comOffset(landmarks, W, H) {
  const c = centreOfMass(landmarks, W, H);
  const ref = meanOf(landmarks, [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip], W, H);
  if (!c || !ref) return null;
  return { dx: c.x - ref.x, dy: c.y - ref.y };
}

/**
 * Hip to ankle, the mean of the two legs, in pixels; NaN if a point is missing.
 * Bent knees shorten it, so against the same person standing it says whether
 * the knees are straight.
 */
export function legLength(landmarks, W, H) {
  let s = 0;
  for (const [h, a] of [
    [LM.leftHip, LM.leftAnkle],
    [LM.rightHip, LM.rightAnkle],
  ]) {
    const p = point(landmarks, h, W, H);
    const q = point(landmarks, a, W, H);
    if (!p || !q) return NaN;
    s += dist(p, q);
  }
  return s / 2;
}

/** Both wrists within HANDS_ON_HIPS shoulder spans of their own hip. */
export function handsOnHips(landmarks, W, H) {
  const s = shoulders(landmarks, W, H);
  if (!s) return false;
  const limit = HANDS_ON_HIPS * s.span;
  for (const [w, h] of [
    [LM.leftWrist, LM.leftHip],
    [LM.rightWrist, LM.rightHip],
  ]) {
    const p = point(landmarks, w, W, H);
    const q = point(landmarks, h, W, H);
    if (!p || !q || !(dist(p, q) < limit)) return false;
  }
  return true;
}

/** The image row of the chest line; NaN if a shoulder or hip is missing. */
export function chestRowY(landmarks, W, H) {
  const sh = meanOf(landmarks, [LM.leftShoulder, LM.rightShoulder], W, H);
  const hp = meanOf(landmarks, [LM.leftHip, LM.rightHip], W, H);
  if (!sh || !hp) return NaN;
  return sh.y + CHEST_DOWN * (hp.y - sh.y);
}

/**
 * How wide the person is at image row yImg, along the run of person that holds
 * image column xCentreImg. Image pixels in and out; the mask may be coarser.
 *
 * Each of 2·rows + 1 rows, one mask cell apart and centred on yImg, is walked out
 * from the centre to where the confidence falls through `level`, and each edge is
 * put between the two cells either side of it by straight-line interpolation —
 * to a fraction of a cell, which on a 256-wide mask of a 720-wide picture is the
 * difference between a 2.8 px step and a smooth reading. The rows are read
 * between the mask's own rows (blending the two either side) so that the middle
 * one is the row asked for and not up to half a cell away, which matters where
 * the outline slopes. The median width over the rows is the answer, with the
 * edges of that row, so one row pushed out or nibbled by a stray cell does not
 * move it.
 *
 * Refused, with the reason in plain words, if the centre is not inside the
 * person on every row, if a run reaches the side of the mask (the person is cut
 * off, so the width is not known), or if the width is more than maxWidthPx —
 * the caller passes 1.3 shoulder spans, wider than a chest, which is what the
 * mask shows when the arms touch the body and join it. That last refusal still
 * says what it measured.
 */
export function widthAtRow(mask, mw, mh, yImg, xCentreImg, W, H, { rows = 3, level = 0.5, maxWidthPx = Infinity } = {}) {
  const refuse = (reason, measured = {}) => ({ ok: false, left: NaN, right: NaN, width: NaN, ...measured, reason });
  if (!mask || !(mw > 0) || !(mh > 0) || mask.length < mw * mh) return refuse('There is no outline of the person to measure.');
  if (!(yImg >= 0 && yImg < H && xCentreImg >= 0 && xCentreImg < W)) return refuse('The place to measure is outside the picture.');
  const sx = mw / W;
  const sy = mh / H;
  const n = Math.max(0, Math.floor(rows));
  const c0 = Math.min(mw - 1, Math.max(0, Math.round(xCentreImg * sx - 0.5)));
  const rowF = yImg * sy - 0.5;
  const found = [];
  for (let k = -n; k <= n; k++) {
    const r = Math.min(mh - 1, Math.max(0, rowF + k));
    const j0 = Math.floor(r);
    const j1 = Math.min(mh - 1, j0 + 1);
    const f = r - j0;
    const at = (i) => (1 - f) * mask[j0 * mw + i] + f * mask[j1 * mw + i] || 0;
    if (!(at(c0) >= level)) return refuse('The middle of the measuring line is not on the body.');
    let lo = c0;
    while (lo > 0 && at(lo - 1) >= level) lo--;
    let hi = c0;
    while (hi < mw - 1 && at(hi + 1) >= level) hi++;
    if (lo === 0 || hi === mw - 1) return refuse('The body runs off the side of the picture. Stand in the middle.');
    // cell lo−1 is outside and lo inside; hi inside and hi+1 outside
    const a = at(lo - 1);
    const b = at(lo);
    const c = at(hi);
    const d = at(hi + 1);
    const left = (lo - 1 + (level - a) / (b - a) + 0.5) / sx;
    const right = (hi + (c - level) / (c - d) + 0.5) / sx;
    found.push({ left, right, width: right - left });
  }
  found.sort((p, q) => p.width - q.width);
  const m = found[found.length >> 1];
  if (m.width > maxWidthPx) return refuse('The arms are touching the body. Hold them clear of it.', { left: m.left, right: m.right, width: m.width });
  return { ok: true, left: m.left, right: m.right, width: m.width, reason: null };
}

/**
 * How tall the person stands in the picture, in image pixels, for the display.
 *
 * top: the top of the outline in a band of columns round the nose, found by
 * walking up each column from the nose's row to where the mask falls through a
 * half and interpolating between the two cells either side. Walking up from the
 * face, rather than down from the top of the picture, means something in the
 * room above the head is never taken for it. If the outline runs to the top of
 * the picture the head is cut off and there is no answer.
 *
 * bottom: the lowest of the heel and toe landmarks. Those are points on the
 * foot, not the floor under it, so the height reads short by however high they
 * sit — on a real foot that is not known here.
 *
 * Null if either foot has neither its heel nor its toe in view.
 */
export function bodyHeightPx(landmarks, mask, mw, mh, W, H) {
  const feet = [];
  for (const foot of [
    [LM.leftHeel, LM.leftFootIndex],
    [LM.rightHeel, LM.rightFootIndex],
  ]) {
    const ys = foot.filter((i) => seen(landmarks, i)).map((i) => point(landmarks, i, W, H)).filter(Boolean).map((p) => p.y);
    if (!ys.length) return null;
    feet.push(...ys);
  }
  const bottom = Math.max(...feet);
  const nose = point(landmarks, LM.nose, W, H);
  const s = shoulders(landmarks, W, H);
  if (!nose || !s || !mask || !(mw > 0) || !(mh > 0) || mask.length < mw * mh) return null;
  const sx = mw / W;
  const sy = mh / H;
  const j0 = Math.round(nose.y * sy - 0.5);
  if (j0 < 0 || j0 >= mh) return null;
  // columns whose centres fall in the band; at least the one under the nose
  const mid = Math.min(mw - 1, Math.max(0, Math.round(nose.x * sx - 0.5)));
  const iLo = Math.max(0, Math.min(mid, Math.ceil((nose.x - HEAD_BAND * s.span) * sx - 0.5)));
  const iHi = Math.min(mw - 1, Math.max(mid, Math.floor((nose.x + HEAD_BAND * s.span) * sx - 0.5)));
  let top = Infinity;
  for (let i = iLo; i <= iHi; i++) {
    if (!(mask[j0 * mw + i] >= MASK_LEVEL)) continue;
    let j = j0;
    while (j > 0 && mask[(j - 1) * mw + i] >= MASK_LEVEL) j--;
    if (j === 0) return null;
    const a = mask[(j - 1) * mw + i] || 0;
    const b = mask[j * mw + i];
    top = Math.min(top, (j - 1 + (MASK_LEVEL - a) / (b - a) + 0.5) / sy);
  }
  if (!Number.isFinite(top) || !(bottom > top)) return null;
  return { top, bottom, height: bottom - top };
}
