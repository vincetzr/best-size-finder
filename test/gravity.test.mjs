// The gravity ruler against the simulated hopper (sim/hopper.mjs).
//
// These say what the arithmetic does on a body that is rigid in the air, under
// each of the ways a real recording differs from the ideal. They do not say
// what it does on people: that needs people, and a tape (see FIELD.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../sim/hopper.mjs';
import { fitGravity, G } from '../src/gravity.js';
import { regulariseTimes } from '../src/timing.js';

function run(params, seeds = 60) {
  const errs = [];
  const claimed = [];
  let refused = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const { samples, truth } = simulate({ seed, ...params });
    const rt = regulariseTimes(samples.map((s) => s.t));
    const r = fitGravity(samples.map((s, i) => ({ ...s, t: rt.times[i] })));
    if (!r.ok) {
      refused++;
      continue;
    }
    const s = (r.accel.mag / G);
    errs.push(s / truth.pxPerMetreHops - 1);
    claimed.push(r.accel.rel);
  }
  const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
  const sd = Math.sqrt(errs.reduce((a, b) => a + (b - mean) ** 2, 0) / errs.length);
  const maxAbs = Math.max(...errs.map(Math.abs));
  const claimedMean = claimed.reduce((a, b) => a + b, 0) / claimed.length;
  return { mean, sd, maxAbs, claimedMean, refused, n: errs.length };
}

test('exact on noiseless free fall', () => {
  const { samples, truth } = simulate({ noisePx: 1e-6 });
  const r = fitGravity(samples);
  assert.ok(r.ok, r.message);
  const s = (r.accel.mag / G);
  assert.ok(Math.abs(s / truth.pxPerMetre - 1) < 0.002, `error ${(100 * (s / truth.pxPerMetre - 1)).toFixed(3)}%`);
  assert.equal(r.hopsUsed, 5);
});

test('nominal: unbiased to a fraction of a per cent, scatter under one per cent', () => {
  const m = run({});
  assert.equal(m.refused, 0);
  assert.ok(Math.abs(m.mean) < 0.004, `bias ${(100 * m.mean).toFixed(2)}%`);
  assert.ok(m.sd < 0.01, `sd ${(100 * m.sd).toFixed(2)}%`);
  assert.ok(m.maxAbs < 0.03, `worst ${(100 * m.maxAbs).toFixed(2)}%`);
});

test('the error bar it claims is the error it makes', () => {
  // the uncertainty is shown to the customer, so it has to be honest: within
  // a factor of 1.5 either way of the scatter actually seen
  for (const p of [{}, { noisePx: 1 }, { fps: 60 }, { flightTime: 0.2 }]) {
    const m = run(p);
    const ratio = m.claimedMean / m.sd;
    assert.ok(ratio > 0.66 && ratio < 1.5, `${JSON.stringify(p)}: claimed ${(100 * m.claimedMean).toFixed(2)}% vs seen ${(100 * m.sd).toFixed(2)}%`);
  }
});

test('ground contact does not creep in and hold the arcs up', () => {
  // contact can only hold the body up, so leaking it in always reads short;
  // a noisier tracker makes the one-sided test more permissive
  const m = run({ noisePx: 1 });
  assert.ok(Math.abs(m.mean) < 0.006, `bias ${(100 * m.mean).toFixed(2)}%`);
});

test('a rolled camera: the magnitude is unchanged and the roll is read off', () => {
  const { samples, truth } = simulate({ rollDeg: 8 });
  const r = fitGravity(samples);
  assert.ok(r.ok);
  assert.ok(Math.abs((r.accel.mag / G) / truth.pxPerMetre - 1) < 0.03);
  assert.ok(Math.abs(Math.abs(r.rollDeg) - 8) < 1.5, `roll ${r.rollDeg}`);
});

test('tracking slips are stepped over, not fitted', () => {
  const m = run({ outlierRate: 0.03, outlierPx: 12 });
  assert.ok(m.refused <= 3, `refused ${m.refused}`);
  assert.ok(Math.abs(m.mean) < 0.005, `bias ${(100 * m.mean).toFixed(2)}%`);
  assert.ok(m.maxAbs < 0.04, `worst ${(100 * m.maxAbs).toFixed(2)}%`);
});

test('lost frames and jittery stamps', () => {
  const m = run({ dropRate: 0.1, timeJitterMs: 3 });
  assert.ok(m.refused <= 6, `refused ${m.refused}`);
  assert.ok(m.sd < 0.012, `sd ${(100 * m.sd).toFixed(2)}%`);
});

test('rolling shutter and motion blur', () => {
  const m = run({ readoutMs: 30, exposureMs: 25 });
  assert.ok(Math.abs(m.mean) < 0.005, `bias ${(100 * m.mean).toFixed(2)}%`);
});

test('standing still gives no answer rather than a wrong one', () => {
  const { samples } = simulate({ hops: 0 });
  const r = fitGravity(samples);
  assert.equal(r.ok, false);
});

test('one hop is not enough to check itself', () => {
  const { samples } = simulate({ hops: 1 });
  const r = fitGravity(samples);
  assert.equal(r.ok, false);
});

test('noise with no hop in it is refused', () => {
  const samples = [];
  let s = 1;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 6;
  for (let i = 0; i < 150; i++) samples.push({ t: i / 30, u: 360 + rnd(), v: 500 + rnd() });
  assert.equal(fitGravity(samples).ok, false);
});

test('sixty frames a second scatters about a third less than thirty', () => {
  const a = run({ fps: 30 });
  const b = run({ fps: 60 });
  assert.ok(b.sd < 0.75 * a.sd, `30fps ${(100 * a.sd).toFixed(2)}%, 60fps ${(100 * b.sd).toFixed(2)}%`);
});
