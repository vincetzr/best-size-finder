// What the page reads off a body (src/body.js), on a synthetic figure.
//
// The figure is a 1.75 m adult seen from the front at 600 px/m, put together
// from rounded textbook proportions, hands on hips; its mask is drawn from
// simple shapes with soft edges, coarser than the picture, as the pose model's
// is. These say what the arithmetic does on that figure. They do not say what
// MediaPipe's landmarks or mask do on a real person.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rng } from '../sim/hopper.mjs';
import {
  LM,
  px,
  trunkBox,
  SEGMENTS,
  centreOfMass,
  comOffset,
  legLength,
  handsOnHips,
  chestRowY,
  widthAtRow,
  bodyHeightPx,
} from '../src/body.js';

const W = 720;
const H = 1280;
const PPM = 600; // pixels per metre at the body
const FLOOR = 1180; // image row of the floor
const MID = 360; // image column of the body's midline
const MW = 256; // mask, coarser than the picture and not quite the same shape
const MH = 456;

const deg = (d) => (d * Math.PI) / 180;

// ——— the figure, in metres: x to the person's left (the image right for an
// unmirrored camera), h above the floor, z away from the camera ———

const PAIRED = [
  ['EyeInner', 0.015, 1.638],
  ['Eye', 0.032, 1.638],
  ['EyeOuter', 0.045, 1.638],
  ['Ear', 0.075, 1.615],
  ['Shoulder', 0.185, 1.43],
  ['Hip', 0.09, 0.91],
  ['Knee', 0.085, 0.5],
  ['Ankle', 0.08, 0.07],
  ['Heel', 0.08, 0.03],
  ['FootIndex', 0.1, 0.015],
];
const ARMS = {
  // wrists on the crest of the hip bone, elbows out
  hips: [
    ['Elbow', 0.36, 1.16],
    ['Wrist', 0.16, 1.0],
    ['Pinky', 0.11, 0.95],
    ['Index', 0.1, 0.96],
    ['Thumb', 0.14, 1.03],
  ],
  // relaxed, hanging beside the thighs
  hanging: [
    ['Elbow', 0.2, 1.1],
    ['Wrist', 0.21, 0.85],
    ['Pinky', 0.215, 0.77],
    ['Index', 0.2, 0.76],
    ['Thumb', 0.18, 0.8],
  ],
  // hands flat on the chest
  chest: [
    ['Elbow', 0.3, 1.2],
    ['Wrist', 0.1, 1.3],
    ['Pinky', 0.06, 1.25],
    ['Index', 0.04, 1.3],
    ['Thumb', 0.07, 1.34],
  ],
};
const BELOW_KNEE = ['Ankle', 'Heel', 'FootIndex'];

/**
 * 3D points of the figure by landmark index. `fold`: knee flexion in degrees,
 * the shank and foot swung back about the knee as one piece, thigh upright.
 * `arms`: a pose from ARMS for both sides, or { left, right }.
 */
function figure3d({ arms = 'hips', fold = 0 } = {}) {
  const P = new Array(33);
  P[LM.nose] = [0, 1.6, 0];
  P[LM.mouthLeft] = [0.025, 1.555, 0];
  P[LM.mouthRight] = [-0.025, 1.555, 0];
  const pose = typeof arms === 'string' ? { left: arms, right: arms } : arms;
  for (const [side, s] of [
    ['left', 1],
    ['right', -1],
  ]) {
    for (const [name, x, h] of [...PAIRED, ...ARMS[pose[side]]]) P[LM[side + name]] = [s * x, h, 0];
    const fd = typeof fold === 'number' ? fold : fold[side];
    if (fd) {
      const [, kh] = P[LM[side + 'Knee']];
      for (const name of BELOW_KNEE) {
        const p = P[LM[side + name]];
        const down = p[1] - kh; // negative
        P[LM[side + name]] = [p[0], kh + down * Math.cos(deg(fd)), p[2] - down * Math.sin(deg(fd))];
      }
    }
  }
  return P;
}

/** Straight-on view at PPM, depth ignored: what the front view shows. */
function flat(P, { dx = 0, dy = 0, visibility = 0.99 } = {}) {
  return P.map(([x, h]) => ({ x: (MID + x * PPM + dx) / W, y: (FLOOR - h * PPM + dy) / H, z: 0, visibility }));
}

/** Image pixels of a figure point, in the flat view. */
const at = (x, h) => ({ x: MID + x * PPM, y: FLOOR - h * PPM });

const figure = (opts = {}, view = {}) => flat(figure3d(opts), view);

// ——— masks ———
// Each shape gives a signed distance in image pixels, positive inside. The mask
// cell at (i, j) is sampled at its centre, ((i + 0.5) W/mw, (j + 0.5) H/mh).

const rect = (x0, y0, x1, y1) => (X, Y) => Math.min(X - x0, x1 - X, Y - y0, y1 - Y);
const ellipse = (xc, yc, a, b) => (X, Y) => {
  // first-order distance to the outline: exact on it, which is all a 0.5 crossing needs
  const u = X - xc;
  const v = Y - yc;
  const F = (u / a) ** 2 + (v / b) ** 2 - 1;
  const g = 2 * Math.hypot(u / (a * a), v / (b * b));
  return g > 0 ? -F / g : Math.min(a, b);
};
const capsule = (p, q, r) => (X, Y) => {
  const ux = q.x - p.x;
  const uy = q.y - p.y;
  const t = Math.max(0, Math.min(1, ((X - p.x) * ux + (Y - p.y) * uy) / (ux * ux + uy * uy)));
  return r - Math.hypot(X - p.x - t * ux, Y - p.y - t * uy);
};

/**
 * Render shapes into a mask. 'linear': confidence rises from 0 to 1 over two
 * mask cells across the outline. 'smooth': a tanh of about the same width,
 * which straight-line interpolation does not follow exactly.
 */
function render(shapes, mw = MW, mh = MH, edge = 'linear') {
  const m = new Float32Array(mw * mh);
  const s = Math.sqrt((mw / W) * (mh / H)); // mask cells per image pixel
  for (let j = 0; j < mh; j++) {
    const Y = ((j + 0.5) * H) / mh;
    for (let i = 0; i < mw; i++) {
      const X = ((i + 0.5) * W) / mw;
      let d = -Infinity;
      for (const f of shapes) d = Math.max(d, f(X, Y));
      d *= s;
      m[j * mw + i] = edge === 'linear' ? Math.min(1, Math.max(0, 0.5 + d / 2)) : 0.5 + 0.5 * Math.tanh(d);
    }
  }
  return m;
}

/** The figure's outline, from its flat-view points. */
function figureShapes(lm, { upperArmR = 0.045 } = {}) {
  const P = (i) => px(lm[i], W, H);
  const m = (metres) => metres * PPM;
  const nose = P(LM.nose);
  const head = { x: nose.x, y: nose.y - m(0.035) }; // centre at 1.635 m, crown at 1.75
  const shapes = [ellipse(head.x, head.y, m(0.078), m(0.115)), rect(MID - m(0.055), at(0, 1.57).y, MID + m(0.055), at(0, 1.4).y)];
  shapes.push(rect(MID - m(0.16), at(0, 1.46).y, MID + m(0.16), at(0, 0.85).y)); // trunk, 32 cm across
  for (const side of ['left', 'right']) {
    const L = (name) => P(LM[side + name]);
    shapes.push(capsule(L('Shoulder'), L('Elbow'), m(upperArmR)));
    shapes.push(capsule(L('Elbow'), L('Wrist'), m(0.035)));
    shapes.push(capsule(L('Wrist'), L('Index'), m(0.03)));
    shapes.push(capsule(L('Hip'), L('Knee'), m(0.075)));
    shapes.push(capsule(L('Knee'), L('Ankle'), m(0.05)));
    shapes.push(capsule(L('Heel'), L('FootIndex'), m(0.03)));
  }
  return shapes;
}

const shoulderSpan = (lm) => Math.hypot(...['x', 'y'].map((k) => px(lm[LM.leftShoulder], W, H)[k] - px(lm[LM.rightShoulder], W, H)[k]));

// ——— landmarks and conversions ———

test('LM names all 33 MediaPipe Pose indices, once each', () => {
  const v = Object.values(LM).sort((a, b) => a - b);
  assert.deepEqual(v, [...Array(33).keys()]);
  assert.equal(LM.nose, 0);
  assert.equal(LM.leftEar, 7);
  assert.equal(LM.leftShoulder, 11);
  assert.equal(LM.rightWrist, 16);
  assert.equal(LM.leftIndex, 19);
  assert.equal(LM.rightHip, 24);
  assert.equal(LM.leftHeel, 29);
  assert.equal(LM.rightFootIndex, 32);
});

test('px: normalised 0 and 1 are the edges of the picture', () => {
  assert.deepEqual(px({ x: 0, y: 0 }, W, H), { x: 0, y: 0 });
  assert.deepEqual(px({ x: 1, y: 1 }, W, H), { x: W, y: H });
  assert.deepEqual(px({ x: 0.5, y: 0.25 }, W, H), { x: 360, y: 320 });
});

// ——— widths out of the mask ———

test('a mask one cell wide measures one cell wide, in the right place', () => {
  // with hard edges the half-way crossings are half a cell either side of the
  // cell's centre, so the person spans exactly the cell, which in the picture is
  // x = i·W/mw to (i + 1)·W/mw. Pixel centres taken at i·W/mw instead would put
  // both edges 1.4 px to the left.
  const m = new Float32Array(MW * MH);
  const i = 100;
  for (let j = 0; j < MH; j++) m[j * MW + i] = 1;
  const r = widthAtRow(m, MW, MH, 640, ((i + 0.5) * W) / MW, W, H);
  assert.ok(r.ok, r.reason);
  assert.ok(Math.abs(r.left - (i * W) / MW) < 1e-9, `left ${r.left}`);
  assert.ok(Math.abs(r.right - ((i + 1) * W) / MW) < 1e-9, `right ${r.right}`);
  assert.ok(Math.abs(r.width - W / MW) < 1e-9);
});

test('widthAtRow: a rectangle through a mask a third of the resolution, to a fraction of a pixel', () => {
  const x0 = 250.3;
  const x1 = 469.9;
  const shapes = [rect(x0, 300, x1, 900)];
  for (const edge of ['linear', 'smooth']) {
    const m = render(shapes, MW, MH, edge);
    const r = widthAtRow(m, MW, MH, 600, 360, W, H);
    assert.ok(r.ok, r.reason);
    const e = r.width - (x1 - x0);
    console.log(`  rectangle, ${edge} edge: width ${r.width.toFixed(3)} px for ${(x1 - x0).toFixed(3)} (error ${e.toFixed(3)} px; edges ${(r.left - x0).toFixed(3)}, ${(r.right - x1).toFixed(3)})`);
    assert.ok(Math.abs(e) < 0.5);
    assert.ok(Math.abs(r.left - x0) < 0.5 && Math.abs(r.right - x1) < 0.5);
    // a straight-line edge is followed exactly
    if (edge === 'linear') assert.ok(Math.abs(e) < 1e-3 && Math.abs(r.left - x0) < 1e-3, `${e}`);
  }
});

test('sub-pixel: moving the rectangle by part of a mask cell moves the edges by as much', () => {
  const cell = W / MW; // 2.8125 image px
  let worst = { linear: 0, smooth: 0 };
  for (const edge of ['linear', 'smooth']) {
    for (const frac of [0, 0.1, 0.25, 0.4, 0.5, 0.63, 0.77, 0.9]) {
      const x0 = 250 + frac * cell;
      const x1 = 470 + frac * cell;
      const r = widthAtRow(render([rect(x0, 300, x1, 900)], MW, MH, edge), MW, MH, 600, 360, W, H);
      assert.ok(r.ok, r.reason);
      worst[edge] = Math.max(worst[edge], Math.abs(r.left - x0), Math.abs(r.right - x1));
    }
  }
  console.log(`  worst edge error over eight sub-cell shifts: linear edge ${worst.linear.toExponential(1)} px, smooth edge ${worst.smooth.toFixed(3)} px`);
  assert.ok(worst.linear < 1e-3);
  assert.ok(worst.smooth < 0.25);
});

test('an ellipse cross-section, on a row between the mask rows', () => {
  const xc = 360;
  const yc = 640;
  const a = 100;
  const b = 300;
  const m = render([ellipse(xc, yc, a, b)]);
  const truth = (y) => 2 * a * Math.sqrt(1 - ((y - yc) / b) ** 2);
  for (const y of [640 + 150.3, 640 - 201.7, 640 + 75.55]) {
    const r = widthAtRow(m, MW, MH, y, xc, W, H);
    assert.ok(r.ok, r.reason);
    const e = r.width - truth(y);
    // what reading the nearest mask row instead would have cost here
    const near = ((Math.round((y * MH) / H - 0.5) + 0.5) * H) / MH;
    console.log(`  ellipse at y=${y}: ${r.width.toFixed(3)} px for ${truth(y).toFixed(3)} (error ${e.toFixed(3)}); the nearest mask row is ${(near - y).toFixed(2)} px away, where the width differs by ${(truth(near) - truth(y)).toFixed(3)}`);
    assert.ok(Math.abs(e) < 0.5);
    assert.ok(Math.abs(r.left - (xc - truth(y) / 2)) < 0.5);
  }
  // at the widest row the rows either side are all narrower, so the median is
  // the width a couple of rows off: short, by this much on this ellipse
  const r = widthAtRow(m, MW, MH, yc, xc, W, H);
  const e = r.width - truth(yc);
  console.log(`  ellipse at its widest row: ${r.width.toFixed(3)} px for ${truth(yc).toFixed(3)} (error ${e.toFixed(3)})`);
  assert.ok(e < 0 && e > -0.5);
});

test('refuses off the body, off the side of the picture, and when the arms have joined the chest', () => {
  const trunk = rect(260, 300, 460, 900);
  // off-centre: in the gap beside the trunk
  const alone = render([trunk]);
  const off = widthAtRow(alone, MW, MH, 600, 480, W, H);
  assert.equal(off.ok, false);
  assert.match(off.reason, /not on the body/);
  console.log(`  off-centre: "${off.reason}"`);
  // the person running off the side of the picture
  const cut = widthAtRow(render([rect(-50, 300, 300, 900)]), MW, MH, 600, 150, W, H);
  assert.equal(cut.ok, false);
  assert.match(cut.reason, /side of the picture/);
  console.log(`  cut off: "${cut.reason}"`);
  // arms against the sides: the run is trunk and arms together
  const span = 222;
  const merged = render([trunk, rect(200, 280, 262, 640), rect(458, 280, 520, 640)]);
  const r = widthAtRow(merged, MW, MH, 400, 360, W, H, { maxWidthPx: 1.3 * span });
  assert.equal(r.ok, false);
  assert.match(r.reason, /arms/);
  assert.ok(Math.abs(r.width - 320) < 0.5, `measured ${r.width}`);
  console.log(`  arms merged: ${r.width.toFixed(1)} px > ${(1.3 * span).toFixed(1)}: "${r.reason}"`);
  // and the same picture without the limit measures the merged run
  assert.ok(widthAtRow(merged, MW, MH, 400, 360, W, H).ok);
  // a hole under the centre on one of the seven rows is not stepped over
  const holed = render([trunk]);
  const jHole = Math.round((600 * MH) / H - 0.5) + 2;
  for (let i = 125; i <= 131; i++) holed[jHole * MW + i] = 0;
  assert.equal(widthAtRow(holed, MW, MH, 600, 360, W, H).ok, false);
  // a mask of the wrong size, or none
  assert.match(widthAtRow(new Float32Array(10), MW, MH, 600, 360, W, H).reason, /outline/);
  assert.equal(widthAtRow(null, MW, MH, 600, 360, W, H).ok, false);
  assert.equal(widthAtRow(alone, MW, MH, -1, 360, W, H).ok, false);
});

test('one row pushed out by a stray cell does not move the median', () => {
  const x0 = 250.3;
  const x1 = 469.9;
  const m = render([rect(x0, 300, x1, 900)]);
  const clean = widthAtRow(m, MW, MH, 600, 360, W, H);
  // three cells of person stuck to the right edge, on one row of the seven
  const j = Math.round((600 * MH) / H - 0.5) - 1;
  const edge = Math.floor((x1 * MW) / W - 0.5);
  for (let i = edge; i <= edge + 3; i++) m[j * MW + i] = 1;
  const r = widthAtRow(m, MW, MH, 600, 360, W, H);
  const one = widthAtRow(m, MW, MH, 600, 360, W, H, { rows: 0 });
  console.log(`  stray cells on one row: median ${r.width.toFixed(3)} px (clean ${clean.width.toFixed(3)}); that row alone would read ${widthAtRow(m, MW, MH, ((j + 0.5) * H) / MH, 360, W, H, { rows: 0 }).width.toFixed(3)}`);
  assert.ok(Math.abs(r.width - clean.width) < 1e-6);
  assert.ok(Math.abs(one.width - clean.width) < 1e-6, 'the row asked for is not the spoiled one');
});

test('the chest of the figure: arms held clear are left out, at either mask resolution', () => {
  const lm = figure();
  const y = chestRowY(lm, W, H);
  const span = shoulderSpan(lm);
  const xc = (px(lm[LM.leftShoulder], W, H).x + px(lm[LM.rightShoulder], W, H).x) / 2;
  for (const [mw, mh] of [
    [MW, MH],
    [W, H],
  ]) {
    const r = widthAtRow(render(figureShapes(lm), mw, mh), mw, mh, y, xc, W, H, { maxWidthPx: 1.3 * span });
    assert.ok(r.ok, r.reason);
    console.log(`  chest at ${mw}x${mh}: ${r.width.toFixed(3)} px for 192 (0.32 m), edges ${r.left.toFixed(3)}, ${r.right.toFixed(3)}`);
    assert.ok(Math.abs(r.width - 0.32 * PPM) < 0.5);
    assert.ok(Math.abs(r.left - (MID - 0.16 * PPM)) < 0.5);
  }
});

test('the chest of the figure with thick arms hanging against it is refused', () => {
  const lm = figure({ arms: 'hanging' });
  const span = shoulderSpan(lm);
  const r = widthAtRow(render(figureShapes(lm, { upperArmR: 0.06 })), MW, MH, chestRowY(lm, W, H), MID, W, H, { maxWidthPx: 1.3 * span });
  console.log(`  thick arms hanging: ${r.width.toFixed(1)} px = ${(r.width / span).toFixed(3)} spans: "${r.reason}"`);
  assert.equal(r.ok, false);
});

test('limitation: slim arms hanging against the chest get under the 1.3-span limit', () => {
  // with upper arms 8 cm thick, chest and arms together are 1.24 spans and are
  // measured as the chest: 0.46 m for a 0.32 m chest
  const lm = figure({ arms: 'hanging' });
  const span = shoulderSpan(lm);
  const r = widthAtRow(render(figureShapes(lm, { upperArmR: 0.04 })), MW, MH, chestRowY(lm, W, H), MID, W, H, { maxWidthPx: 1.3 * span });
  console.log(`  slim arms hanging: ok=${r.ok}, ${r.width.toFixed(1)} px = ${(r.width / PPM).toFixed(3)} m = ${(r.width / span).toFixed(3)} spans, for a 0.320 m chest (0.320 m = ${((0.32 * PPM) / span).toFixed(3)} spans)`);
  assert.equal(r.ok, true);
  assert.ok(r.width / span > 1.2 && r.width / span < 1.3);
});

// ——— the centre of mass ———

test('SEGMENTS: de Leva means, renormalised', () => {
  assert.equal(SEGMENTS.length, 14);
  const raw = 0.0681 + 0.4302 + 2 * (0.0263 + 0.015 + 0.00585 + 0.1447 + 0.0457 + 0.0133);
  assert.ok(Math.abs(raw - 1) < 1e-9, `the rounded table adds up to ${raw}`);
  assert.ok(Math.abs(SEGMENTS.reduce((s, x) => s + x.mass, 0) - 1) < 1e-12);
  const by = Object.fromEntries(SEGMENTS.map((s) => [s.name, s]));
  assert.ok(Math.abs(by.trunk.mass - 0.4302 / raw) < 1e-12);
  assert.ok(Math.abs(by['left thigh'].mass - 0.1447 / raw) < 1e-12);
  assert.equal(by['right upper arm'].com, 0.576);
  assert.deepEqual([...by['left foot'].from, ...by['left foot'].to], [LM.leftHeel, LM.leftFootIndex]);
  assert.ok(Object.isFrozen(SEGMENTS) && Object.isFrozen(SEGMENTS[0]));
});

test('the centre of mass of the symmetric figure is on the midline, between shoulders and hips', () => {
  const lm = figure();
  const c = centreOfMass(lm, W, H);
  assert.ok(Math.abs(c.x - MID) < 1e-9, `x ${c.x}`);
  const shoulderY = at(0, 1.43).y;
  const hipY = at(0, 0.91).y;
  assert.ok(c.y > shoulderY && c.y < hipY, `y ${c.y}`);
  // about 55 per cent of stature is the usual figure for an adult standing
  const frac = (FLOOR - c.y) / PPM / 1.75;
  console.log(`  centre of mass ${((FLOOR - c.y) / PPM).toFixed(3)} m above the floor, ${(100 * frac).toFixed(1)}% of stature; ${(c.y - shoulderY).toFixed(1)} px below the shoulder line, ${(hipY - c.y).toFixed(1)} px above the hips`);
  assert.ok(frac > 0.53 && frac < 0.58);
  assert.equal(centreOfMass(lm.slice(0, 30), W, H), null);
});

// by hand from the table, mean of de Leva's female and male values
const T = { head: 0.0681, trunk: 0.4302, upperArm: 0.0263, forearm: 0.015, hand: 0.00585, thigh: 0.1447, shank: 0.0457, foot: 0.0133 };
const T_SUM = T.head + T.trunk + 2 * (T.upperArm + T.forearm + T.hand + T.thigh + T.shank + T.foot);

test('folding the knees 45° raises the centre of mass against the trunk by what the table says', () => {
  const fold = 45;
  const straight = comOffset(figure(), W, H);
  const bent = comOffset(figure({ fold }), W, H);
  // seen from the front the shank and foot swing back and look shorter: every
  // point below the knee rises by (1 − cos 45°) of its drop from the knee. The
  // trunk does not move, so the rise is all shank and foot
  const k = 0.5;
  const drop = { ankle: k - 0.07, heel: k - 0.03, toe: k - 0.015 };
  const perSide = T.shank * 0.444 * drop.ankle + T.foot * ((1 - 0.42) * drop.heel + 0.42 * drop.toe);
  const expected = ((2 * perSide) / T_SUM) * (1 - Math.cos(deg(fold))) * PPM;
  const rise = straight.dy - bent.dy;
  console.log(`  knees folded 45°: centre of mass rises ${rise.toFixed(4)} px against the trunk; by hand ${expected.toFixed(4)} px`);
  assert.ok(Math.abs(rise - expected) < 0.5);
  assert.ok(Math.abs(rise - expected) < 1e-6);
  assert.ok(Math.abs(bent.dx - straight.dx) < 1e-9);
});

test('comOffset: moving the whole figure changes nothing', () => {
  const a = comOffset(figure(), W, H);
  for (const [dx, dy] of [
    [37.25, -12.5],
    [-120, 64.1],
    [0.3, 0.7],
  ]) {
    const b = comOffset(figure({}, { dx, dy }), W, H);
    assert.ok(Math.abs(a.dx - b.dx) < 1e-9 && Math.abs(a.dy - b.dy) < 1e-9);
  }
  // and the reference point is the mean of shoulders and hips
  const lm = figure();
  const c = centreOfMass(lm, W, H);
  const refY = (2 * at(0, 1.43).y + 2 * at(0, 0.91).y) / 4;
  assert.ok(Math.abs(c.y - refY - a.dy) < 1e-9);
});

test('comOffset: independent noise on every landmark comes through at the table’s weights', () => {
  // each landmark carries its share of every segment centre it is an end of,
  // less a quarter for the four points of the reference
  const side = [
    (T.trunk / 4 + (1 - 0.576) * T.upperArm) / T_SUM - 0.25, // shoulder
    (0.576 * T.upperArm + (1 - 0.457) * T.forearm) / T_SUM, // elbow
    (0.457 * T.forearm + 0.5 * T.hand) / T_SUM, // wrist
    (0.5 * T.hand) / T_SUM, // index finger
    (T.trunk / 4 + (1 - 0.385) * T.thigh) / T_SUM - 0.25, // hip
    (0.385 * T.thigh + (1 - 0.444) * T.shank) / T_SUM, // knee
    (0.444 * T.shank) / T_SUM, // ankle
    ((1 - 0.42) * T.foot) / T_SUM, // heel
    (0.42 * T.foot) / T_SUM, // toe
    (0.5 * T.head) / T_SUM, // ear
  ];
  assert.ok(Math.abs(2 * side.reduce((s, w) => s + w, 0)) < 1e-12, 'the weights add up to nothing, so a shift of everything cancels');
  const gain = Math.sqrt(2 * side.reduce((s, w) => s + w * w, 0));

  const sigma = 1; // px, on each axis of each of the 33 landmarks
  const r = rng(7);
  const base = comOffset(figure(), W, H);
  const P = figure3d();
  const N = 4000;
  const ex = [];
  const ey = [];
  for (let k = 0; k < N; k++) {
    const lm = flat(P).map((l) => ({ ...l, x: l.x + (sigma * r.normal()) / W, y: l.y + (sigma * r.normal()) / H }));
    const o = comOffset(lm, W, H);
    ex.push(o.dx - base.dx);
    ey.push(o.dy - base.dy);
  }
  const sd = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
  const sx = sd(ex);
  const sy = sd(ey);
  console.log(`  1 px of independent noise on every landmark: comOffset moves ${sx.toFixed(3)} px (x), ${sy.toFixed(3)} px (y) SD; by hand from the table ${gain.toFixed(3)} px`);
  console.log(`  the largest weights: shoulder ${side[0].toFixed(3)}, knee ${side[5].toFixed(3)}, hip ${side[4].toFixed(3)}, ear ${side[9].toFixed(3)}, elbow ${side[1].toFixed(3)}`);
  assert.ok(Math.abs(sx / gain - 1) < 0.06 && Math.abs(sy / gain - 1) < 0.06);
});

test('limitation: in a real camera, legs folding backwards look higher than they are, and comOffset over-reads', () => {
  // A pinhole camera as in sim/hopper.mjs: 62° vertical field, 1.3 m up, level.
  // Swinging back, the shank and foot also go further away, which in a camera
  // above them draws them higher still. What is in free fall is the body's
  // centre of mass in space; its image moves against the trunk's by less than
  // the mass-weighted mean of the images, which is what comOffset can see.
  const f = H / 2 / Math.tan(deg(31));
  const camH = 1.3;
  const project = (P, Z) => P.map(([x, h, z]) => ({ x: (W / 2 + (f * x) / (Z + z)) / W, y: (H / 2 + (f * (camH - h)) / (Z + z)) / H, z: 0, visibility: 0.99 }));
  const truth = (P, Z) => {
    // the image of the 3D centre of mass, less the trunk reference
    const mean = (idx) => [0, 1, 2].map((k) => idx.reduce((s, i) => s + P[i][k], 0) / idx.length);
    const c = [0, 0, 0];
    for (const s of SEGMENTS) {
      const a = mean(s.from);
      const b = mean(s.to);
      for (let k = 0; k < 3; k++) c[k] += s.mass * (a[k] + s.com * (b[k] - a[k]));
    }
    const img = project([c], Z)[0];
    const ref = project([LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip].map((i) => P[i]), Z);
    return (img.y - ref.reduce((s, p) => s + p.y, 0) / 4) * H;
  };
  const rows = [];
  for (const Z of [2.4, 4]) {
    const P0 = figure3d();
    const P1 = figure3d({ fold: 45 });
    const seen = comOffset(project(P0, Z), W, H).dy - comOffset(project(P1, Z), W, H).dy;
    const real = truth(P0, Z) - truth(P1, Z);
    // standing, the figure is flat, and the two agree
    assert.ok(Math.abs(comOffset(project(P0, Z), W, H).dy - truth(P0, Z)) < 1e-6);
    const pxPerM = f / Z;
    rows.push({ Z, seen, real });
    console.log(`  at ${Z} m, knees folded 45°: comOffset rises ${seen.toFixed(2)} px (${((1000 * seen) / pxPerM).toFixed(1)} mm), the centre of mass's image ${real.toFixed(2)} px (${((1000 * real) / pxPerM).toFixed(1)} mm): ${(100 * (seen / real - 1)).toFixed(0)}% over`);
  }
  assert.ok(rows[0].seen > 1.3 * rows[0].real && rows[0].seen < 2 * rows[0].real);
  assert.ok(rows[1].seen / rows[1].real < rows[0].seen / rows[0].real, 'further away, less of it');
});

// ——— the pose ———

test('trunkBox on the figure', () => {
  const lm = figure();
  const span = 2 * 0.185 * PPM; // 222 px
  const b = trunkBox(lm, W, H);
  const sy = at(0, 1.43).y;
  const elbowX = 0.36 * PPM;
  const expect = { x0: MID - elbowX - 0.1 * span, x1: MID + elbowX + 0.1 * span, y0: sy - 0.3 * span, y1: sy + 0.9 * span };
  for (const k of ['x0', 'y0', 'x1', 'y1']) assert.ok(Math.abs(b[k] - expect[k]) < 1e-9, `${k} ${b[k]} for ${expect[k]}`);
  console.log(`  box ${b.x0.toFixed(1)}–${b.x1.toFixed(1)} across, ${b.y0.toFixed(1)}–${b.y1.toFixed(1)} down (hips at ${at(0, 0.91).y})`);

  // elbows out of view: shoulders only
  const noElbows = lm.map((l, i) => (i === LM.leftElbow || i === LM.rightElbow ? { ...l, visibility: 0.2 } : l));
  const e = trunkBox(noElbows, W, H);
  assert.ok(Math.abs(e.x0 - (MID - 0.185 * PPM - 0.1 * span)) < 1e-9);

  // a short trunk: stops at the hips
  const P = figure3d();
  for (const i of [LM.leftHip, LM.rightHip]) P[i] = [P[i][0], 1.25, 0];
  const s = trunkBox(flat(P), W, H);
  assert.ok(Math.abs(s.y1 - at(0, 1.25).y) < 1e-9, `y1 ${s.y1}`);

  // off the side of the picture: clipped
  const c = trunkBox(figure({}, { dx: -200 }), W, H);
  assert.equal(c.x0, 0);
  assert.ok(Math.abs(c.x1 - (expect.x1 - 200)) < 1e-9);

  // a shoulder not seen: no box
  const hidden = lm.map((l, i) => (i === LM.rightShoulder ? { ...l, visibility: 0.3 } : l));
  assert.equal(trunkBox(hidden, W, H), null);
});

test('handsOnHips', () => {
  assert.equal(handsOnHips(figure(), W, H), true);
  assert.equal(handsOnHips(figure({ arms: 'chest' }), W, H), false);
  assert.equal(handsOnHips(figure({ arms: { left: 'hips', right: 'chest' } }), W, H), false);
  assert.equal(handsOnHips(figure({ arms: { left: 'chest', right: 'hips' } }), W, H), false);
  const lm = figure();
  const d = Math.hypot(0.16 - 0.09, 1.0 - 0.91) / 0.37;
  console.log(`  hands on hips: wrist ${d.toFixed(3)} spans from its hip, limit 0.45`);
  assert.equal(handsOnHips(lm.slice(0, 15), W, H), false);
});

test('limitation: handsOnHips cannot tell hands on hips from arms hanging at the sides', () => {
  // a relaxed hanging wrist is beside the thigh, a little below and outside the
  // hip joint, and about as close to it as a wrist on the hip bone
  const d = Math.hypot(0.21 - 0.09, 0.85 - 0.91) / 0.37;
  console.log(`  arms hanging: wrist ${d.toFixed(3)} spans from its hip, limit 0.45 — passes`);
  assert.equal(handsOnHips(figure({ arms: 'hanging' }), W, H), true);
});

test('legLength: hip to ankle, both legs, shorter with the knees bent', () => {
  const straight = Math.hypot(0.01, 0.84) * PPM;
  assert.ok(Math.abs(legLength(figure(), W, H) - straight) < 1e-9);
  const bent = Math.hypot(0.01, 0.91 - (0.5 - 0.43 * Math.cos(deg(45)))) * PPM;
  assert.ok(Math.abs(legLength(figure({ fold: 45 }), W, H) - bent) < 1e-9);
  assert.ok(Math.abs(legLength(figure({ fold: { left: 45, right: 0 } }), W, H) - (straight + bent) / 2) < 1e-9);
  const ten = legLength(figure({ fold: 10 }), W, H);
  console.log(`  legs ${straight.toFixed(1)} px straight, ${bent.toFixed(1)} px at 45°, ${ten.toFixed(1)} px at 10° (${(100 * (1 - ten / straight)).toFixed(2)}% shorter)`);
  assert.ok(Number.isNaN(legLength(figure().slice(0, 27), W, H)));
});

test('chestRowY: a fifth of the way from the shoulder line to the hip line', () => {
  const sy = at(0, 1.43).y;
  const hy = at(0, 0.91).y;
  assert.ok(Math.abs(chestRowY(figure(), W, H) - (sy + 0.2 * (hy - sy))) < 1e-9);
  assert.ok(Math.abs(chestRowY(figure(), W, H) - at(0, 1.43 - 0.2 * 0.52).y) < 1e-9);
  assert.ok(Number.isNaN(chestRowY([], W, H)));
});

test('bodyHeightPx: the crown out of the mask, the feet from the landmarks', () => {
  const lm = figure();
  const m = render(figureShapes(lm));
  const h = bodyHeightPx(lm, m, MW, MH, W, H);
  const crown = at(0, 1.75).y; // 130
  const toe = at(0, 0.015).y; // the lowest foot point, 1.5 cm above the floor
  console.log(`  top ${h.top.toFixed(3)} for ${crown}, bottom ${h.bottom} for ${toe}: ${h.height.toFixed(2)} px = ${(h.height / PPM).toFixed(4)} m for a 1.75 m figure (short by its toe point's height)`);
  assert.ok(Math.abs(h.top - crown) < 0.5);
  assert.ok(Math.abs(h.bottom - toe) < 1e-9);
  assert.ok(Math.abs(h.height - (toe - crown)) < 0.5);

  // sub-pixel: the whole figure 0.4 px lower
  const lm2 = figure({}, { dy: 0.4 });
  const h2 = bodyHeightPx(lm2, render(figureShapes(lm2)), MW, MH, W, H);
  console.log(`  moved down 0.4 px: top moves ${(h2.top - h.top).toFixed(3)} px`);
  assert.ok(Math.abs(h2.top - h.top - 0.4) < 0.05);

  // something in the room above the head, not touching it, is not the head
  const lamp = render([...figureShapes(lm), rect(340, 40, 380, 90)]);
  assert.ok(Math.abs(bodyHeightPx(lm, lamp, MW, MH, W, H).top - h.top) < 1e-9);

  // feet out of view: no answer; one foot's toe hidden is enough to go on
  const noFeet = lm.map((l, i) => ([LM.leftHeel, LM.leftFootIndex].includes(i) ? { ...l, visibility: 0.1 } : l));
  assert.equal(bodyHeightPx(noFeet, m, MW, MH, W, H), null);
  const oneToe = lm.map((l, i) => (i === LM.leftFootIndex ? { ...l, visibility: 0.1 } : l));
  assert.ok(Math.abs(bodyHeightPx(oneToe, m, MW, MH, W, H).bottom - toe) < 1e-9); // the right toe is still lowest

  // the head cut off by the top of the picture: no answer
  const tall = figure({}, { dy: -140 });
  assert.equal(bodyHeightPx(tall, render(figureShapes(tall)), MW, MH, W, H), null);
});
