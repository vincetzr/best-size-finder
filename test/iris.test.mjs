// The iris ruler, on a face drawn from a simple 3D model through a pinhole
// camera: two irises 11.71 mm across, 63 mm apart, a nose 10 cm in front.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IrisRuler, irisDiametersPx, agree, HVID_MM } from '../src/iris.js';

const W = 720;
const H = 1280;
const F = 1100; // px
const IPD = 0.063;
const R = HVID_MM / 2000; // iris radius, metres

function lcg(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** 478 normalised landmarks for a face at distance z (metres), turned by yawDeg. */
function face(z, { yawDeg = 0, noise = 0.3, seed = 1 } = {}) {
  const rnd = lcg(seed);
  const n = () => noise * (rnd() + rnd() + rnd() - 1.5) * 2;
  const yaw = (yawDeg * Math.PI) / 180;
  const rot = ([x, y, zz]) => [x * Math.cos(yaw) + zz * Math.sin(yaw), y, -x * Math.sin(yaw) + zz * Math.cos(yaw)];
  const proj = (p) => {
    const [x, y, zz] = rot(p);
    return { x: (W / 2 + (F * x) / (z + zz) + n()) / W, y: (H / 2 + (F * y) / (z + zz) + n()) / H, z: 0 };
  };
  const L = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  // the person's right eye is on the picture's left (an unmirrored camera)
  for (const [centre, ring, sx] of [
    [468, [469, 470, 471, 472], -1],
    [473, [474, 475, 476, 477], 1],
  ]) {
    const cx = (sx * IPD) / 2;
    L[centre] = proj([cx, 0, 0]);
    // ring: right, top, left, bottom of the iris, in its own plane
    const ringPts = [
      [cx + R, 0, 0],
      [cx, -R, 0],
      [cx - R, 0, 0],
      [cx, R, 0],
    ];
    ring.forEach((i, k) => (L[i] = proj(ringPts[k])));
  }
  L[1] = proj([0, 0.035, -0.1]); // the nose tip, towards the camera
  return L;
}

test('the iris diameter in pixels is the iris diameter', () => {
  const d = irisDiametersPx(face(0.5, { noise: 0 }), W, H);
  const expect = (F * 2 * R) / 0.5;
  assert.ok(Math.abs(d.left - expect) < 0.01 && Math.abs(d.right - expect) < 0.01, `${d.left}, ${d.right} vs ${expect}`);
});

test('close up, the distance between the eyes comes out in millimetres', () => {
  const r = new IrisRuler();
  for (let k = 1; k <= 15; k++) r.addNear(face(0.5, { seed: k }), W, H);
  const got = r.ipdMm();
  assert.ok(got && got.frames === 15);
  assert.ok(Math.abs(got.mm - 63) / 63 < 0.01, `${got.mm} mm`);
  // its uncertainty is dominated by how irises vary between people
  assert.ok(got.rel > 0.035 && got.rel < 0.05, `rel ${got.rel}`);
});

test('across the room, it gives the scale at the trunk', () => {
  const r = new IrisRuler();
  for (let k = 1; k <= 15; k++) r.addNear(face(0.5, { seed: k }), W, H);
  const zFace = 2.4;
  for (let k = 1; k <= 30; k++) r.addFar(face(zFace, { seed: 100 + k }), W, H);
  const s = r.scaleAtTrunk({ focalPx: F });
  const truth = F / (zFace + 0.08); // the trunk's middle plane, 8 cm behind the eyes
  const err = s.pxPerMetre / truth - 1;
  assert.ok(Math.abs(err) < 0.02, `error ${(100 * err).toFixed(2)}%`);
  assert.ok(Math.abs(err) < 2 * s.rel, `error ${(100 * err).toFixed(2)}% against a claimed ${(100 * s.rel).toFixed(2)}%`);
  // a focal length a fifth out moves it by little: the correction is small
  const off = r.scaleAtTrunk({ focalPx: 1.2 * F }).pxPerMetre / s.pxPerMetre - 1;
  assert.ok(Math.abs(off) < 0.01, `${(100 * off).toFixed(2)}%`);
});

test('a turned head is not read', () => {
  const r = new IrisRuler();
  for (let k = 1; k <= 15; k++) assert.equal(r.addNear(face(0.5, { yawDeg: 20, seed: k }), W, H), false);
  assert.equal(r.ipdMm(), null);
  assert.equal(r.addFar(face(2.4, { yawDeg: 20 }), W, H), false);
});

test('too few frames, no answer', () => {
  const r = new IrisRuler();
  for (let k = 1; k <= 3; k++) r.addNear(face(0.5, { seed: k }), W, H);
  assert.equal(r.ipdMm(), null);
  assert.equal(r.scaleAtTrunk({ focalPx: F }), null);
});

test('the two rulers: agreeing, and ten per cent apart', () => {
  const g = { pxPerMetre: 400, rel: 0.01 };
  assert.equal(agree(g, { pxPerMetre: 408, rel: 0.04 }).verdict, 'agree');
  const off = agree(g, { pxPerMetre: 460, rel: 0.04 });
  assert.equal(off.verdict, 'disagree');
  assert.ok(off.z > 3);
  assert.equal(agree(g, null), null);
});
