// The gravity ruler, case by case, on the simulated hopper: what each way a
// real recording differs from the ideal costs, in per cent of the scale.
//
//   node sim/montecarlo.mjs [runs]      (default 200 runs a case)
//
// Prints a Markdown table: bias (mean error), scatter (SD), the 95th
// percentile of the error's size, the uncertainty the fit claimed (mean), and
// how many runs it refused to answer — a refusal is the page asking for the
// hops again, not a wrong number.
import { simulate } from './hopper.mjs';
import { fitGravity, G } from '../src/gravity.js';
import { regulariseTimes } from '../src/timing.js';

const runs = Number(process.argv[2] || 200);
const CASES = [
  ['ideal: no noise at all', { noisePx: 1e-4 }],
  ['nominal: 30 fps, 0.4 px tracker noise', {}],
  ['60 fps', { fps: 60 }],
  ['tracker noise 1 px', { noisePx: 1 }],
  ['short hops (0.20 s in the air)', { flightTime: 0.2 }],
  ['camera rolled 8°', { rollDeg: 8 }],
  ['rolling shutter, 30 ms readout down the rows', { readoutMs: 30, readoutAxis: 'v' }],
  ['motion blur, 25 ms exposure', { exposureMs: 25 }],
  ['timestamps jittered 2 ms', { timeJitterMs: 2 }],
  ['timestamps jittered 5 ms', { timeJitterMs: 5 }],
  ['one frame in ten lost', { dropRate: 0.1 }],
  ['tracking slips: 3% of frames 12 px off', { outlierRate: 0.03, outlierPx: 12 }],
  ['drifting towards the camera 5 cm/s', { driftZ: -0.05 }],
  ['trunk wobble on landing, 3 mm', { headBobMm: 3 }],
  ['NOT RIGID: trunk sinks 5 mm late in flight', { tuckMm: 5 }],
  ['NOT RIGID: trunk sinks 10 mm late in flight', { tuckMm: 10 }],
  ['NOT RIGID: trunk dips 5 mm mid-flight', { tuckMm: 5, tuckShape: 'sym' }],
];

const pct = (x) => `${(100 * x).toFixed(2)}`;
console.log(`| case | bias % | scatter % | 95th pct of error % | claimed % | refused |`);
console.log(`|---|---:|---:|---:|---:|---:|`);
for (const [name, c] of CASES) {
  const errs = [];
  const claimed = [];
  let refused = 0;
  for (let seed = 1; seed <= runs; seed++) {
    const { samples, truth } = simulate({ seed, ...c });
    const rt = regulariseTimes(samples.map((s) => s.t));
    const r = fitGravity(samples.map((s, i) => ({ ...s, t: rt.times[i] })));
    if (!r.ok) {
      refused++;
      continue;
    }
    errs.push(r.accel.mag / G / truth.pxPerMetreHops - 1);
    claimed.push(r.accel.rel);
  }
  const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
  const sd = Math.sqrt(errs.reduce((a, b) => a + (b - mean) ** 2, 0) / errs.length);
  const p95 = errs.map(Math.abs).sort((a, b) => a - b)[Math.floor(0.95 * (errs.length - 1))];
  const cl = claimed.reduce((a, b) => a + b, 0) / claimed.length;
  console.log(`| ${name} | ${pct(mean)} | ${pct(sd)} | ${pct(p95)} | ${pct(cl)} | ${refused}/${runs} |`);
}
