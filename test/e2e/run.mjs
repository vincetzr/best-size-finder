// End to end: the real page, in a real browser, watching a video of a person
// hopping at a known scale through the browser's fake camera.
//
//   node test/e2e/run.mjs <cutoutdir>     (see cutout.mjs; the video is built once)
//
// Passes if the page's pixels-per-metre is within 2 per cent of the truth and
// the height it reports within 3 cm. What it shows: that the camera clock, the
// tracker on real pixels and the fit work together in a browser. What it does
// not: how a real body behaves in the air.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from './serve.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, '../..');
const cut = path.resolve(process.argv[2] || '');
if (!fs.existsSync(path.join(cut, 'mask.png'))) {
  console.error('usage: node test/e2e/run.mjs <cutoutdir>   (make one with test/e2e/cutout.mjs)');
  process.exit(2);
}
const video = path.join(cut, 'hop.mjpeg');
const truthPath = path.join(cut, 'truth.json');
if (!fs.existsSync(video) || !fs.existsSync(truthPath)) {
  const traj = path.join(cut, 'trajectory.json');
  execFileSync('node', [path.join(here, 'trajectory.mjs'), traj], { stdio: 'inherit' });
  execFileSync('python3', ['-I', path.join(here, 'compose.py'), cut, traj, video, truthPath], { stdio: 'inherit' });
}
const truth = JSON.parse(fs.readFileSync(truthPath, 'utf8'));

const { server, port } = await serve(repo, cut);
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`, '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({ viewport: { width: 540, height: 960 } });
await ctx.grantPermissions(['camera']);
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(m.text()));
page.on('pageerror', (e) => logs.push(`PAGE ERROR ${e.message}`));
await page.goto(`http://127.0.0.1:${port}/scan/index.html`);
await page.click('#start');

let lastCue = '';
const t0 = Date.now();
let state = null;
while (Date.now() - t0 < 150000) {
  state = await page.evaluate(() => {
    const S = window.__scan;
    return {
      stage: S.stage,
      cue: document.getElementById('cueBig').textContent + ' | ' + document.getElementById('cueSmall').textContent,
      scale: S.scale && { pxPerMetre: S.scale.pxPerMetre, rel: S.scale.rel, heightM: S.scale.heightM, hopsUsed: S.scale.hopsUsed, source: S.scale.source },
      fit: S.hopFit && !S.hopFit.ok ? S.hopFit.message : null,
      timing: S.hopTiming,
      samples: S.hop ? S.hop.samples.length : 0,
      W: S.W,
      H: S.H,
    };
  });
  if (state.cue !== lastCue) {
    console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)} s  [${state.stage}] ${state.cue}`);
    lastCue = state.cue;
  }
  if (state.scale) break;
  await new Promise((r) => setTimeout(r, 200));
}
await page.screenshot({ path: path.join(cut, 'last.png') });
await browser.close();
server.close();
for (const l of logs.filter((l) => /error|fail|warn/i.test(l)).slice(0, 20)) console.log('  page:', l);

if (!state || !state.scale) {
  console.log('FAIL: no scale was measured', state);
  process.exit(1);
}
const err = state.scale.pxPerMetre / truth.pxPerMetre - 1;
const hErr = state.scale.heightM !== null ? (state.scale.heightM - truth.statureM) * 100 : NaN;
console.log(`video ${state.W}x${state.H}; ${state.samples} tracked frames; clock ${JSON.stringify(state.timing)}`);
console.log(`scale  ${state.scale.pxPerMetre.toFixed(2)} px/m against ${truth.pxPerMetre.toFixed(2)}: ${(100 * err).toFixed(2)} per cent (claimed ±${(100 * state.scale.rel).toFixed(2)}), ${state.scale.hopsUsed} hops`);
console.log(`height ${state.scale.heightM !== null ? (state.scale.heightM * 100).toFixed(1) : '—'} cm against ${(truth.statureM * 100).toFixed(1)}: ${hErr.toFixed(1)} cm`);
const pass = Math.abs(err) < 0.02 && !(Math.abs(hErr) > 3);
console.log(pass ? 'PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
