// The frame clock: putting stamps back on the camera's grid, and not
// inventing a grid that was never there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regulariseTimes, fitFrameGrid, gridFromFrameNumbers, frameTime } from '../src/timing.js';

function lcg(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** A 30 fps camera, frames delivered irregularly (a busy page), stamps with jitter. */
function delivered({ n = 300, keep = 0.5, jitterMs = 0, seed = 3 } = {}) {
  const rnd = lcg(seed);
  const t = [];
  const frames = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    k += rnd() < keep ? 1 : rnd() < 0.6 ? 2 : 3;
    const j = (jitterMs / 1000) * (rnd() + rnd() + rnd() - 1.5) * 2; // roughly normal, SD ≈ jitterMs
    t.push(k / 30 + j);
    frames.push(k);
  }
  return { t, frames };
}

test('the right clock is chosen from the frame callback', () => {
  assert.deepEqual(frameTime(1000, { captureTime: 990, mediaTime: 5 }), { t: 0.99, source: 'capture' });
  assert.deepEqual(frameTime(1000, { mediaTime: 5 }), { t: 5, source: 'media' });
  assert.deepEqual(frameTime(1000, {}), { t: 1, source: 'callback' });
});

test('a page losing every other frame still finds the camera’s own period', () => {
  // the August-style failure: the typical gap is two frames, and a grid found
  // round it is one the camera never had
  const { t } = delivered({ keep: 0.5 });
  const g = fitFrameGrid(t);
  assert.ok(Math.abs(g.period * 1000 - 33.333) < 0.05, `period ${g.period * 1000}`);
});

test('accurate stamps are left alone', () => {
  const { t } = delivered({ jitterMs: 0.05 });
  const r = regulariseTimes(t);
  assert.equal(r.regular, false);
  assert.deepEqual(r.times, t);
});

test('jittery stamps are put back on the grid, frames lost or not', () => {
  for (const keep of [1, 0.7, 0.4]) {
    const { t, frames } = delivered({ keep, jitterMs: 3 });
    const r = regulariseTimes(t);
    assert.equal(r.regular, true, `keep ${keep}`);
    // relative to the first frame, every snapped time is a whole number of frames
    for (let i = 0; i < t.length; i++) {
      const err = r.times[i] - r.times[0] - (frames[i] - frames[0]) / 30;
      assert.ok(Math.abs(err) < 0.002, `keep ${keep}, frame ${i}: ${err}`);
    }
  }
});

test('the browser’s frame count gives the grid with nothing guessed', () => {
  const { t, frames } = delivered({ keep: 0.3, jitterMs: 6 });
  const g = gridFromFrameNumbers(t, frames);
  assert.ok(g && Math.abs(g.period * 1000 - 33.333) < 0.2, `period ${g && g.period * 1000}`);
  const r = regulariseTimes(t, frames);
  assert.equal(r.regular, true);
  // snapped times are exactly a whole number of periods apart, and the period
  // is the camera's to a part in two thousand: a time scale that far out moves
  // an acceleration by a tenth of a per cent
  assert.ok(Math.abs(r.periodMs / 33.3333 - 1) < 5e-4, `period ${r.periodMs}`);
  const P = r.periodMs / 1000;
  for (let i = 0; i < t.length; i++) assert.ok(Math.abs(r.times[i] - r.times[0] - (frames[i] - frames[0]) * P) < 1e-9);
});

test('a frame count that does not rise, or does not match the clock, is not used', () => {
  const { t, frames } = delivered({ jitterMs: 1 });
  const stuck = frames.map((f, i) => (i === 50 ? frames[49] : f));
  assert.equal(gridFromFrameNumbers(t, stuck), null);
  const doubled = frames.map((f, i) => f + (i > 150 ? 40 : 0)); // a jump the clock did not see
  assert.equal(gridFromFrameNumbers(t, doubled), null);
});

test('a camera that changes its frame rate keeps its real stamps', () => {
  // thirty frames a second, then twenty-four in a dim room: no single grid fits
  const t = [];
  for (let i = 0; i < 150; i++) t.push(i / 30);
  for (let i = 1; i <= 150; i++) t.push(5 + i / 24 + 0.002 * Math.sin(i));
  const r = regulariseTimes(t);
  assert.equal(r.regular, false);
});

test('snapping never puts two frames in one slot', () => {
  for (let seed = 1; seed < 40; seed++) {
    const { t } = delivered({ keep: 0.6, jitterMs: 7, seed });
    const r = regulariseTimes(t);
    for (let i = 1; i < r.times.length; i++) assert.ok(r.times[i] !== r.times[i - 1], `seed ${seed}`);
  }
});

test('a long recording with 5 ms of jitter still snaps, a stray pair kept as it was', () => {
  // a thousand frames: at 5 ms an occasional pair of stamps lands in one slot;
  // that must cost those two frames their snapping, not every frame its
  let snappedRuns = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const { t, frames } = delivered({ n: 1000, keep: 0.85, jitterMs: 5, seed });
    const r = regulariseTimes(t);
    if (!r.regular) continue;
    snappedRuns++;
    let worst = 0;
    for (let i = 0; i < t.length; i++) {
      const err = Math.abs(r.times[i] - r.times[0] - (frames[i] - frames[0]) / 30);
      worst = Math.max(worst, err);
    }
    assert.ok(worst < 0.02, `seed ${seed}: ${worst}`); // at most a raw stamp's own jitter, never a frame
  }
  assert.ok(snappedRuns >= 19, `${snappedRuns} of 20 snapped`);
});

// ——— a frame stamped with another frame's time ———
import { StampCheck } from '../src/timing.js';

/**
 * Safari at 60 frames a second, as WebKit delivers them: camera frames land
 * in a queue off the main thread; when the page is free at a screen refresh
 * it is handed the newest pixels — with the OLDEST waiting frame's stamp.
 * Every few frames the page runs the pose model, 14–22 ms. Returns each
 * callback's { now, t, stale } with stale the truth.
 */
function safari(seed, { P = 1 / 59.94, V = 1 / 60, poseMs = [14, 22], work = 0.006, n = 600 } = {}) {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const frames = Array.from({ length: n }, (_, k) => ({ k, t: 1 + k * P + 0.0003 * (rnd() - 0.5), arrive: 0 }));
  for (const f of frames) f.arrive = f.t + 0.004 + 0.002 * rnd();
  const out = [];
  let free = 0;
  let next = 0; // first frame not yet handed over
  let calls = 0;
  for (let m = 0; next < n; m++) {
    const vs = m * V;
    if (vs < free) continue;
    let j = next;
    while (j < n && frames[j].arrive <= vs) j++;
    if (j === next) continue; // nothing new
    const oldest = frames[next];
    const newest = frames[j - 1];
    out.push({ now: vs + 0.0005 * rnd(), t: oldest.t, stale: newest.k !== oldest.k });
    next = j;
    calls++;
    const busy = work + (calls % 3 === 0 ? (poseMs[0] + (poseMs[1] - poseMs[0]) * rnd()) / 1000 : 0);
    free = vs + busy;
  }
  return out;
}

test('a frame stamped with an older frame\'s time is caught, and most good frames are kept', () => {
  let stale = 0;
  let caught = 0;
  let good = 0;
  let kept = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const check = new StampCheck();
    for (const c of safari(seed)) {
      const flagged = check.stale(c.now, c.t);
      if (c.stale) {
        stale++;
        if (flagged) caught++;
      } else {
        good++;
        if (!flagged) kept++;
      }
    }
  }
  assert.ok(stale > 100, `the model coalesces (${stale})`);
  assert.ok(caught / stale > 0.97, `caught ${caught} of ${stale}`);
  assert.ok(kept / good > 0.6, `kept ${kept} of ${good} good frames`);
});

test('an idle page at thirty frames a second loses no frames to the check', () => {
  const check = new StampCheck();
  let flagged = 0;
  const calls = safari(3, { P: 1 / 30, poseMs: [0, 0], work: 0.004, n: 300 });
  for (const c of calls) if (check.stale(c.now, c.t)) flagged++;
  assert.equal(calls.filter((c) => c.stale).length, 0);
  assert.equal(flagged, 0);
});
