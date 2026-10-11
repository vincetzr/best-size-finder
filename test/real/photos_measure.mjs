// The page's own measuring code on real photos (photos_fetch.py), as far as two still photos allow.
//
//   node test/real/photos_measure.mjs <folder>
//
// The page's pose model finds the body and its outline in each photo, in a real browser. Then the
// page's own functions, in Node: the height in pixels from the crown of the outline to the heels,
// the chest row, the chest's width along it (which refuses when the arms touch the body), the same
// height above the heels in the side photo, and the depth there. These photos have no hops, so each
// person's stated height stands in for the page's ruler. "forced" is the page's width-and-depth
// formula on those numbers even where the page refused, to show what refusing saved.
//
// Writes <folder>/page_results.json, and each outline as <folder>/outlines/<person>-<view>.pgm.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from '../e2e/serve.mjs';
import * as body from '../../src/body.js';
import { girthFromWidthDepth } from '../../src/sizing.js';

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const dir = path.resolve(process.argv[2]);
const people = JSON.parse(fs.readFileSync(path.join(dir, 'people.json'), 'utf8')).filter((p) => !p.sameAs && p.age >= 18);

const { server, port } = await serve(repo, dir);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${port}/test/e2e/blank.html`);
await page.evaluate(async () => {
  const vision = await import('/pose/vision_bundle.mjs');
  const fsr = await vision.FilesetResolver.forVisionTasks('/pose/wasm');
  window.__pose = await vision.PoseLandmarker.createFromOptions(fsr, {
    baseOptions: { modelAssetPath: '/pose/pose_landmarker_lite.task', delegate: 'GPU' },
    runningMode: 'IMAGE', numPoses: 1, outputSegmentationMasks: true,
  });
});

// One photo: its landmarks, and its outline as 0..255 per pixel (then 0..1, as the page reads it).
async function look(file, name) {
  const r = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const res = window.__pose.detect(img);
    if (!res.landmarks.length) return { w: img.width, h: img.height };
    const m = res.segmentationMasks[0];
    const f = m.getAsFloat32Array();
    const u8 = new Uint8Array(f.length);
    for (let i = 0; i < f.length; i++) u8[i] = Math.round(255 * f[i]);
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    const out = { w: img.width, h: img.height, mw: m.width, mh: m.height, landmarks: res.landmarks[0], mask: btoa(s) };
    m.close();
    return out;
  }, '/media/' + file);
  if (!r.landmarks) return null;
  const u8 = Buffer.from(r.mask, 'base64');
  fs.mkdirSync(path.join(dir, 'outlines'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'outlines', name + '.pgm'), Buffer.concat([Buffer.from(`P5\n${r.mw} ${r.mh}\n255\n`), u8]));
  r.mask = Float32Array.from(u8, (v) => v / 255);
  return r;
}

const out = [];
for (const p of people) {
  const F = await look(p.front, p.key + '-front');
  const S = await look(p.side, p.key + '-side');
  const r = { key: p.key };
  const hF = F && body.bodyHeightPx(F.landmarks, F.mask, F.mw, F.mh, F.w, F.h);
  const hS = S && body.bodyHeightPx(S.landmarks, S.mask, S.mw, S.mh, S.w, S.h);
  if (!hF) {
    r.refused = 'The front photo does not show the whole body (head to heels).';
    out.push(r);
    continue;
  }
  const pxPerCm = hF.height / p.height;
  const y = body.chestRowY(F.landmarks, F.w, F.h);
  const L = (i) => body.px(F.landmarks[i], F.w, F.h);
  const span = Math.hypot(L(11).x - L(12).x, L(11).y - L(12).y);
  const w = body.widthAtRow(F.mask, F.mw, F.mh, y, (L(11).x + L(12).x) / 2, F.w, F.h, { rows: 3, maxWidthPx: 1.3 * span });
  r.front = { w: F.w, h: F.h, top: hF.top, bottom: hF.bottom, row: y, left: w.left, right: w.right, ok: w.ok, reason: w.reason, widthCm: w.width / pxPerCm };
  if (!hS) {
    r.refused = 'The side photo does not show the whole body (head to heels).';
    out.push(r);
    continue;
  }
  const pxS = hS.height / p.height;
  const aboveHeel = (hF.bottom - y) / pxPerCm; // cm above the heels, carried to the side photo as the page does
  const yS = hS.bottom - aboveHeel * pxS;
  const LS = (i) => body.px(S.landmarks[i], S.w, S.h);
  const xcS = ((LS(11).x + LS(12).x) / 2 + (LS(23).x + LS(24).x) / 2) / 2;
  const d = body.widthAtRow(S.mask, S.mw, S.mh, yS, xcS, S.w, S.h, { rows: 3, maxWidthPx: 1.3 * span * (pxS / pxPerCm) });
  r.side = { w: S.w, h: S.h, top: hS.top, bottom: hS.bottom, row: yS, left: d.left, right: d.right, ok: d.ok, reason: d.reason, depthCm: d.width / pxS };
  r.forced = girthFromWidthDepth(r.front.widthCm, r.side.depthCm).chestCm;
  if (w.ok && d.ok) r.page = r.forced;
  else r.refused = !w.ok ? w.reason : d.reason;
  out.push(r);
}
await browser.close();
server.close();
fs.writeFileSync(path.join(dir, 'page_results.json'), JSON.stringify(out, null, 1));
for (const r of out) {
  console.log(r.key.padEnd(14), r.page ? r.page.toFixed(1) : 'refused', r.refused || '',
    r.front ? `width ${r.front.widthCm.toFixed(1)}` : '', r.side ? `depth ${r.side.depthCm.toFixed(1)}` : '');
}
