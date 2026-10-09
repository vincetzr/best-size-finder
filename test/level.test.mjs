// Rectification and the accelerometer, against the simulated camera.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../sim/hopper.mjs';
import { gravityScale } from '../src/gravity.js';
import { makeRectifier, attitudeFromGravity, cameraBasis, detectSign, Level } from '../src/level.js';

const deg = (d) => (d * Math.PI) / 180;

test('the attitude read back from a synthetic accelerometer is the one it was made from', () => {
  for (const [p, r] of [[10, 0], [0, 8], [-7, 5], [20, -12], [3, 30]]) {
    const B = cameraBasis(deg(p), deg(r));
    // by the specification, at rest the reading is "up", in device axes;
    // device x is the camera's left for a front camera, y its up, z its line of sight
    const a = { x: -9.81 * B.right[1], y: 9.81 * B.up[1], z: 9.81 * B.fw[1] };
    const att = attitudeFromGravity(a, 0, detectSign(a, 0));
    assert.ok(Math.abs(att.pitchRad - deg(p)) < 1e-9, `pitch ${p}`);
    assert.ok(Math.abs(att.rollRad - deg(r)) < 1e-9, `roll ${r}`);
  }
});

test('a platform that reports gravity the other way round is recognised', () => {
  const B = cameraBasis(deg(6), deg(-4));
  const a = { x: 9.81 * B.right[1], y: -9.81 * B.up[1], z: -9.81 * B.fw[1] };
  const sign = detectSign(a, 0);
  assert.equal(sign, -1);
  const att = attitudeFromGravity(a, 0, sign);
  assert.ok(Math.abs(att.pitchRad - deg(6)) < 1e-9);
});

test('landscape: the interface turned a quarter round', () => {
  // the same camera attitude, with the device on its side and the interface
  // turned 90° to match: the reading moves to the device x axis
  const B = cameraBasis(deg(4), deg(2));
  const up = [-9.81 * B.right[1], 9.81 * B.up[1]]; // in interface axes
  const th = deg(90);
  // interface = rot(th) · device  ⇒  device = rot(−th) · interface
  const a = {
    x: up[0] * Math.cos(th) + up[1] * Math.sin(th),
    y: -up[0] * Math.sin(th) + up[1] * Math.cos(th),
    z: 9.81 * B.fw[1],
  };
  const att = attitudeFromGravity(a, 90, detectSign(a, 90));
  assert.ok(Math.abs(att.pitchRad - deg(4)) < 1e-9, `pitch ${(att.pitchRad * 180) / Math.PI}`);
  assert.ok(Math.abs(att.rollRad - deg(2)) < 1e-9, `roll ${(att.rollRad * 180) / Math.PI}`);
});

test('Level averages a still device and notices a handled one', () => {
  const L = new Level({ window: 20 });
  for (let i = 0; i < 20; i++) L.push({ x: 0.01 * Math.sin(i), y: 9.8, z: 0.4 }, 0);
  const r = L.read();
  assert.ok(r.still);
  assert.ok(Math.abs((r.pitchRad * 180) / Math.PI + 2.34) < 0.1, `pitch ${(r.pitchRad * 180) / Math.PI}`);
  for (let i = 0; i < 20; i++) L.push({ x: 2 * Math.sin(i), y: 9.8, z: 0.4 }, 0);
  assert.equal(L.read().still, false);
});

function widthError(params, fk, useAttitude = true) {
  const errs = [];
  for (let seed = 1; seed <= 30; seed++) {
    const { samples, truth } = simulate({ seed, ...params });
    const camera = { focalPx: truth.f * fk, cx: truth.cx, cy: truth.cy };
    const attitude = useAttitude ? { pitchRad: deg(params.pitchDeg || 0), rollRad: deg(params.rollDeg || 0) } : null;
    const g = gravityScale(samples, { attitude, camera, rectifierFactory: makeRectifier });
    if (!g.ok) continue;
    const L = truth.projectFromTrunk(-0.2, 0);
    const R = truth.projectFromTrunk(0.2, 0);
    const l = g.rectify(L.u, L.v);
    const r = g.rectify(R.u, R.v);
    errs.push(Math.hypot(r.u - l.u, r.v - l.v) / g.pxPerMetre / 0.4 - 1);
  }
  return errs.reduce((a, b) => a + b, 0) / errs.length;
}

test('a 40 cm chest measures 40 cm through a level camera', () => {
  assert.ok(Math.abs(widthError({}, 1)) < 0.003);
});

test('and through a tilted one, once the picture is rectified', () => {
  for (const p of [{ pitchDeg: 15 }, { pitchDeg: 20, rollDeg: 8 }, { pitchDeg: -10, rollDeg: -6 }]) {
    const e = widthError(p, 1);
    assert.ok(Math.abs(e) < 0.003, `${JSON.stringify(p)}: ${(100 * e).toFixed(2)}%`);
  }
});

test('a focal length a fifth out costs little when the camera is near upright', () => {
  for (const fk of [0.8, 1.2]) {
    const e = widthError({ pitchDeg: 5, rollDeg: 3 }, fk);
    assert.ok(Math.abs(e) < 0.006, `f×${fk}: ${(100 * e).toFixed(2)}%`);
  }
});

test('with no accelerometer: roll is read off the fall, pitch assumed small', () => {
  // without the device's own level the off-centre part of a pitched fall is
  // not removed; the error bar claimed on this path says so (one per cent)
  assert.ok(Math.abs(widthError({ rollDeg: 8 }, 1, false)) < 0.004);
  const e = widthError({ rollDeg: 8, pitchDeg: 3 }, 1, false);
  assert.ok(Math.abs(e) < 0.012, `${(100 * e).toFixed(2)}%`);
});
