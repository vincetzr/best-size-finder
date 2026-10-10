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
