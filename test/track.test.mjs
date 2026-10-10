// The trunk tracker against pictures whose shift is known exactly.
//
// The scene is drawn analytically at every pixel centre — a smooth texture for
// the room and a bright, tapering trunk with antialiased edges — so a shift of
// a fraction of a pixel really is one. (Drawn with hard edges, a shape cannot
// move by less than a pixel, and a tracker's error against it says more about
// the drawing than the tracker.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TemplateTracker, toGray } from '../src/track.js';

const W = 400;
const H = 600;
const BOX = { x0: 110, y0: 140, x1: 290, y1: 340 };

function lcg(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function scene(dx, dy, { noise = 0, seed = 1, gain = 1, bias = 0, blurPx = 0 } = {}) {
  const rnd = lcg(seed);
  const g = new Float32Array(W * H);
  const value = (x, y) => {
    const X = x - dx;
    const Y = y - dy;
    const room = 120 + 30 * Math.sin(X / 7.3) * Math.cos(Y / 11.1) + 15 * Math.sin((X + Y) / 3.7);
    const sd = Math.min(70 + 0.2 * (Y - 200) - Math.abs(X - 200), Y - 150, 450 - Y);
    const m = 1 / (1 + Math.exp(-sd / 0.45));
    return (1 - m) * room + m * (200 + 10 * Math.sin(X / 5));
  };
  const K = blurPx ? 9 : 1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let v = 0;
      // motion blur: the average over a vertical smear of blurPx, centred
      for (let k = 0; k < K; k++) v += value(x, y + (K > 1 ? (k / (K - 1) - 0.5) * blurPx : 0));
      v = gain * (v / K) + bias;
      if (noise) v += noise * (rnd() + rnd() + rnd() - 1.5) * 2;
      g[y * W + x] = v;
    }
  return g;
}

function tracker() {
  const t = new TemplateTracker({ maxShift: 0.7 });
  t.setReference(scene(0, 0), W, H, BOX);
  return t;
}

test('whole and fractional shifts, from small to most of the template', () => {
  const t = tracker();
  for (const [dx, dy] of [
    [0.25, 0.5],
    [1.37, -7.81],
    [-3.2, 42.6],
    [5, -80.3],
    [0.5, 120.4],
  ]) {
    const r = t.track(scene(dx, dy), W, H);
    assert.ok(r.ok);
    const e = Math.hypot(r.dx - dx, r.dy - dy);
    assert.ok(e < 0.02, `(${dx}, ${dy}): off by ${e.toFixed(4)} px`);
  }
});

test('sensor noise', () => {
  const t = tracker();
  let ss = 0;
  let n = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const dx = 0.3 * seed - 1.1;
    const dy = 9.7 * seed - 40.2;
    const r = t.track(scene(dx, dy, { noise: 4, seed }), W, H);
    ss += (r.dx - dx) ** 2 + (r.dy - dy) ** 2;
    n++;
  }
  const rms = Math.sqrt(ss / n);
  assert.ok(rms < 0.08, `rms ${rms.toFixed(4)} px`);
});

test('the camera turning its brightness up and down', () => {
  const t = tracker();
  const r = t.track(scene(2.4, -13.6, { gain: 0.8, bias: 15 }), W, H);
  assert.ok(r.ok);
  assert.ok(Math.hypot(r.dx - 2.4, r.dy + 13.6) < 0.05);
});

test('motion blur reads as the middle of the smear', () => {
  // a body moving at a metre a second through a 1/60 s exposure is smeared
  // over several pixels; the middle of the smear is the middle of the exposure
  const t = tracker();
  const r = t.track(scene(1.1, 20.3, { blurPx: 6 }), W, H);
  assert.ok(r.ok);
  assert.ok(Math.hypot(r.dx - 1.1, r.dy - 20.3) < 0.15, `(${r.dx}, ${r.dy})`);
});

test('found from no prediction at all, most of a template-height away', () => {
  const t = tracker();
  const r = t.track(scene(0, -0.4 * (BOX.y1 - BOX.y0)), W, H, { dx: 0, dy: 0 });
  assert.ok(r.ok);
  assert.ok(Math.abs(r.dy + 0.4 * (BOX.y1 - BOX.y0)) < 0.05);
});

test('something across the chest: tracked if small, refused if large, never misread', () => {
  // nothing should cover the chest in the hands-on-hips pose; but a strap or a
  // stray hand must not pull the answer with it. A flat patch over 7 per cent of
  // the template is weighed out; over 15 per cent the tracker gives up, which
  // is a lost frame to the fit — never a wrong position
  const t = tracker();
  for (const [pw, ph, mustTrack] of [
    [60, 40, true],
    [90, 60, false],
  ]) {
    const g = scene(-1.6, 31.2);
    const x0 = Math.round(BOX.x0 - 1.6 + 30);
    const y0 = Math.round(BOX.y0 + 31.2 + 90);
    for (let y = y0; y < y0 + ph; y++) for (let x = x0; x < x0 + pw; x++) g[y * W + x] = 90;
    const r = t.track(g, W, H);
    if (mustTrack) assert.ok(r.ok && r.score >= 0.6, `${pw}x${ph}: not tracked`);
    if (r.ok) assert.ok(Math.hypot(r.dx + 1.6, r.dy - 31.2) < 0.3, `${pw}x${ph}: (${r.dx}, ${r.dy})`);
  }
});

test('run off the frame: no number rather than a wrong one', () => {
  const t = tracker();
  const r = t.track(scene(0, -150), W, H);
  assert.equal(r.ok, false);
});

test('fast enough for sixty frames a second', () => {
  // a 200 x 260 template in a 720 x 1280 frame
  const FW = 720;
  const FH = 1280;
  const big = (dy) => {
    const g = new Float32Array(FW * FH);
    for (let y = 0; y < FH; y++)
      for (let x = 0; x < FW; x++) {
        const Y = y - dy;
        const sd = Math.min(100 - Math.abs(x - 360), Y - 400, 900 - Y);
        const m = 1 / (1 + Math.exp(-sd / 0.45));
        g[y * FW + x] = (1 - m) * (120 + 30 * Math.sin(x / 7.3) * Math.cos(Y / 11.1)) + m * (200 + 10 * Math.sin(x / 5) * Math.cos(Y / 9));
      }
    return g;
  };
  const t = new TemplateTracker({ maxShift: 0.6 });
  t.setReference(big(0), FW, FH, { x0: 260, y0: 380, x1: 460, y1: 640 });
  const frames = [3.3, 17.8, 41.2, 60.1, 22.4].map(big);
  const t0 = performance.now();
  let reps = 0;
  for (let k = 0; k < 4; k++)
    for (const f of frames) {
      t.track(f, FW, FH);
      reps++;
    }
  const ms = (performance.now() - t0) / reps;
  console.log(`  track(): ${ms.toFixed(2)} ms a frame`);
  assert.ok(ms < 8, `${ms.toFixed(2)} ms`);
});

test('toGray uses the Rec. 601 weights', () => {
  const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 10, 20, 30, 255]);
  const g = toGray(rgba, 4, 1);
  assert.ok(Math.abs(g[0] - 76.245) < 1e-3);
  assert.ok(Math.abs(g[1] - 149.685) < 1e-3);
  assert.ok(Math.abs(g[2] - 29.07) < 1e-3);
  assert.ok(Math.abs(g[3] - (0.299 * 10 + 0.587 * 20 + 0.114 * 30)) < 1e-3);
});
