/**
 * THE CAMERA, AND THE TIME OF EVERY FRAME.
 *
 * One camera — the front one, so the customer can see what they are doing —
 * opened once, inside a tap, and kept until the end. No microphone: the August
 * page opened one for a sonar that its own diagnostic showed was measuring the
 * tablet, and a permission prompt nobody needs is a reason to stop.
 *
 * Frames arrive through requestVideoFrameCallback, with the clock chosen by
 * timing.js. Sixty frames a second is asked for and thirty accepted: the
 * gravity ruler's scatter falls by about a third at sixty (0.57 to 0.37 per
 * cent on the simulator), and is under one per cent at thirty.
 */
import { frameTime } from './timing.js';

/** Why the camera could not be opened, in words a customer can act on. */
export function cameraError(err) {
  const name = err && err.name;
  if (!window.isSecureContext) return 'This page has to be opened over https for the camera to work.';
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return 'This browser does not offer the camera to web pages.';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return window.top !== window
      ? 'The camera is blocked inside this frame. Open the page on its own.'
      : 'The camera was not allowed. Allow it in the browser’s settings for this site, then try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'The camera is in use by another app. Close it and try again.';
  return `The camera would not start (${name || err}).`;
}

/**
 * Open the front camera, as sharp and as fast as it will go. Resolves to
 * { stream, track, video, settings }.
 */
export async function openCamera(video) {
  const portrait = window.matchMedia && window.matchMedia('(orientation: portrait)').matches;
  const want = (fps) => ({
    audio: false,
    video: {
      facingMode: 'user',
      width: { ideal: portrait ? 720 : 1280 },
      height: { ideal: portrait ? 1280 : 720 },
      frameRate: { ideal: fps },
      resizeMode: 'none',
    },
  });
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(want(60));
  } catch (e) {
    if (e && e.name === 'OverconstrainedError') stream = await navigator.mediaDevices.getUserMedia(want(30));
    else throw e;
  }
  const track = stream.getVideoTracks()[0];
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  // some cameras take a moment to report their real size
  for (let i = 0; i < 50 && !video.videoWidth; i++) await new Promise((r) => setTimeout(r, 20));
  return { stream, track, video, settings: track.getSettings ? track.getSettings() : {} };
}

export function closeCamera(stream) {
  if (stream) for (const t of stream.getTracks()) t.stop();
}

/**
 * Calls onFrame({ t, source, now, presented }) once per camera frame, with t
 * in seconds on the best clock available. Returns a stop function.
 *
 * Frames the page was too busy to be told about show up as a gap in
 * `presented`; the gravity fit sees them as missing samples, which it handles.
 */
export function everyFrame(video, onFrame) {
  let stopped = false;
  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
    // After a callback that ran long, the next frame's stamp may not be its
    // own: Safari hands over the newest pixels with the oldest waiting frame's
    // capture time (MediaPlayerPrivateMediaStreamAVFObjC). That frame is
    // flagged, and the hop tracker leaves it out.
    let lastMs = 0;
    let lastT = NaN;
    let period = 1 / 30;
    const step = (now, meta) => {
      if (stopped) return;
      const { t, source } = frameTime(now, meta);
      if (Number.isFinite(lastT) && t > lastT) period = 0.9 * period + 0.1 * Math.min(0.1, t - lastT);
      const afterStall = lastMs > 1500 * period;
      lastT = t;
      const t0 = performance.now();
      try {
        onFrame({ t, source, now, presented: meta.presentedFrames, width: meta.width, height: meta.height, afterStall });
      } finally {
        lastMs = performance.now() - t0;
        if (!stopped) video.requestVideoFrameCallback(step);
      }
    };
    video.requestVideoFrameCallback(step);
  } else {
    // old browsers: animation frames, deduplicated by the video's own clock
    let last = -1;
    const step = (now) => {
      if (stopped) return;
      const mt = video.currentTime;
      if (mt !== last) {
        last = mt;
        try {
          onFrame({ t: now / 1000, source: 'callback', now, presented: undefined, width: video.videoWidth, height: video.videoHeight });
        } catch (e) {
          console.error(e);
        }
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  return () => {
    stopped = true;
  };
}

/**
 * Pixels out of the current video frame. Grey for the tracker, a whole RGBA
 * frame only when something needs colour. One canvas, reused.
 */
export class FrameGrabber {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.gray = null;
  }
  /** Grey levels of the region {x, y, w, h} of the video (integers), as Float32Array. */
  grayRegion(video, x, y, w, h) {
    x = Math.max(0, Math.floor(x));
    y = Math.max(0, Math.floor(y));
    w = Math.max(1, Math.min(video.videoWidth - x, Math.ceil(w)));
    h = Math.max(1, Math.min(video.videoHeight - y, Math.ceil(h)));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ctx.drawImage(video, x, y, w, h, 0, 0, w, h);
    const d = this.ctx.getImageData(0, 0, w, h).data;
    const n = w * h;
    if (!this.gray || this.gray.length !== n) this.gray = new Float32Array(n);
    const g = this.gray;
    for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
    return { gray: g, x, y, w, h };
  }
}
