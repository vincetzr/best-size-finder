// BEST's chart and the chest models, as ported from the August page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHART, ramanujan, girthFromWidthDepth, chestError, rankSizes, verdict, normalCdf } from '../src/sizing.js';

test('the chart is BEST’s, row for row', () => {
  const rows = CHART.map((c) => [c.name, c.chestCm, c.lengthCm]);
  assert.deepEqual(rows, [
    ['3X Small', 92, 74],
    ['2X Small', 96, 76],
    ['X Small', 100, 78],
    ['Small', 104, 80],
    ['Medium', 108, 82],
    ['Large', 112, 84],
    ['X Large', 120, 86],
    ['2X Large', 128, 87],
    ['3X Large', 136, 87],
    ['4X Large', 144, 88],
    ['5X Large', 152, 88],
    ['6X Large', 160, 89],
    ['7X Large', 168, 90],
  ]);
  assert.equal(CHART[5].chestInches, '44"');
});

test('Ramanujan: a circle exactly, and an ellipse to a part in a million', () => {
  assert.ok(Math.abs(ramanujan(10, 10) - 2 * Math.PI * 10) < 1e-9);
  // a = 20, b = 10: perimeter 96.88448220 (elliptic integral)
  assert.ok(Math.abs(ramanujan(20, 10) - 96.8844822) < 1e-4);
});

test('chest from width and depth: the fitted line inside its box, the ellipse outside', () => {
  const a = girthFromWidthDepth(34, 25);
  assert.equal(a.method, 'regression');
  assert.ok(Math.abs(a.chestCm - (1.418 * 34 + 1.015 * 25 + 33.52)) < 1e-9);
  const b = girthFromWidthDepth(64, 30);
  assert.equal(b.method, 'ellipse');
  assert.ok(Math.abs(b.chestCm - ramanujan(32, 15) * 1.177) < 1e-9);
  // the two models do not meet at the edge of the box (kept as it was)
  const inside = girthFromWidthDepth(40, 30).chestCm;
  const ellipse = ramanujan(20, 15) * 1.177;
  console.log(`  at (40, 30): line ${inside.toFixed(1)} cm, ellipse ${ellipse.toFixed(1)} cm`);
  assert.ok(Math.abs(inside - ellipse) > 5);
});

test('the chest’s error: shape and scale together, never under 4 cm', () => {
  assert.equal(chestError({ chestCm: 90, scaleRel: 0.01 }), 4);
  assert.ok(Math.abs(chestError({ chestCm: 120, scaleRel: 0.01 }) - 120 * Math.hypot(0.04, 0.01)) < 1e-9);
  assert.ok(chestError({ chestCm: 110, scaleRel: 0.05 }) > chestError({ chestCm: 110, scaleRel: 0.01 }));
});

test('the normal CDF to the accuracy the ranking needs', () => {
  for (const [z, p] of [
    [0, 0.5],
    [1, 0.841345],
    [-1.96, 0.024998],
    [2.5, 0.99379],
  ])
    assert.ok(Math.abs(normalCdf(z) - p) < 2e-6, `z=${z}`);
});

test('chances add up to one and peak in the right size', () => {
  const r = rankSizes(110, 3);
  const sum = r.reduce((a, x) => a + x.p, 0);
  assert.ok(Math.abs(sum - 1) < 1e-6);
  assert.equal(r[0].name, 'Large'); // 108 < 110 ≤ 112
  assert.equal(rankSizes(104, 0.3)[0].name, 'Small'); // on a chart figure: that size, no ease
});

test('below the smallest and above the largest', () => {
  assert.equal(rankSizes(80, 3)[0].name, '3X Small');
  assert.equal(rankSizes(180, 3)[0].name, '7X Large');
  const v = verdict(180, 4);
  assert.equal(v.over, true);
  assert.equal(v.offChart, true);
  assert.equal(v.largerIsSafer, false, 'there is no larger size to order');
});

test('the verdict: room, and a coin toss only when the two sizes are close', () => {
  const v = verdict(106, 4.2);
  assert.equal(v.best.name, 'Medium');
  assert.ok(Math.abs(v.roomCm - 2) < 1e-9);
  assert.equal(v.over, false);
  const close = verdict(108.2, 4.3);
  assert.equal(close.coinToss, true);
  const clear = verdict(116, 4.6); // the middle of the wide X Large step
  assert.equal(clear.best.name, 'X Large');
  assert.equal(clear.coinToss, false);
});

// ——— the quarter turn ———
import { chestFromTurn, fuseChests } from '../src/sizing.js';

/** Width of a superellipse |x/a|^n + |y/b|^n = 1 seen at angle θ, and its perimeter, numerically. */
function superellipse(a, b, n) {
  const pts = [];
  for (let k = 0; k < 4000; k++) {
    const t = (2 * Math.PI * k) / 4000;
    const c = Math.cos(t);
    const s = Math.sin(t);
    pts.push([a * Math.sign(c) * Math.abs(c) ** (2 / n), b * Math.sign(s) * Math.abs(s) ** (2 / n)]);
  }
  let P = 0;
  for (let k = 0; k < pts.length; k++) {
    const [x0, y0] = pts[k];
    const [x1, y1] = pts[(k + 1) % pts.length];
    P += Math.hypot(x1 - x0, y1 - y0);
  }
  const width = (th) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const [x, y] of pts) {
      const p = x * Math.cos(th) + y * Math.sin(th);
      lo = Math.min(lo, p);
      hi = Math.max(hi, p);
    }
    return hi - lo;
  };
  return { P, width };
}

test('the turn arrives at the tape: an ellipse and a squarer chest', () => {
  for (const n of [2, 2.8]) {
    const { P, width } = superellipse(17, 12.5, n);
    const samples = [];
    // a customer who turns slowly at the start and the end, quickly in the middle
    for (let k = 0; k <= 60; k++) {
      const u = k / 60;
      const angle = ((1 - Math.cos(Math.PI * u)) / 2) * (Math.PI / 2);
      samples.push({ angle, widthCm: width(angle) });
    }
    const r = chestFromTurn(samples);
    assert.ok(r.ok, r.reason);
    assert.ok(Math.abs(r.chestCm / P - 1) < 0.01, `n=${n}: ${r.chestCm.toFixed(2)} against ${P.toFixed(2)}`);
  }
});

test('angles read roughly still arrive near the tape', () => {
  // the page reads each angle from the shoulders' apparent span, which is
  // worst near facing and near side on — where the width hardly changes
  const { P, width } = superellipse(17, 12.5, 2.8);
  let s = 5;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647 - 0.5;
  const samples = [];
  for (let k = 0; k <= 80; k++) {
    const angle = (k / 80) * (Math.PI / 2);
    const seen = Math.acos(Math.min(1, Math.max(0, Math.cos(angle) + 0.06 * rnd())));
    samples.push({ angle: seen, widthCm: width(angle) + 0.3 * rnd() });
  }
  const r = chestFromTurn(samples);
  assert.ok(r.ok, r.reason);
  assert.ok(Math.abs(r.chestCm / P - 1) < 0.02, `${r.chestCm.toFixed(2)} against ${P.toFixed(2)}`);
});

test('a turn half seen, or rushed through the middle, is refused', () => {
  const { width } = superellipse(17, 12.5, 2.8);
  const half = [];
  for (let k = 0; k <= 30; k++) half.push({ angle: (k / 60) * (Math.PI / 2), widthCm: width((k / 60) * (Math.PI / 2)) });
  assert.equal(chestFromTurn(half).ok, false);
  const rushed = [];
  for (const deg of [0, 3, 6, 9, 12, 15, 18, 21, 75, 78, 81, 84, 87, 89]) rushed.push({ angle: (deg * Math.PI) / 180, widthCm: width((deg * Math.PI) / 180) });
  assert.equal(chestFromTurn(rushed).ok, false);
});

test('two readings of one chest: weighted when they agree, flagged when not', () => {
  const f = fuseChests({ chestCm: 100, errCm: 2 }, { chestCm: 104, errCm: 4 });
  assert.equal(f.agree, true);
  assert.ok(Math.abs(f.chestCm - 100.8) < 1e-9);
  assert.ok(f.errCm < 2);
  const g = fuseChests({ chestCm: 100, errCm: 2 }, { chestCm: 120, errCm: 4 });
  assert.equal(g.agree, false);
  assert.equal(g.chestCm, 110);
  assert.ok(g.errCm >= 10);
});
