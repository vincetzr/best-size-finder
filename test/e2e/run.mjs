// End to end: the real page, in a real browser, watching a video of a person
// hopping at a known scale through the browser's fake camera.
//
//   node test/e2e/run.mjs <cutoutdir>     (see cutout.mjs; the video is built once)
//
// Passes if the page's pixels-per-metre is within 2 per cent of the truth, the
// height it reports within 3 cm, and — for the two pictures, drawn by
// pictures.js at the true scale with a known chest — the width, depth, girth and
// size it then reads are the ones that scale implies. What it shows: that the camera clock, the
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
// the two pictures, which the photograph cannot pose for (pictures.js)
const PICTURE = { widthM: 0.34, depthM: 0.25, nearer: 1.03, n: 3 };
await ctx.addInitScript(`window.__scanTruth = ${JSON.stringify({ ...PICTURE, pxPerMetre: truth.pxPerMetre })};`);
await ctx.addInitScript({ path: path.join(here, 'pictures.js') });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(m.text()));
page.on('pageerror', (e) => logs.push(`PAGE ERROR ${e.message}`));
await page.goto(`http://127.0.0.1:${port}/scan/index.html`);
await page.click('#start');

let lastCue = '';
const t0 = Date.now();
let state = null;
let scaleAt = null;
while (Date.now() - t0 < 300000) {
  state = await page.evaluate(() => {
    const S = window.__scan;
    return {
      stage: S.stage,
      cue: document.getElementById('cueBig').textContent + ' | ' + document.getElementById('cueSmall').textContent,
      scale: S.scale && { pxPerMetre: S.scale.pxPerMetre, rel: S.scale.rel, heightM: S.scale.heightM, hopsUsed: S.scale.hopsUsed, source: S.scale.source },
      fit: S.hopFit && !S.hopFit.ok ? S.hopFit.message : null,
      timing: S.hopTiming,
      samples: S.hop ? S.hop.samples.length : 0,
      result: S.result && !S.result.failed && { chestCm: S.result.chestCm, errCm: S.result.errCm, widthCm: S.result.widthCm, depthCm: S.result.depthCm, size: S.result.verdict.best.name, method: S.result.method, turnCm: S.result.turnCm, twoViewCm: S.result.twoViewCm, turnWhyNot: S.result.turnWhyNot, turnSamples: (S.turnSamples || []).length },
      perimeterM: window.__scanTruth && window.__scanTruth.perimeterM,
      failed: S.result && S.result.failed,
      answer: document.getElementById('answer').hidden ? '' : document.getElementById('answer').innerText.slice(0, 400),
      W: S.W,
      H: S.H,
    };
  });
  if (state.cue !== lastCue) {
    console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)} s  [${state.stage}] ${state.cue}`);
    lastCue = state.cue;
  }
  if (state.scale && !scaleAt) scaleAt = { ...state };
  if (state.result || /failed/.test(state.stage)) break;
  await new Promise((r) => setTimeout(r, 200));
}
await page.screenshot({ path: path.join(cut, 'last.png') });
fs.writeFileSync(path.join(cut, 'hop.json'), JSON.stringify(await page.evaluate(() => { const S = window.__scan; return S.hop ? { samples: S.hop.samples.map((q) => ({ t: q.t, u: q.u, v: q.v, presented: q.presented })), arcs: S.scale && S.scale.fit ? S.scale.fit.arcs : null, hopsSeen: S.scale && S.scale.fit ? S.scale.fit.hopsSeen : null, dropped: S.scale ? S.scale.hopsDropped : null } : null; })));
fs.writeFileSync(path.join(cut, 'turn.json'), JSON.stringify(await page.evaluate(() => ({ turn: window.__scan.turnSamples, side: window.__scan.side, front: window.__scan.front })), null, 0));
await browser.close();
server.close();
for (const l of logs.filter((l) => /error|fail|warn/i.test(l)).slice(0, 20)) console.log('  page:', l);

if (!state || !state.scale) {
  console.log('FAIL: no scale was measured', state);
  process.exit(1);
}
const err = state.scale.pxPerMetre / truth.pxPerMetre - 1;
// the pictures: what the page should read, given the scale it measured
const k = truth.pxPerMetre / state.scale.pxPerMetre;
const wantW = 100 * PICTURE.widthM * k;
const wantD = 100 * PICTURE.depthM * k;
const wantChest = 1.418 * wantW + 1.015 * wantD + 33.52;
const hErr = state.scale.heightM !== null ? (state.scale.heightM - truth.statureM) * 100 : NaN;
console.log(`video ${state.W}x${state.H}; ${state.samples} tracked frames; clock ${JSON.stringify(state.timing)}`);
console.log(`scale  ${state.scale.pxPerMetre.toFixed(2)} px/m against ${truth.pxPerMetre.toFixed(2)}: ${(100 * err).toFixed(2)} per cent (claimed ±${(100 * state.scale.rel).toFixed(2)}), ${state.scale.hopsUsed} hops`);
console.log(`height ${state.scale.heightM !== null ? (state.scale.heightM * 100).toFixed(1) : '—'} cm against ${(truth.statureM * 100).toFixed(1)}: ${hErr.toFixed(1)} cm`);
let picturesOk = false;
if (state.result) {
  const r = state.result;
  console.log(`width  ${r.widthCm.toFixed(2)} cm against ${wantW.toFixed(2)}; depth ${r.depthCm.toFixed(2)} against ${wantD.toFixed(2)}`);
  console.log(`chest  ${r.chestCm.toFixed(1)} ± ${r.errCm.toFixed(1)} cm (${r.method}); size ${r.size}`);
  console.log(`answer: ${state.answer.replace(/\s+/g, ' ').slice(0, 300)}`);
  const wantTurn = 100 * state.perimeterM * k;
  console.log(`turn   ${r.turnCm ? r.turnCm.toFixed(1) : '—'} cm from ${r.turnSamples} frames against a perimeter of ${wantTurn.toFixed(1)}${r.turnWhyNot ? ` (${r.turnWhyNot})` : ''}; two-view ${r.twoViewCm.toFixed(1)} against ${wantChest.toFixed(1)}`);
  picturesOk =
    Math.abs(r.widthCm - wantW) < 0.3 &&
    Math.abs(r.depthCm - wantD) < 0.3 &&
    Math.abs(r.twoViewCm - wantChest) < 0.6 &&
    r.turnCm !== null &&
    Math.abs(r.turnCm / wantTurn - 1) < 0.02 &&
    state.answer.includes(r.size);
} else console.log(`pictures: no result (${state.stage}: ${state.cue}${state.failed ? `; ${state.failed}` : ''})`);
const pass = Math.abs(err) < 0.02 && !(Math.abs(hErr) > 3) && picturesOk;
console.log(pass ? 'PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
