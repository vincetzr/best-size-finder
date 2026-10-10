/**
 * THE PAGE: from a tap to a size, asking nothing.
 *
 * Stages, each waiting for the one thing it needs and saying what that is:
 *
 *   near   — the customer has just tapped Start, so they are at arm's length:
 *            read the irises (11.7 mm in every adult, near enough) and from
 *            them the distance between the eyes in millimetres. A cross-check
 *            for later, and the ruler of last resort.
 *   level  — the tablet stood upright, by its own accelerometer.
 *   frame  — head to feet in the picture, hands on hips, still.
 *   hop    — five small hops. The trunk is tracked to a fraction of a pixel;
 *            gravity.js turns the flights into pixels per metre at the body.
 *   front  — arms straight out: the chest's width.
 *   side   — a quarter turn, arms straight up: its depth.
 *   result — the girth, BEST's size for it, and how sure.
 *
 * The scale is carried from the hops to the two pictures by the customer's own
 * nose-to-heel height in pixels, which neither raising the arms nor turning on
 * the spot changes, so a half-step back between pictures is taken out.
 */
import { openCamera, everyFrame, FrameGrabber, cameraError } from './capture.js';
import { createPose, createFace, readPose, readFace } from './vision.js';
import { Level, makeRectifier } from './level.js';
import { gravityScale } from './gravity.js';
import { regulariseTimes } from './timing.js';
import { TemplateTracker } from './track.js';
import * as body from './body.js';
import { girthFromWidthDepth, chestError, chestFromTurn, fuseChests, verdict, rankSizes, CHART, CHEST_RANGE } from './sizing.js';
import { IrisRuler, agree } from './iris.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');

// A nominal focal length for the rectification. It only has to be roughly
// right: with the tablet within five degrees of upright, a focal length a
// fifth out costs under 0.6 per cent (test/level.test.mjs). 75 degrees across
// the diagonal is a phone's or tablet's front camera, give or take.
const NOMINAL_DIAGONAL_FOV_DEG = 75;
const LEVEL_TOLERANCE_DEG = 5;
const HOPS_WANTED = 5;
const LEG_FOLD_LIMIT = 0.03; // legs 3% shorter (against the trunk) in the air: about a 20° knee fold, ~2 mm of centre of mass
// the height is read to the pose model's lowest heel or toe point, which sits a
// little above the floor and not always the same amount: a fixed doubt, apart
// from the scale's (the end-to-end test reads about 1.5 cm short)
const HEIGHT_LANDMARK_CM = 2;
const STILL_PX = 1.2; // per frame, mean movement of the shoulders to count as standing still
const BURST = 7; // frames per picture; the median is kept
const POSE_TOO_SLOW_MS = 120;
// side on: the shoulders look less than this share as far apart as facing,
// which is about seventy degrees turned (acos 0.35)
const TURNED_SPAN = 0.35;
const TURN_SETTLED = 0.03; // the span's range over eight frames, as a share of the facing span
const EDGE_MARGIN = 0.04; // of the picture's width, kept clear either side of the trunk box
const SLOW_FPS = 20; // below this many frames a second actually seen, a flight is too few points to fit
const POSE_SHARE = 0.35; // while hopping, the pose model may use this share of each frame's time, on average
const ELBOWS_OUT = 0.1; // each elbow at least this many shoulder spans outside its shoulder
const HANDS_FROM = 0.5; // wrists below half way from shoulders to hips…
const HANDS_TO = 0.2; // …and not more than a fifth of the torso below the hip line
const HANDS_ACROSS = 0.6; // and within this many shoulder spans of their hip, sideways
const NEAR_IPD_FRACTION = 0.12; // eyes this far apart, as a fraction of the picture's width, is close enough to read the irises

const S = {
  stage: 'intro',
  W: 0,
  H: 0,
  camera: null,
  rectifyRoll: null,
  level: new Level({ window: 30 }),
  motionSeen: false,
  pose: null,
  face: null,
  iris: new IrisRuler(),
  irisFarFrames: 0,
  lastPose: null,
  poseHistory: [],
  lastTs: 0,
  frameCount: 0,
  stageStart: 0,
  hop: null,
  scale: null,
  front: null,
  side: null,
  result: null,
  clock: null,
  log: [],
};
window.__scan = S; // for the end-to-end test, and for anyone curious

// ——— words on the screen and out loud ———
let lastSaid = '';
let lastSaidAt = 0;
function say(text) {
  if (!('speechSynthesis' in window) || !text) return;
  const now = performance.now();
  if (text === lastSaid && now - lastSaidAt < 6000) return;
  lastSaid = text;
  lastSaidAt = now;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02;
    speechSynthesis.speak(u);
  } catch {}
}
function cue(big, small = '', { speak = true } = {}) {
  if ($('cueBig').textContent !== big) {
    $('cueBig').textContent = big;
    if (speak) say(big);
  }
  $('cueSmall').textContent = small;
}
function bar(frac) {
  $('bar').style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
}
function setStage(s) {
  S.stage = s;
  S.stageStart = performance.now();
  S.log.push({ stage: s, at: Math.round(S.stageStart) });
  $('level').hidden = s !== 'level';
}

// ——— start: one tap, inside which every permission is asked ———
$('start').addEventListener('click', start);

async function start() {
  $('start').disabled = true;
  $('error').hidden = true;
  // iOS asks for motion only from inside a tap; ask before anything is awaited
  const motionAsk =
    typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function'
      ? DeviceMotionEvent.requestPermission().catch(() => 'denied')
      : Promise.resolve('granted');
  // speech needs unlocking from a tap too
  try {
    speechSynthesis.speak(new SpeechSynthesisUtterance(''));
  } catch {}
  let cam;
  try {
    cam = await openCamera($('video'));
  } catch (e) {
    $('error').textContent = cameraError(e);
    $('error').hidden = false;
    $('start').disabled = false;
    return;
  }
  S.cam = cam;
  setCamera(cam.video.videoWidth, cam.video.videoHeight);
  $('intro').hidden = true;
  $('stage').hidden = false;
  $('stage').scrollIntoView({ block: 'start' });
  if ((await motionAsk) === 'granted') {
    window.addEventListener('devicemotion', (e) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x === null) return;
      S.motionSeen = true;
      const angle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
      S.level.push({ x: a.x, y: a.y, z: a.z }, angle);
    });
  }
  cue('Loading…', 'The first time takes a few seconds.', { speak: false });
  setStage('loading');
  try {
    const [pose, face] = await Promise.all([createPose({ masks: true }), createFace().catch(() => null)]);
    // the end-to-end test hands in a pose model of its own for the two
    // pictures, which a photograph cannot pose for; nothing else sets this
    S.pose = typeof window.__scanWrapPose === 'function' ? window.__scanWrapPose(pose) : pose;
    S.face = face;
    if (!S.pose.hasMasks) {
      showFailure('This device’s graphics could not run the body-outline model, and the chest’s width needs it. Try another browser, or another device.');
      return;
    }
  } catch (e) {
    cue('The measuring model would not load.', String(e && e.message ? e.message : e), { speak: false });
    return;
  }
  setStage(S.face ? 'near' : 'level');
  S.stopFrames = everyFrame(cam.video, onFrame);
}

/** The picture's size, its centre and a nominal focal length, and the overlay to match. */
function setCamera(W, H) {
  S.W = W;
  S.H = H;
  const diag = Math.hypot(W, H);
  S.camera = { focalPx: diag / 2 / Math.tan(((NOMINAL_DIAGONAL_FOV_DEG / 2) * Math.PI) / 180), cx: W / 2, cy: H / 2 };
  const ov = $('overlay');
  ov.width = W;
  ov.height = H;
}

function monotonicMs(t) {
  // MediaPipe wants strictly increasing timestamps
  let ms = t * 1000;
  if (!(ms > S.lastTs)) ms = S.lastTs + 1;
  S.lastTs = ms;
  return ms;
}

// ——— one frame ———
function onFrame(f) {
  S.frameCount++;
  S.clock = f.source;
  const video = S.cam.video;
  if (video.videoWidth !== S.W || video.videoHeight !== S.H) {
    // the device was turned: a new picture, a new centre, and any scale
    // measured in the old one belongs to it — so the measuring starts over
    setCamera(video.videoWidth, video.videoHeight);
    if (['hop', 'hopDone', 'front', 'side'].includes(S.stage)) {
      S.scale = null;
      S.hop = null;
      S.poseHistory = [];
      S.frameOkCount = 0;
      setStage('frame');
      cue('The tablet was turned', 'Starting the measuring again from the top.');
      return;
    }
  }
  const ts = monotonicMs(f.t);
  switch (S.stage) {
    case 'near':
      return near(f, ts);
    case 'level':
      return levelStage(f, ts);
    case 'frame':
      return frameStage(f, ts);
    case 'hop':
      return hopStage(f, ts);
    case 'front':
    case 'side':
      return pictureStage(f, ts);
    default:
  }
}

function since() {
  return (performance.now() - S.stageStart) / 1000;
}

// ——— near: the irises, while the customer is still at arm's length ———
function near(f, ts) {
  cue('Look at the screen for a moment', 'Reading your eyes, close up — a cross-check for later.', { speak: false });
  const face = readFace(S.face, S.cam.video, ts);
  // close up only: at arm's length the eyes are a fifth of the picture apart;
  // a face across the room has irises of a few pixels and would read wildly
  const close = face && face[468] && face[473] && Math.hypot((face[468].x - face[473].x) * S.W, (face[468].y - face[473].y) * S.H) > NEAR_IPD_FRACTION * S.W;
  if (close) S.iris.addNear(face, S.W, S.H);
  else if (face) cue('Come closer to the screen for a moment', 'Reading your eyes, close up — a cross-check for later.', { speak: false });
  const got = S.iris.ipdMm();
  bar(got ? got.frames / 15 : 0);
  if ((got && got.frames >= 15) || since() > 5) {
    S.nearResult = got;
    setStage('level');
  }
}

// ——— level: the tablet upright ———
function levelStage(f, ts) {
  const r = S.level.read();
  const mark = $('level');
  if (!S.motionSeen || !r) {
    if (since() > 1.5) {
      // a laptop, or motion refused: carry on, with the pitch taken as small
      S.attitude = null;
      setStage('frame');
    }
    cue('Stand the tablet up straight', 'At chest height, screen towards the room.');
    return;
  }
  const pitch = (r.pitchRad * 180) / Math.PI;
  const roll = (r.rollRad * 180) / Math.PI;
  mark.querySelector('i').style.transform = `translate(${Math.max(-40, Math.min(40, roll * 4))}px, ${Math.max(-40, Math.min(40, -pitch * 4))}px)`;
  const ok = Math.abs(pitch) < LEVEL_TOLERANCE_DEG && Math.abs(roll) < LEVEL_TOLERANCE_DEG && r.still;
  mark.classList.toggle('ok', ok);
  cue(
    ok ? 'That is level' : pitch > 0 ? 'Tilt the top of the tablet back' : 'Tilt the top of the tablet forward',
    `Tilt ${Math.abs(pitch).toFixed(1)}°, lean ${Math.abs(roll).toFixed(1)}° — under ${LEVEL_TOLERANCE_DEG}° both is fine.`,
  );
  if (ok) {
    S.levelOkSince ??= performance.now();
    bar((performance.now() - S.levelOkSince) / 800);
    if (performance.now() - S.levelOkSince > 800) {
      S.attitude = r;
      setStage('frame');
    }
  } else {
    S.levelOkSince = null;
    bar(0);
  }
}

function currentAttitude() {
  const r = S.level.read();
  if (r && r.still) return r;
  return S.attitude || null;
}

// ——— pose, every frame it is needed ———
function poseNow(ts, wantMask = true) {
  const p = readPose(S.pose, S.cam.video, ts, { wantMask });
  S.lastPose = p;
  if (p) {
    S.poseHistory.push({ ts, p });
    if (S.poseHistory.length > 30) S.poseHistory.shift();
  }
  return p;
}

const vis = (lm, i) => lm[i] && (lm[i].visibility === undefined || lm[i].visibility > 0.5);

function shoulderMid(lm) {
  const a = body.px(lm[body.LM.leftShoulder], S.W, S.H);
  const b = body.px(lm[body.LM.rightShoulder], S.W, S.H);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, span: Math.hypot(a.x - b.x, a.y - b.y) };
}

/**
 * Mean movement over the last frames, px per frame, of the shoulders, the hips
 * and the nose, each on its own: someone turning on the spot keeps the point
 * between their shoulders where it was, so that alone would call a turn still.
 */
const STILL_POINTS = [0, 11, 12, 23, 24];
function stillness(n = 10) {
  const h = S.poseHistory.slice(-n);
  if (h.length < n) return Infinity;
  let s = 0;
  for (let i = 1; i < h.length; i++) {
    let m = 0;
    for (const k of STILL_POINTS) {
      const a = body.px(h[i - 1].p.landmarks[k], S.W, S.H);
      const b = body.px(h[i].p.landmarks[k], S.W, S.H);
      m += Math.hypot(a.x - b.x, a.y - b.y);
    }
    s += m / STILL_POINTS.length;
  }
  return s / (h.length - 1);
}

/**
 * Nose to the lower visible heel, vertically, in the rectified picture: the
 * body's own ruler between pictures. Side on, the far heel is usually behind
 * the near leg and the pose model guesses it, so only heels it can see count.
 * NaN if there is none.
 */
function noseHeel(lm, rectify) {
  const n = body.px(lm[body.LM.nose], S.W, S.H);
  const heels = [body.LM.leftHeel, body.LM.rightHeel].filter((i) => vis(lm, i)).map((i) => body.px(lm[i], S.W, S.H));
  if (!heels.length) return NaN;
  const heel = heels.reduce((a, b) => (b.y > a.y ? b : a));
  const a = rectify(n.x, n.y);
  const b = rectify(heel.x, heel.y);
  return Math.abs(b.v - a.v);
}

// ——— frame: head to feet, hands on hips ———
function frameStage(f, ts) {
  const p = poseNow(ts, true);
  drawPose(p);
  if (!p) {
    cue('Step into the picture', 'Two to three metres back, facing the tablet.');
    bar(0);
    return;
  }
  const lm = p.landmarks;
  const need = [body.LM.nose, body.LM.leftShoulder, body.LM.rightShoulder, body.LM.leftHip, body.LM.rightHip];
  if (!need.every((i) => vis(lm, i))) {
    cue('Face the tablet', 'Both shoulders in the picture.');
    return;
  }
  const feet = [body.LM.leftHeel, body.LM.rightHeel, body.LM.leftAnkle, body.LM.rightAnkle].every((i) => vis(lm, i));
  const top = Math.min(...[body.LM.nose, body.LM.leftEar, body.LM.rightEar].map((i) => lm[i].y));
  const bottom = Math.max(lm[body.LM.leftHeel].y, lm[body.LM.rightHeel].y, lm[body.LM.leftFootIndex].y, lm[body.LM.rightFootIndex].y);
  if (!feet || bottom > 0.97) {
    cue('Step back', 'Your feet need to be in the picture.');
    return;
  }
  if (top < 0.08) {
    cue('Step back a little', 'Your head needs room above it to hop.');
    return;
  }
  if (bottom - top < 0.5) {
    cue('Come a step closer', 'Fill more of the picture, head to feet.');
    return;
  }
  const mid = shoulderMid(lm);
  if (Math.abs(mid.x / S.W - 0.5) > 0.2) {
    cue(mid.x / S.W < 0.5 ? 'Move a step to your left' : 'Move a step to your right', 'Into the middle of the picture.');
    return;
  }
  if (!handsOnHipsElbowsOut(lm)) {
    cue('Hands on hips', 'Elbows out. Then stand still.');
    bar(0);
    return;
  }
  const st = stillness(12);
  if (st > STILL_PX) {
    cue('Now stand still', 'Hands on hips, facing the tablet.');
    bar(0);
    return;
  }
  // the eyes across the room: only now, with the customer head to feet in the
  // picture and still — before this they may still be at arm's length
  if (S.face && S.iris.ipdMm()) farIris(ts, p);
  S.frameOkCount = (S.frameOkCount || 0) + 1;
  bar(S.frameOkCount / 15);
  cue('Hold still…', '');
  if (S.frameOkCount >= 15) {
    S.frameOkCount = 0;
    enterHop(p);
  }
}

/**
 * The legs' length over the trunk's, from one pose: folding the knees shortens
 * the first and not the second, while stepping nearer the camera lengthens
 * both alike — so in raw pixels a customer drifting away while hopping would
 * read as bending their knees, and here does not.
 */
function legRatio(lm) {
  const leg = body.legLength(lm, S.W, S.H);
  const P = (i) => body.px(lm[i], S.W, S.H);
  const sh = [P(body.LM.leftShoulder), P(body.LM.rightShoulder)];
  const hp = [P(body.LM.leftHip), P(body.LM.rightHip)];
  const trunk = Math.hypot((sh[0].x + sh[1].x - hp[0].x - hp[1].x) / 2, (sh[0].y + sh[1].y - hp[0].y - hp[1].y) / 2);
  return trunk > 0 ? leg / trunk : NaN;
}

/**
 * Hands on hips, elbows out. People put their hands on the waist, a hand's
 * breadth above the hip joints the pose model marks (on the photograph the
 * end-to-end test uses, 0.6 shoulder spans from them), so the wrists are
 * looked for between the bottom of the ribs and the hip line, at the side; and
 * the elbows must stand out past the shoulders, because wrists at the hips is
 * also true of arms hanging relaxed, and it is the elbows out that make
 * shoulders, arms and trunk one rigid, edged shape for the tracker.
 */
function handsOnHipsElbowsOut(lm) {
  const P = (i) => body.px(lm[i], S.W, S.H);
  const ls = P(body.LM.leftShoulder);
  const rs = P(body.LM.rightShoulder);
  const lh = P(body.LM.leftHip);
  const rh = P(body.LM.rightHip);
  const span = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  const shY = (ls.y + rs.y) / 2;
  const hipY = (lh.y + rh.y) / 2;
  const torso = hipY - shY;
  const dir = Math.sign(ls.x - rs.x) || 1; // the person's left is on the picture's right when facing it
  const side = (wrist, hip, elbow, shoulder, s) => {
    const w = P(wrist);
    const e = P(elbow);
    const h = P(hip);
    const sh = P(shoulder);
    const wristAtWaist = w.y > shY + HANDS_FROM * torso && w.y < hipY + HANDS_TO * torso && Math.abs(w.x - h.x) < HANDS_ACROSS * span;
    const elbowOut = s * (e.x - sh.x) > ELBOWS_OUT * span;
    return wristAtWaist && elbowOut;
  };
  return (
    side(body.LM.leftWrist, body.LM.leftHip, body.LM.leftElbow, body.LM.leftShoulder, dir) &&
    side(body.LM.rightWrist, body.LM.rightHip, body.LM.rightElbow, body.LM.rightShoulder, -dir)
  );
}

// far iris: the face is small at this distance, so the head is cut out and
// enlarged for the face model, and its points put back where they came from
const headCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
function farIris(ts, p) {
  if (!p || S.irisFarFrames >= 40 || !headCanvas) return;
  const lm = p.landmarks;
  const n = body.px(lm[body.LM.nose], S.W, S.H);
  const el = body.px(lm[body.LM.leftEar], S.W, S.H);
  const er = body.px(lm[body.LM.rightEar], S.W, S.H);
  const half = Math.max(24, Math.hypot(el.x - er.x, el.y - er.y) * 1.4);
  const x0 = Math.max(0, n.x - half);
  const y0 = Math.max(0, n.y - half);
  const w = Math.min(S.W - x0, 2 * half);
  const h = Math.min(S.H - y0, 2 * half);
  headCanvas.width = 256;
  headCanvas.height = 256;
  const ctx = headCanvas.getContext('2d');
  ctx.drawImage(S.cam.video, x0, y0, w, h, 0, 0, 256, 256);
  const face = readFace(S.face, headCanvas, ts + 0.5);
  if (!face) return;
  const mapped = face.map((q) => ({ x: (x0 + q.x * w) / S.W, y: (y0 + q.y * h) / S.H, z: q.z }));
  S.iris.addFar(mapped, S.W, S.H);
  S.irisFarFrames++;
}

// ——— hop ———
function enterHop(p) {
  const lm = p.landmarks;
  const box = body.trunkBox(lm, S.W, S.H);
  if (!box) return;
  // the tracker needs picture all round the trunk, and room to hop into; a box
  // against the edge would be lost on the first frame, every time
  if (box.x0 < EDGE_MARGIN * S.W || box.x1 > (1 - EDGE_MARGIN) * S.W) {
    const left = (box.x0 + box.x1) / 2 < S.W / 2;
    cue(left ? 'Move a step to your left' : 'Move a step to your right', 'Your elbows need room in the picture.');
    return;
  }
  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;
  // the region the trunk can move in while hopping; only this is read each frame
  const roi = {
    x: Math.max(0, Math.floor(box.x0 - 0.3 * bw)),
    y: Math.max(0, Math.floor(box.y0 - 0.8 * bh)),
  };
  roi.w = Math.min(S.W, Math.ceil(box.x1 + 0.3 * bw)) - roi.x;
  roi.h = Math.min(S.H, Math.ceil(box.y1 + 0.5 * bh)) - roi.y;
  const grab = (S.grabber ||= new FrameGrabber());
  const g = grab.grayRegion(S.cam.video, roi.x, roi.y, roi.w, roi.h);
  const tracker = new TemplateTracker({ maxShift: 0.7 });
  tracker.setReference(g.gray, g.w, g.h, { x0: box.x0 - g.x, y0: box.y0 - g.y, x1: box.x1 - g.x, y1: box.y1 - g.y });
  const legs = S.poseHistory.map((h) => legRatio(h.p.landmarks)).filter((x) => x > 0);
  const restLeg = legs.length ? legs.sort((a, b) => a - b)[legs.length >> 1] : NaN;
  const height = p.mask ? body.bodyHeightPx(lm, p.mask, p.mw, p.mh, S.W, S.H) : null;
  S.hop = {
    box,
    roi: g,
    tracker,
    centre: { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 },
    samples: [],
    poses: [],
    restLeg,
    restLandmarks: lm,
    restHeight: height,
    restNoseX: body.px(lm[body.LM.nose], S.W, S.H).x,
    lost: 0,
    restV: null,
    count: 0,
    inAir: false,
    lastMoveAt: performance.now(),
    firstHopAt: null,
  };
  setStage('hop');
  cue(`Hop ${HOPS_WANTED} times`, 'Small hops on the spot. Knees straight, hands on hips.');
}

function hopStage(f, ts) {
  const H = S.hop;
  const tStart = performance.now();
  const g = S.grabber.grayRegion(S.cam.video, H.roi.x, H.roi.y, H.roi.w, H.roi.h);
  H.grabMs = 0.9 * (H.grabMs ?? performance.now() - tStart) + 0.1 * (performance.now() - tStart);
  const tTrack = performance.now();
  const last = H.samples[H.samples.length - 1];
  const prev = H.samples[H.samples.length - 2];
  const predict = last ? { dx: last.dx + (prev ? last.dx - prev.dx : 0), dy: last.dy + (prev ? last.dy - prev.dy : 0) } : { dx: 0, dy: 0 };
  const r = H.tracker.track(g.gray, g.w, g.h, predict);
  H.trackMs = 0.9 * (H.trackMs ?? performance.now() - tTrack) + 0.1 * (performance.now() - tTrack);
  if (r.ok) {
    H.samples.push({ t: f.t, u: H.centre.x + r.dx, v: H.centre.y + r.dy, dx: r.dx, dy: r.dy, score: r.score, presented: f.presented });
    H.lost = 0;
  } else if (++H.lost > 20) {
    // walking up to read the screen after the last hop, or dropping the hands,
    // loses the trunk — but the hops are already in the bag
    if (H.count >= 2) return finishHop();
    cue('Stay in the picture', 'Lost you — back on the spot, hands on hips, and we start again.');
    S.poseHistory = [];
    setStage('frame');
    return;
  }
  // the pose, for the knees and the hands — but only as often as the device
  // can afford: every frame the tracker misses is a point off a parabola, and
  // the knees only need watching a few times a flight
  const period = H.samples.length > 4 ? (H.samples[H.samples.length - 1].t - H.samples[H.samples.length - 5].t) / 4 : 1 / 30;
  const every = Math.max(2, Math.min(8, Math.ceil((H.poseMs || 0) / (POSE_SHARE * period * 1000))));
  // a device so slow that one pose costs several frames gives the hops the
  // frames instead: the knees go unchecked, and the answer says so
  if (H.poseMs > POSE_TOO_SLOW_MS) H.kneesUnchecked = true;
  else if (S.frameCount % every === 0) {
    const t0 = performance.now();
    const p = poseNow(ts, false);
    H.poseMs = 0.8 * (H.poseMs || performance.now() - t0) + 0.2 * (performance.now() - t0);
    if (p) H.poses.push({ t: f.t, leg: legRatio(p.landmarks), hands: handsOnHipsElbowsOut(p.landmarks) });
  }
  drawHop(H);
  // counting hops, for the screen only (the fit finds them properly)
  if (r.ok) {
    if (H.restV === null && H.samples.length >= 8) H.restV = median(H.samples.slice(0, 8).map((s) => s.dy));
    if (H.restV !== null) {
      const up = H.restV - r.dy; // pixels above standing
      const thr = Math.max(6, 0.025 * (H.box.y1 - H.box.y0) * 2);
      if (!H.inAir && up > thr) {
        H.inAir = true;
        H.count++;
        H.firstHopAt ??= performance.now();
      } else if (H.inAir && up < thr / 3) H.inAir = false;
      if (Math.abs(up) > thr / 3) H.lastMoveAt = performance.now();
    }
  }
  bar(H.count / HOPS_WANTED);
  if (H.count === 0) {
    if (since() <= 12) cue(`Hop ${HOPS_WANTED} times`, 'Small hops on the spot. Knees straight, hands on hips.');
    else cue('Hop on the spot', 'Five small hops. Or, if you cannot, wait — it will measure from your eyes instead.');
  } else if (H.count < HOPS_WANTED) cue(`${H.count}…`, 'Keep going — knees straight.', { speak: false });
  else cue('And stand still', '');
  const quiet = performance.now() - H.lastMoveAt;
  if ((H.count >= HOPS_WANTED && quiet > 700) || H.count >= HOPS_WANTED + 4 || (H.firstHopAt && performance.now() - H.firstHopAt > 15000)) finishHop();
  else if (!H.firstHopAt && since() > 25) skipHop('No hops were seen.');
}

function finishHop() {
  const H = S.hop;
  setStage('hopDone');
  const times = regulariseTimes(
    H.samples.map((s) => s.t),
    H.samples.map((s) => s.presented),
  );
  const samples = H.samples.map((s, i) => ({ t: times.times[i], u: s.u, v: s.v, raw: s.t }));
  const attitude = currentAttitude();
  let g = gravityScale(samples, { attitude, camera: S.camera, rectifierFactory: makeRectifier });
  const span = samples.length ? samples[samples.length - 1].t - samples[0].t : 0;
  S.hopTiming = {
    regular: times.regular,
    jitterMs: times.jitterMs,
    periodMs: times.periodMs,
    clock: S.clock,
    frames: samples.length,
    span,
    seenFps: span > 0 ? (samples.length - 1) / span : 0,
    grabMs: H.grabMs,
    trackMs: H.trackMs,
    poseMs: H.poseMs,
  };
  // knees: an arc in which the legs were shorter than standing by more than
  // LEG_FOLD_LIMIT was not a rigid body, and its curvature is not gravity's
  let dropped = 0;
  if (g.ok && Number.isFinite(H.restLeg)) {
    const bent = g.fit.arcs.filter((a) => {
      const raw0 = rawTime(samples, a.t0);
      const raw1 = rawTime(samples, a.t1);
      const legs = H.poses.filter((q) => q.t >= raw0 && q.t <= raw1).map((q) => q.leg);
      return legs.length && 1 - Math.min(...legs) / H.restLeg > LEG_FOLD_LIMIT;
    });
    if (bent.length) {
      dropped = bent.length;
      const keep = samples.filter((s) => !bent.some((a) => s.t >= a.t0 - 0.05 && s.t <= a.t1 + 0.05));
      g = gravityScale(keep, { attitude, camera: S.camera, rectifierFactory: makeRectifier });
      if (!g.ok && bent.length >= 2) g = { ok: false, message: 'Your knees bent in the air. Hop from the ankles, legs straight.' };
    }
  }
  const handsOff = H.poses.length && H.poses.filter((q) => !q.hands).length / H.poses.length > 0.4;
  if (g.ok && handsOff) g = { ok: false, message: 'Keep your hands on your hips while you hop — swinging arms move your balance point.' };
  S.hopFit = g;
  if (!g.ok) {
    // a flight too short to time on a device that is only seeing a few frames
    // a second is the device's doing, not the hop's
    if (g.reason === 'short-flight' && S.hopTiming.seenFps < SLOW_FPS)
      g.message = `This device only kept up with ${Math.round(S.hopTiming.seenFps)} frames a second — too few to time a hop. Close other apps and try again.`;
    cue('Once more', g.message || 'The hops could not be timed.');
    S.hopTries = (S.hopTries || 0) + 1;
    setTimeout(() => {
      if (S.hopTries >= 3) skipHop(g.message);
      else {
        S.poseHistory = [];
        setStage('frame');
      }
    }, 3500);
    return;
  }
  const rest = H.restLandmarks;
  const ref = noseHeel(rest, g.rectify);
  let heightM = null;
  if (H.restHeight) {
    const a = g.rectify(H.restNoseX, H.restHeight.top);
    const b = g.rectify(H.restNoseX, H.restHeight.bottom);
    heightM = Math.abs(b.v - a.v) / g.pxPerMetre;
  }
  S.scale = {
    source: 'gravity',
    pxPerMetre: g.pxPerMetre,
    rel: g.rel,
    rectify: g.rectify,
    noseHeelPx: ref,
    heightM,
    hopsUsed: g.fit.hopsUsed,
    hopsDropped: (g.fit.hopsDropped || 0) + dropped,
    kneesChecked: !H.kneesUnchecked && H.poses.length > 0,
    fit: g.fit,
    samples,
  };
  const irisAt = S.iris.scaleAtTrunk({ focalPx: S.camera.focalPx });
  if (irisAt) S.irisCheck = agree({ pxPerMetre: g.pxPerMetre, rel: g.rel }, irisAt);
  cue(heightM ? `You are about ${(heightM * 100).toFixed(0)} cm tall` : 'Got it', heightM ? 'Measured by gravity, in your shoes. If that is close, the scale is right.' : '');
  setTimeout(() => enterPicture('front'), 3200);
}

function rawTime(samples, t) {
  let best = samples[0];
  for (const s of samples) if (Math.abs(s.t - t) < Math.abs(best.t - t)) best = s;
  return best.raw;
}

/** No hops: measure from the eyes, with the margin that deserves. */
function skipHop(why) {
  const at = S.iris.scaleAtTrunk({ focalPx: S.camera.focalPx });
  const p = S.lastPose || (S.poseHistory.length && S.poseHistory[S.poseHistory.length - 1].p);
  if (!at || !p) {
    S.result = { failed: why || 'No hops, and the eyes could not be read either.' };
    showFailure(S.result.failed);
    return;
  }
  const rectify = makeRectifier({ ...S.camera, pitchRad: S.attitude ? S.attitude.pitchRad : 0, rollRad: S.attitude ? S.attitude.rollRad : 0 });
  S.scale = { source: 'iris', pxPerMetre: at.pxPerMetre, rel: at.rel, rectify, noseHeelPx: noseHeel(p.landmarks, rectify), heightM: null };
  setStage('hopDone'); // out of the hop stage now, so this runs once
  cue('Measuring from your eyes instead', 'A wider margin than hopping gives.');
  setTimeout(() => enterPicture('front'), 2500);
}

// ——— the two pictures ———
function enterPicture(which) {
  S.burst = [];
  S.pictureOk = 0;
  if (which === 'side') S.turnSamples = [];
  setStage(which);
}

function pictureStage(f, ts) {
  const which = S.stage;
  const p = poseNow(ts, true);
  drawPose(p, which);
  if (!p || !p.mask) {
    cue('Step back into the picture', '');
    return;
  }
  const lm = p.landmarks;
  const sh = shoulderMid(lm);
  const L = (i) => body.px(lm[i], S.W, S.H);
  if (which === 'front') {
    const wl = L(body.LM.leftWrist);
    const wr = L(body.LM.rightWrist);
    const out = Math.abs(wl.x - sh.x) > 1.1 * sh.span && Math.abs(wr.x - sh.x) > 1.1 * sh.span;
    const levelArms = Math.abs(wl.y - sh.y) < 0.6 * sh.span && Math.abs(wr.y - sh.y) < 0.6 * sh.span;
    if (!out || !levelArms) {
      cue('Arms straight out to the sides', 'Level with your shoulders, like a T. Facing the tablet.');
      bar(0);
      S.burst = [];
      return;
    }
  } else {
    const nose = L(body.LM.nose);
    const up = L(body.LM.leftWrist).y < nose.y && L(body.LM.rightWrist).y < nose.y;
    if (!up) {
      cue('Both arms straight up', 'Over your head. Then turn slowly to your left.');
      bar(0);
      S.burst = [];
      return;
    }
    // every frame of the turn, arms up, is a width at an angle (turnSample)
    turnSample(p, lm, sh);
    const turned = S.front && sh.span < TURNED_SPAN * S.front.shoulderSpanPx;
    if (!turned) {
      cue('Now turn slowly to your left', 'Arms up, feet where they are, until one shoulder points straight at the tablet.');
      bar(Math.min(0.9, (S.turnSamples || []).length / 40));
      S.burst = [];
      return;
    }
  }
  // the scale is carried by nose-to-heel, so both must really be in view
  const heelsSeen = [body.LM.leftHeel, body.LM.rightHeel].filter((i) => vis(lm, i));
  if (!vis(lm, body.LM.nose) || !heelsSeen.length || Math.max(...heelsSeen.map((i) => lm[i].y)) > 0.97) {
    cue('Step back a little', 'Your feet need to be in the picture.');
    S.burst = [];
    bar(0);
    return;
  }
  if (stillness(8) > STILL_PX || (which === 'side' && !turnSettled())) {
    cue('Hold still…', '', { speak: false });
    S.burst = [];
    bar(0);
    return;
  }
  // this frame's reading
  const sc = S.scale;
  const nh = noseHeel(lm, sc.rectify);
  const pxPerMetre = sc.pxPerMetre * (nh / sc.noseHeelPx); // stepped nearer or further since the hops
  let y;
  if (which === 'front') y = body.chestRowY(lm, S.W, S.H);
  else {
    // the same height above the heels as the front picture's chest line
    const heelY = Math.max(L(body.LM.leftHeel).y, L(body.LM.rightHeel).y);
    y = heelY - S.front.chestAboveHeelM * pxPerMetre;
  }
  const hips = [L(body.LM.leftHip), L(body.LM.rightHip)];
  const xc = which === 'front' ? sh.x : (sh.x + (hips[0].x + hips[1].x) / 2) / 2;
  const span = which === 'front' ? sh.span : S.front.shoulderSpanPx;
  const w = body.widthAtRow(p.mask, p.mw, p.mh, y, xc, S.W, S.H, { rows: 3, maxWidthPx: 1.3 * span });
  if (!w.ok) {
    cue(which === 'front' ? 'Arms further out' : 'Arms straight up, clear of your chest', w.reason || '', { speak: false });
    S.burst = [];
    return;
  }
  const a = sc.rectify(w.left, y);
  const b = sc.rectify(w.right, y);
  // the trunk's sides are upright; in the level picture its width is the
  // across part of the chord between them (a rolled camera's row is a slant)
  const widthPx = Math.abs(b.u - a.u);
  const heelY = Math.max(L(body.LM.leftHeel).y, L(body.LM.rightHeel).y);
  S.burst.push({ widthPx, pxPerMetre, y, left: w.left, right: w.right, chestAboveHeelPx: heelY - y, shoulderSpanPx: sh.span });
  drawRow(w.left, w.right, y);
  bar(S.burst.length / BURST);
  cue('Hold still…', '', { speak: false });
  if (S.burst.length < BURST) return;
  const cm = S.burst.map((q) => (100 * q.widthPx) / q.pxPerMetre).sort((x, z) => x - z);
  const mid = cm[cm.length >> 1];
  const spread = (cm[cm.length - 2] - cm[1]) / 2;
  const pm = median(S.burst.map((q) => q.pxPerMetre));
  if (which === 'front') {
    S.front = {
      widthCm: mid,
      spreadCm: spread,
      chestAboveHeelM: median(S.burst.map((q) => q.chestAboveHeelPx)) / pm,
      shoulderSpanPx: median(S.burst.map((q) => q.shoulderSpanPx)),
      distanceRatio: pm / sc.pxPerMetre,
    };
    say('Got it.');
    enterPicture('side');
  } else {
    S.side = { depthCm: mid, spreadCm: spread, distanceRatio: pm / sc.pxPerMetre };
    finish();
  }
}

/**
 * One frame of the quarter turn: the chest's width at the front picture's
 * chest line, and the angle turned, read from how far apart the shoulders look
 * against how far apart they looked facing (both put at one distance by the
 * nose-to-heel ruler). acos of that ratio is least sure near facing and near
 * side on, which is where a chest's width hardly changes with angle, so the
 * mean width over the turn — which is all Cauchy's formula needs — barely
 * notices (test/sizing.test.mjs: within 2 per cent).
 */
function turnSample(p, lm, sh) {
  const sc = S.scale;
  const nh = noseHeel(lm, sc.rectify);
  if (!(nh > 0) || !p.mask) return;
  const ratio = nh / sc.noseHeelPx; // nearer than at the hops by this much
  const L = (i) => body.px(lm[i], S.W, S.H);
  const heels = [body.LM.leftHeel, body.LM.rightHeel].filter((i) => vis(lm, i)).map((i) => L(i).y);
  if (!heels.length) return;
  const pxPerMetre = sc.pxPerMetre * ratio;
  const y = Math.max(...heels) - S.front.chestAboveHeelM * pxPerMetre;
  const hips = [L(body.LM.leftHip), L(body.LM.rightHip)];
  const xc = (sh.x + (hips[0].x + hips[1].x) / 2) / 2;
  const w = body.widthAtRow(p.mask, p.mw, p.mh, y, xc, S.W, S.H, { rows: 2, maxWidthPx: 1.3 * S.front.shoulderSpanPx * ratio });
  if (!w.ok) return;
  const a = sc.rectify(w.left, y);
  const b = sc.rectify(w.right, y);
  const widthCm = (100 * Math.abs(b.u - a.u)) / pxPerMetre;
  (S.turnSamples ||= []).push({ span: sh.span / ratio, widthCm, t: performance.now() });
}

/**
 * Has the turn stopped? People slow down as they come round to side on, and
 * a slow last few degrees passes for standing still — and a chest at eighty
 * degrees is a few per cent deeper than side on. So the side picture also
 * waits for the shoulders' apparent span to stop shrinking.
 */
function turnSettled(n = 8) {
  const h = S.poseHistory.slice(-n);
  if (h.length < n || !S.front) return false;
  const spans = h.map((x) => shoulderMid(x.p.landmarks).span);
  return Math.max(...spans) - Math.min(...spans) < TURN_SETTLED * S.front.shoulderSpanPx;
}

/** The turn's samples with their angles, against the widest the shoulders were seen facing. */
function turnAngles() {
  const q = S.turnSamples || [];
  if (q.length < 8) return [];
  const spans = q.map((x) => x.span).sort((a, b) => a - b);
  const facing = spans[Math.floor(0.9 * (spans.length - 1))]; // near the widest, not one noisy frame
  return q.map((x) => ({ angle: Math.acos(Math.min(1, x.span / facing)), widthCm: x.widthCm }));
}

// ——— the answer ———
function finish() {
  setStage('result');
  if (S.stopFrames) S.stopFrames();
  const sc = S.scale;
  const g = girthFromWidthDepth(S.front.widthCm, S.side.depthCm);
  if (!(g.chestCm >= CHEST_RANGE[0] && g.chestCm <= CHEST_RANGE[1])) {
    showFailure(`The pictures added up to a ${Math.round(g.chestCm)} cm chest, which no adult has. An arm was probably in the way. Start again, arms well clear.`);
    return;
  }
  // scatter between the frames of each picture adds to the scale's own error
  const measRel = Math.hypot(S.front.spreadCm / S.front.widthCm, S.side.spreadCm / S.side.depthCm) / 2;
  const twoView = { chestCm: g.chestCm, errCm: chestError({ chestCm: g.chestCm, scaleRel: Math.hypot(sc.rel, measRel), method: 'two-view' }) };
  // the quarter turn, if enough of it was seen: measured all the way round
  const turn = chestFromTurn(turnAngles());
  let chestCm = twoView.chestCm;
  let errCm = twoView.errCm;
  let method = g.method;
  let fused = null;
  if (turn.ok && turn.chestCm >= CHEST_RANGE[0] && turn.chestCm <= CHEST_RANGE[1]) {
    const t = { chestCm: turn.chestCm, errCm: chestError({ chestCm: turn.chestCm, scaleRel: sc.rel, method: 'turn' }) };
    fused = fuseChests(t, twoView);
    chestCm = fused.chestCm;
    errCm = fused.errCm;
    method = fused.agree ? 'turn and two pictures' : 'turn and two pictures, disagreeing';
  }
  const v = verdict(chestCm, errCm);
  const ranks = rankSizes(chestCm, errCm);
  S.result = {
    chestCm,
    errCm,
    method,
    verdict: v,
    ranks,
    widthCm: S.front.widthCm,
    depthCm: S.side.depthCm,
    twoViewCm: twoView.chestCm,
    turnCm: turn.ok ? turn.chestCm : null,
    turnCoverage: turn.coverage,
    turnWhyNot: turn.ok ? null : turn.reason,
    fused,
    scale: { source: sc.source, rel: sc.rel, heightM: sc.heightM },
  };
  say(`Your chest measures ${Math.round(chestCm)} centimetres. That is a ${v.best.name}.`);
  renderAnswer();
  if (S.cam) for (const t of S.cam.stream.getTracks()) t.stop();
}

function showFailure(msg) {
  setStage('result');
  if (S.stopFrames) S.stopFrames();
  $('stage').hidden = true;
  const a = $('answer');
  a.hidden = false;
  a.innerHTML = `<div class="verdict"><h2>No size this time</h2><p class="note">${esc(msg)}</p><button class="again" onclick="location.reload()">Start again</button></div>`;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[s.length >> 1] : NaN;
};

function renderAnswer() {
  const R = S.result;
  const v = R.verdict;
  const sc = S.scale;
  $('stage').hidden = true;
  const a = $('answer');
  a.hidden = false;
  const pct = (p) => `${Math.round(p * 100)} per cent`;
  const rows = CHART.map(
    (c) =>
      `<tr class="${c.name === v.best.name ? 'is-best' : ''}"><td>${esc(c.name)}</td><td class="mono">${c.chestCm}</td><td class="mono">${c.lengthCm}</td><td class="mono">${(() => {
        const r = R.ranks.find((x) => x.name === c.name);
        return r && r.p >= 0.005 ? `${Math.round(r.p * 100)}%` : '';
      })()}</td></tr>`,
  ).join('');
  const irisLine = S.irisCheck
    ? S.irisCheck.verdict === 'agree'
      ? `Your eyes, read close up when you started, put the scale ${((S.irisCheck.ratio - 1) * 100).toFixed(1)} per cent from gravity's — within the two rulers' combined margin, so they agree.`
      : `Your eyes, read close up when you started, put the scale ${((S.irisCheck.ratio - 1) * 100).toFixed(1)} per cent from gravity's. That is more than the two rulers' combined margin: worth measuring again.`
    : '';
  const scaleLine =
    sc.source === 'gravity'
      ? `Scaled by gravity: ${sc.hopsUsed} hops timed, ±${(sc.rel * 100).toFixed(1)} per cent.${sc.kneesChecked ? '' : ' This device was too slow to watch the knees as well, so a hop with bent knees would not have been caught.'}`
      : `Scaled by your eyes alone, ±${(sc.rel * 100).toFixed(1)} per cent — hopping would narrow it to about one.`;
  a.innerHTML = `
  <div class="verdict">
    <p class="eyebrow">Your size</p>
    <p class="verdict__size">${esc(v.best.name)}</p>
    <p class="verdict__alt">${
      v.second && v.pSecond >= 0.05 ? `${pct(v.pBest)} ${esc(v.best.name)}; ${pct(v.pSecond)} ${esc(v.second.name)}.` : `${pct(v.pBest)} ${esc(v.best.name)}.`
    } ${
      v.offChart
        ? `Your chest is over the largest size's ${v.best.chestCm} cm: BEST can cut one to measure.`
        : v.largerIsSafer
          ? `Your chest is ${(-v.roomCm).toFixed(1)} cm over the ${esc(v.best.name)} figure, so it would be tight — ${esc(v.second.name)} is the safer order.`
          : `That leaves ${v.roomCm.toFixed(1)} cm of room before any allowance of your own.`
    }</p>
    ${v.coinToss ? `<p class="note note--warn">The two sizes are close to a coin toss at this margin. Try both on if you can.</p>` : ''}
  </div>
  <div class="figures">
    <div class="figure"><p class="figure__k">Chest</p><p class="figure__v">${R.chestCm.toFixed(1)} cm</p><p class="figure__n">± ${R.errCm.toFixed(1)} cm${R.turnCm ? ', measured all the way round' : ', from width and depth'}</p></div>
    ${sc.heightM ? `<div class="figure"><p class="figure__k">Height</p><p class="figure__v">${(sc.heightM * 100).toFixed(0)} cm</p><p class="figure__n">in your shoes, ± ${Math.hypot(HEIGHT_LANDMARK_CM, sc.heightM * 100 * sc.rel).toFixed(0)} cm — nobody asked</p></div>` : ''}
    <div class="figure"><p class="figure__k">Across · deep</p><p class="figure__v">${R.widthCm.toFixed(1)} · ${R.depthCm.toFixed(1)}</p><p class="figure__n">cm, from the two pictures</p></div>
  </div>
  <p class="note">${esc(scaleLine)} ${esc(irisLine)}</p>
  ${S.irisCheck && S.irisCheck.verdict !== 'agree' ? `<p class="note note--warn">The two rulers disagree. Hop again, knees straight, and see if the answer holds.</p>` : ''}
  <table class="chart"><thead><tr><th>Size</th><th>Chest</th><th>Length</th><th>Chance</th></tr></thead><tbody>${rows}</tbody></table>
  <details class="hops"><summary>How it was measured</summary>
    <p class="note">Each dot is where your shoulders were in one frame; each curve is free fall fitted through a flight. Their bend is gravity, ${sc.source === 'gravity' ? `${(sc.fit.accel.mag).toFixed(0)} pixels per second per second here, which is ${sc.pxPerMetre.toFixed(1)} pixels to the metre where you stood.` : ''}</p>
    ${sc.source === 'gravity' ? hopSvg(sc) : ''}
    <p class="note">${
      R.turnCm
        ? `Measured all the way round: the quarter turn gives ${R.turnCm.toFixed(1)} cm (π times the chest's mean width over the turn — Cauchy's formula, the length a tape follows). From the width and depth alone, BEST's fit to tape-measured bodies gives ${R.twoViewCm.toFixed(1)} cm. ${
            R.fused && R.fused.agree
              ? `They agree to ${Math.abs(R.fused.diffCm).toFixed(1)} cm, and the answer weighs them by how sure each is.`
              : `They are ${Math.abs(R.fused.diffCm).toFixed(1)} cm apart — more than either should be wrong by, so the margin above is wide enough to cover both.`
          }`
        : `Chest girth from width ${R.widthCm.toFixed(1)} cm and depth ${R.depthCm.toFixed(1)} cm by BEST's fit to tape-measured bodies. A chest is not quite an ellipse, so this is a starting point rather than a fitting: BEST cut to measure.${R.turnWhyNot ? ` The quarter turn, which would have measured it all the way round, could not be read: ${esc(R.turnWhyNot)}` : ''}`
    }</p>
    <p class="note mono">clock ${esc(S.hopTiming ? `${S.hopTiming.clock}, ${S.hopTiming.periodMs.toFixed(2)} ms frames, jitter ${S.hopTiming.jitterMs.toFixed(2)} ms${S.hopTiming.regular ? ' (snapped to the frame grid)' : ''}` : '—')}</p>
  </details>
  <details class="staff" id="staff"><summary>Check against a tape (for staff)</summary>
    <p class="note">Measure height (in the shoes they hopped in) and chest by tape, before reading the answer above. The row stays on this device. See FIELD.md.</p>
    <p><label>Tape chest, cm <input id="tapeChest" inputmode="decimal" size="6"></label>
       <label>Tape height, cm <input id="tapeHeight" inputmode="decimal" size="6"></label>
       <button type="button" id="saveRow">Save this row</button></p>
    <p><button type="button" id="downloadRows">Download the rows</button> <button type="button" id="clearRows">Clear them</button> <span id="rowCount"></span></p>
  </details>
  <button class="again" onclick="location.reload()">Measure someone else</button>`;
  wireStaff();
}

// ——— staff: rows against a tape, kept on this device only ———
const ROWS_KEY = 'best.hop.rows';
function readRows() {
  try {
    return JSON.parse(localStorage.getItem(ROWS_KEY) || '[]');
  } catch {
    return [];
  }
}
function writeRows(rows) {
  try {
    localStorage.setItem(ROWS_KEY, JSON.stringify(rows.slice(-500)));
  } catch {}
}
function rowNow(tapeChest, tapeHeight) {
  const R = S.result;
  const sc = S.scale;
  return {
    when: new Date().toISOString(),
    tapeChestCm: tapeChest,
    tapeHeightCm: tapeHeight,
    chestCm: +R.chestCm.toFixed(1),
    chestErrCm: +R.errCm.toFixed(1),
    widthCm: +R.widthCm.toFixed(1),
    turnCm: R.turnCm ? +R.turnCm.toFixed(1) : '',
    twoViewCm: +R.twoViewCm.toFixed(1),
    method: R.method,
    depthCm: +R.depthCm.toFixed(1),
    heightCm: sc.heightM ? +(sc.heightM * 100).toFixed(1) : '',
    size: R.verdict.best.name,
    secondSize: R.verdict.second ? R.verdict.second.name : '',
    scaleSource: sc.source,
    scaleRelPct: +(sc.rel * 100).toFixed(2),
    hopsUsed: sc.hopsUsed ?? '',
    hopsDropped: sc.hopsDropped ?? '',
    kneesChecked: sc.kneesChecked ?? '',
    irisRatio: S.irisCheck ? +S.irisCheck.ratio.toFixed(4) : '',
    irisVerdict: S.irisCheck ? S.irisCheck.verdict : '',
    clock: S.hopTiming ? S.hopTiming.clock : '',
    framePeriodMs: S.hopTiming ? +S.hopTiming.periodMs.toFixed(3) : '',
    jitterMs: S.hopTiming ? +S.hopTiming.jitterMs.toFixed(3) : '',
    pitchDeg: S.attitude ? +((S.attitude.pitchRad * 180) / Math.PI).toFixed(1) : '',
    video: `${S.W}x${S.H}`,
  };
}
function wireStaff() {
  const count = () => ($('rowCount').textContent = `${readRows().length} rows kept`);
  count();
  $('saveRow').onclick = () => {
    const c = parseFloat($('tapeChest').value);
    const h = parseFloat($('tapeHeight').value);
    if (!(c > 50 && c < 220)) return ($('rowCount').textContent = 'The tape chest is needed, in cm.');
    writeRows([...readRows(), rowNow(c, h > 100 && h < 250 ? h : '')]);
    count();
  };
  $('downloadRows').onclick = () => {
    const rows = readRows();
    if (!rows.length) return;
    const keys = Object.keys(rows[0]);
    const csv = [keys.join(','), ...rows.map((r) => keys.map((k) => JSON.stringify(r[k] ?? '')).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'hop-rows.csv';
    a.click();
  };
  $('clearRows').onclick = () => {
    if (confirm('Clear every saved row on this device?')) {
      writeRows([]);
      count();
    }
  };
}

function hopSvg(sc) {
  const s = sc.samples;
  if (!s.length) return '';
  const t0 = s[0].t;
  const t1 = s[s.length - 1].t;
  const vs = s.map((q) => q.v);
  const vmin = Math.min(...vs);
  const vmax = Math.max(...vs);
  const W = 640;
  const H = 200;
  const X = (t) => 10 + ((t - t0) / (t1 - t0 || 1)) * (W - 20);
  const Y = (v) => 10 + ((v - vmin) / (vmax - vmin || 1)) * (H - 20);
  const dots = s.map((q) => `<circle cx="${X(q.t).toFixed(1)}" cy="${Y(q.v).toFixed(1)}" r="1.6" fill="#4a5155"/>`).join('');
  const A = sc.fit.accel.v;
  const arcs = sc.fit.arcs
    .map((a) => {
      const pts = s.filter((q) => q.t >= a.t0 && q.t <= a.t1);
      if (pts.length < 3) return '';
      // least-squares position and velocity with the shared acceleration
      const tm = pts.reduce((x, q) => x + q.t, 0) / pts.length;
      const r = pts.map((q) => q.v - (A * (q.t - tm) ** 2) / 2);
      const st = pts.reduce((x, q) => x + (q.t - tm), 0);
      const stt = pts.reduce((x, q) => x + (q.t - tm) ** 2, 0);
      const sy = r.reduce((x, y) => x + y, 0);
      const sty = pts.reduce((x, q, k) => x + (q.t - tm) * r[k], 0);
      const n = pts.length;
      const det = n * stt - st * st;
      const b0 = (stt * sy - st * sty) / det;
      const b1 = (n * sty - st * sy) / det;
      let d = '';
      for (let k = 0; k <= 24; k++) {
        const t = a.t0 + ((a.t1 - a.t0) * k) / 24;
        const v = b0 + b1 * (t - tm) + (A * (t - tm) ** 2) / 2;
        d += `${k ? 'L' : 'M'}${X(t).toFixed(1)},${Y(v).toFixed(1)}`;
      }
      return `<path d="${d}" fill="none" stroke="#0e5c61" stroke-width="2"/>`;
    })
    .join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Height of the shoulders against time, with the free-fall curves fitted through each hop">${dots}${arcs}</svg>`;
}

// ——— drawing over the picture ———
function ctx2d() {
  const c = $('overlay');
  const x = c.getContext('2d');
  x.clearRect(0, 0, c.width, c.height);
  return x;
}
function drawPose(p) {
  const x = ctx2d();
  if (!p) return;
  x.fillStyle = 'rgba(95,208,196,.9)';
  for (const q of p.landmarks) {
    if (q.visibility !== undefined && q.visibility < 0.5) continue;
    x.beginPath();
    x.arc(q.x * S.W, q.y * S.H, Math.max(2, S.W / 240), 0, 2 * Math.PI);
    x.fill();
  }
  if (DEBUG) hud();
}
function drawRow(l, r, y) {
  const x = $('overlay').getContext('2d');
  x.strokeStyle = '#f4c84a';
  x.lineWidth = Math.max(2, S.W / 300);
  x.beginPath();
  x.moveTo(l, y);
  x.lineTo(r, y);
  x.stroke();
}
function drawHop(H) {
  const x = ctx2d();
  const s = H.samples[H.samples.length - 1];
  if (s) {
    x.strokeStyle = 'rgba(95,208,196,.9)';
    x.lineWidth = Math.max(2, S.W / 300);
    x.strokeRect(H.box.x0 + s.dx, H.box.y0 + s.dy, H.box.x1 - H.box.x0, H.box.y1 - H.box.y0);
  }
  x.fillStyle = '#f4c84a';
  for (const q of H.samples.slice(-90)) x.fillRect(q.u - 1, q.v - 1, 2, 2);
  if (DEBUG) hud();
}
function hud() {
  const r = S.level.read();
  $('hud').textContent = [
    `${S.W}×${S.H} ${S.clock || ''}`,
    r ? `pitch ${((r.pitchRad * 180) / Math.PI).toFixed(1)} roll ${((r.rollRad * 180) / Math.PI).toFixed(1)}` : 'no level',
    S.hop ? `samples ${S.hop.samples.length} hops ${S.hop.count}` : '',
  ].join('\n');
}
