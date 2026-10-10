/**
 * WHICH WAY IS DOWN.
 *
 * The tablet knows. Its accelerometer, at rest, reads the reaction to gravity,
 * and for a front camera the screen's normal is the camera's line of sight, so
 * the pitch and roll of the camera come straight out of three numbers the
 * browser hands over (DeviceMotionEvent.accelerationIncludingGravity; iOS asks
 * permission first, from a tap).
 *
 * Two uses. Before anything, a level on the screen: a camera stood upright,
 * pointing at the chest, is the one where nothing below needs correcting. And
 * after, rectification: every tracked point is turned into what a level camera
 * in the same place would have seen. In that picture free fall is straight down
 * and a parabola exactly — the horizontal distance to a body falling straight
 * down does not change — so the gravity ruler reads f / Z directly, with Z the
 * level distance, and widths read in the same picture use the same Z.
 *
 * Conventions. Image: u right, v down, pixels. Pitch: positive when the camera
 * looks down. Roll: positive when the camera is turned clockwise about its line
 * of sight as seen from behind it (its "right" lifted). Same as sim/hopper.mjs.
 */

/** Camera axes in world coordinates (x right, y up, z ahead), for a pitch and roll. */
export function cameraBasis(pitchRad, rollRad) {
  const fw = [0, -Math.sin(pitchRad), Math.cos(pitchRad)];
  const up0 = [0, Math.cos(pitchRad), Math.sin(pitchRad)];
  const right0 = [1, 0, 0];
  const c = Math.cos(rollRad);
  const s = Math.sin(rollRad);
  const right = right0.map((x, i) => c * x + s * up0[i]);
  const up = up0.map((x, i) => c * x - s * right0[i]);
  return { right, up, fw };
}

/**
 * Where a level, unrolled camera at the same place, with the same focal length
 * and centre, would have seen the point (u, v).
 */
export function makeRectifier({ pitchRad = 0, rollRad = 0, focalPx, cx, cy }) {
  const { right, up, fw } = cameraBasis(pitchRad, rollRad);
  return (u, v) => {
    const X = (u - cx) / focalPx;
    const Y = (v - cy) / focalPx; // image down
    // world direction of the ray: X right − Y up + 1 ahead
    const wx = X * right[0] - Y * up[0] + fw[0];
    const wy = X * right[1] - Y * up[1] + fw[1];
    const wz = X * right[2] - Y * up[2] + fw[2];
    return { u: cx + (focalPx * wx) / wz, v: cy - (focalPx * wy) / wz };
  };
}

/**
 * Camera pitch and roll from the accelerometer.
 *
 * `a` is accelerationIncludingGravity {x, y, z} in device axes (x towards the
 * right edge of the screen in its natural orientation, y towards the top, z out
 * of the screen). `screenAngleDeg` is screen.orientation.angle: the user
 * interface is turned that far anticlockwise from natural. `sign` is +1 where
 * the platform follows the specification (at rest the reading points up) and −1
 * where it reports gravity itself; see detectSign.
 *
 * For the front camera the line of sight is +z. Up in the picture is the
 * device's "top of the user interface" axis.
 */
export function attitudeFromGravity(a, screenAngleDeg = 0, sign = 1) {
  const x = sign * a.x;
  const y = sign * a.y;
  const z = sign * a.z;
  // turn device x/y so that y' is the top of the interface as it is shown
  const th = (screenAngleDeg * Math.PI) / 180;
  const xr = x * Math.cos(th) - y * Math.sin(th);
  const yr = x * Math.sin(th) + y * Math.cos(th);
  const g = Math.hypot(xr, yr, z);
  if (!(g > 1)) return null;
  // up (the reading) in camera axes: camera right is −x' for a front camera
  // (it faces the other way to the screen's viewer), camera up is y', and the
  // line of sight is +z. A camera looking down sees "up" tipped towards it.
  const upRight = -xr / g;
  const upUp = yr / g;
  const upAhead = z / g;
  const pitchRad = Math.atan2(-upAhead, Math.hypot(upRight, upUp)); // looking down: up points back
  const rollRad = Math.atan2(upRight, upUp);
  return { pitchRad, rollRad, g, tiltDeg: (Math.acos(Math.min(1, upUp)) * 180) / Math.PI };
}

/**
 * Which way round this platform reports gravity. Upright on a stand, the top of
 * the interface points up, so the reading along it is positive by the
 * specification. If it is negative the platform reports the other way.
 */
export function detectSign(a, screenAngleDeg = 0) {
  const th = (screenAngleDeg * Math.PI) / 180;
  const yr = a.x * Math.sin(th) + a.y * Math.cos(th);
  return yr >= 0 ? 1 : -1;
}

/**
 * Averages accelerometer readings while the device stays still, and reports
 * the attitude and whether it has settled. Feed it devicemotion events.
 */
export class Level {
  constructor({ window: n = 30 } = {}) {
    this.n = n;
    this.buf = [];
    this.sign = null;
  }
  push(a, screenAngleDeg) {
    if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(a.z)) return;
    this.buf.push({ x: a.x, y: a.y, z: a.z });
    if (this.buf.length > this.n) this.buf.shift();
    this.screenAngleDeg = screenAngleDeg;
  }
  read() {
    if (this.buf.length < Math.min(10, this.n)) return null;
    const m = { x: 0, y: 0, z: 0 };
    for (const b of this.buf) {
      m.x += b.x / this.buf.length;
      m.y += b.y / this.buf.length;
      m.z += b.z / this.buf.length;
    }
    let jitter = 0;
    for (const b of this.buf) jitter = Math.max(jitter, Math.hypot(b.x - m.x, b.y - m.y, b.z - m.z));
    // which way round this platform reports gravity can only be told with the
    // device standing up: lying on a counter, a hair either way decides it
    // wrongly, and then everything reads upside down (a roll of 180 degrees).
    // So until it is upright there is no reading, and once it is, the sign
    // is fixed
    if (this.sign === null) {
      const th = ((this.screenAngleDeg || 0) * Math.PI) / 180;
      const yr = m.x * Math.sin(th) + m.y * Math.cos(th);
      if (!(Math.abs(yr) > 0.7 * Math.hypot(m.x, m.y, m.z))) return { upright: false, still: false };
      this.sign = detectSign(m, this.screenAngleDeg);
    }
    const att = attitudeFromGravity(m, this.screenAngleDeg, this.sign);
    if (!att) return null;
    // a device being handled shakes by more than a tenth of a metre per second
    // squared; one on a stand by far less
    return { ...att, upright: true, still: jitter < 0.15, jitter };
  }
}
