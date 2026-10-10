// Cut the person out of a photograph with the page's own pose model, in a
// real browser: writes <out>/mask.png (person confidence as grey) and
// <out>/landmarks.json. Usage: node test/e2e/cutout.mjs photo.jpg outdir
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from './serve.mjs';

const [photo, out] = process.argv.slice(2);
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(photo, path.join(out, 'photo' + path.extname(photo)));
const { server, port } = await serve(repo, path.resolve(out));
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (m) => console.log('page:', m.text()));
await page.goto(`http://127.0.0.1:${port}/test/e2e/blank.html`);
const result = await page.evaluate(async (src) => {
  const vision = await import('/pose/vision_bundle.mjs');
  const fs = await vision.FilesetResolver.forVisionTasks('/pose/wasm');
  const pose = await vision.PoseLandmarker.createFromOptions(fs, {
    // GPU: on the CPU, MediaPipe 1.0.1 aborts when asked for a mask
    baseOptions: { modelAssetPath: '/pose/pose_landmarker_lite.task', delegate: 'GPU' },
    runningMode: 'IMAGE',
    numPoses: 1,
    outputSegmentationMasks: true,
  });
  const img = new Image();
  img.src = src;
  await img.decode();
  const r = pose.detect(img);
  const m = r.segmentationMasks[0];
  const f = m.getAsFloat32Array();
  const c = document.createElement('canvas');
  c.width = m.width;
  c.height = m.height;
  const x = c.getContext('2d');
  const d = x.createImageData(m.width, m.height);
  for (let i = 0; i < f.length; i++) {
    const v = Math.round(255 * f[i]);
    d.data[4 * i] = d.data[4 * i + 1] = d.data[4 * i + 2] = v;
    d.data[4 * i + 3] = 255;
  }
  x.putImageData(d, 0, 0);
  return { png: c.toDataURL('image/png'), landmarks: r.landmarks[0], w: img.naturalWidth, h: img.naturalHeight, mw: m.width, mh: m.height };
}, `/media/photo${path.extname(photo)}`);
fs.writeFileSync(path.join(out, 'mask.png'), Buffer.from(result.png.split(',')[1], 'base64'));
fs.writeFileSync(path.join(out, 'landmarks.json'), JSON.stringify({ w: result.w, h: result.h, mw: result.mw, mh: result.mh, landmarks: result.landmarks }, null, 1));
console.log(`mask ${result.mw}x${result.mh} for a ${result.w}x${result.h} photo; ${result.landmarks ? result.landmarks.length : 0} landmarks`);
await browser.close();
server.close();
