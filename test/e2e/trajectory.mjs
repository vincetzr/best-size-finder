// The hop the end-to-end video shows: a loop of standing, six hops, standing,
// three times over (the fake camera plays the file on a loop and the page
// starts timing whenever it is ready). Heights of the centre of mass in metres,
// several times within each frame's exposure so the compositor can blur it.
// Usage: node test/e2e/trajectory.mjs out.json
import fs from 'node:fs';
import { hopTrajectory } from '../../sim/hopper.mjs';

const fps = 30;
const sub = 5;
const exposure = 0.012; // seconds: indoor light
const frames = [];
const flights = [];
let offset = 0;
for (let c = 0; c < 3; c++) {
  const T = hopTrajectory({ seed: 11 + c, hops: 6, standBefore: 5, standAfter: 3, flightTime: 0.26, flightJitter: 0.02 });
  const n = Math.floor(T.end * fps);
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    const ys = [];
    for (let k = 0; k < sub; k++) ys.push(T.at(t + (k / (sub - 1) - 0.5) * exposure));
    frames.push(ys);
  }
  for (const f of T.flights) flights.push({ t0: f.t0 + offset, t1: f.t1 + offset });
  offset += n / fps;
}
fs.writeFileSync(process.argv[2], JSON.stringify({ fps, exposure, frames, flights }));
console.log(`${frames.length} frames, ${(frames.length / fps).toFixed(1)} s, ${flights.length} flights`);
