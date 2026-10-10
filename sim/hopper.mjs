/**
 * A person hopping on the spot, seen by a camera on a stand.
 *
 * This is the test bench for the gravity ruler, not a claim about real people.
 * It produces what the page would see — a tracked point on the trunk, in pixels,
 * stamped with the time each frame was captured — from a physical model whose
 * true scale is known, so every way the estimate can go wrong can be switched on
 * one at a time and its cost read off in per cent.
 *
 * World: metres, Y up, the camera at the origin looking along +Z (pitched down by
 * `pitchDeg`, rolled by `rollDeg`). The person stands `distance` metres away.
 *
 * Hopping: centre of mass in free fall between take-off and landing (that is the
 * whole point), and on the ground a half-sine that brings it back up with the
 * same speed it landed with — the standard spring-mass picture of hopping, with a
 * peak ground force of two to three times body weight.
 */

/** Small seeded PRNG (mulberry32), so a failing case can be replayed exactly. */
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () => {
    let u = 0;
    while (u === 0) u = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
  };
  return { next, normal, uniform: (lo, hi) => lo + (hi - lo) * next() };
}

export const G = 9.81;

export const DEFAULTS = {
  seed: 1,
  g: G,
  // camera
  fps: 30,
  width: 720,
  height: 1280,
  vfovDeg: 62, // a phone or iPad front camera in portrait, roughly
  pitchDeg: 0,
  rollDeg: 0,
  cameraHeight: 1.3, // metres above the floor
  // person
  distance: 2.4, // metres to the trunk
  trunkHeight: 1.35, // height of the tracked point above the floor at rest
  lateral: 0, // metres right of the optical axis
  // hopping
  hops: 5,
  standBefore: 0.8, // seconds still before the first hop
  standAfter: 0.8,
  flightTime: 0.26, // seconds, mean
  flightJitter: 0.03, // SD between hops
  contactTime: 0.22,
  contactJitter: 0.03,
  sink: 0.04, // metres the trunk is higher at take-off than standing (up on the toes)
  // ways the real thing differs from the ideal
  noisePx: 0.4, // tracker noise, per axis, SD
  outlierRate: 0,
  outlierPx: 12,
  timeJitterMs: 0, // SD of the timestamp error
  dropRate: 0, // chance a frame is lost
  readoutMs: 0, // rolling shutter, top row to bottom row
  readoutAxis: 'v', // 'v': rows down the image (sensor native), 'u': across it
  exposureMs: 0, // motion blur: position averaged over the exposure
  driftZ: 0, // metres per second towards (−) or away from (+) the camera
  driftX: 0, // metres per second sideways
  tuckMm: 0, // trunk moving against the centre of mass in flight (legs tucking)
  tuckShape: 'late', // 'late': before landing, 'sym': through the flight
  headBobMm: 0, // trunk wobble on landing, decaying
  // what the pose model says about the centre of mass against the trunk:
  // the true offset (the tuck, undone) plus landmark noise, per frame
  comNoisePx: 0.5,
};

/** Quintic Hermite between two (y, v, a) states over duration T. */
function quintic(T, y0, v0, a0, y1, v1, a1) {
  // y(s) with s = tau, coefficients solved for the six end conditions
  const T2 = T * T;
  const T3 = T2 * T;
  const T4 = T3 * T;
  const T5 = T4 * T;
  const c0 = y0;
  const c1 = v0;
  const c2 = a0 / 2;
  const dy = y1 - (c0 + c1 * T + c2 * T2);
  const dv = v1 - (c1 + 2 * c2 * T);
  const da = a1 - 2 * c2;
  // solve [T3 T4 T5; 3T2 4T3 5T4; 6T 12T2 20T3] [c3 c4 c5] = [dy dv da]
  const c3 = (10 * dy) / T3 - (4 * dv) / T2 + da / (2 * T);
  const c4 = (-15 * dy) / T4 + (7 * dv) / T3 - da / T2;
  const c5 = (6 * dy) / T5 - (3 * dv) / T4 + da / (2 * T3);
  return (tau) => c0 + tau * (c1 + tau * (c2 + tau * (c3 + tau * (c4 + tau * c5))));
}

/**
 * The hop schedule: a list of phases, each with its start time, duration and a
 * function giving the centre of mass height (metres, relative to standing) at a
 * time into the phase. Positions and speeds are continuous across phases.
 */
function makeHopSchedule(p, r) {
  const phases = [];
  const g = p.g;
  let t = p.standBefore;
  let y = 0; // standing
  let v = 0;
  const lift = p.sink; // take-off on the toes, legs straight: a little above standing
  let flightTimes = [];
  for (let k = 0; k < p.hops; k++) flightTimes.push(Math.max(0.12, p.flightTime + p.flightJitter * r.normal()));
  for (let k = 0; k < p.hops; k++) {
    const Tf = flightTimes[k];
    const vOut = (g * Tf) / 2;
    const Tc = Math.max(0.12, p.contactTime + p.contactJitter * r.normal());
    if (k === 0) {
      // counter-movement from standing to the first take-off
      const T = Tc * 1.6;
      const fn = quintic(T, 0, 0, 0, lift, vOut, -g);
      phases.push({ kind: 'contact', t0: t, T, y: fn });
      t += T;
      y = lift;
    } else {
      // ground force a half-sine pulse: zero at landing and at take-off, so the
      // trunk leaves and rejoins free fall smoothly — the hard case for anything
      // that has to tell flight from contact
      const vIn = v; // negative
      const Fm = (Math.PI * (vOut - vIn + g * Tc)) / (2 * Tc); // peak force / mass
      const y0 = y;
      const fn = (tau) =>
        y0 + vIn * tau - 0.5 * g * tau * tau + Fm * (Tc / Math.PI) * (tau - (Tc / Math.PI) * Math.sin((Math.PI * tau) / Tc));
      phases.push({ kind: 'contact', t0: t, T: Tc, y: fn, peakG: Fm / g });
      t += Tc;
      y = fn(Tc);
    }
    const y0 = y;
    phases.push({ kind: 'flight', t0: t, T: Tf, hop: k, y: (tau) => y0 + vOut * tau - 0.5 * g * tau * tau });
    t += Tf;
    v = -vOut;
    y = y0; // lands where it took off
  }
  // last landing, settling back to standing
  const T = p.contactTime * 2;
  const fn = quintic(T, y, v, -g, 0, 0, 0);
  phases.push({ kind: 'contact', t0: t, T, y: fn });
  t += T;
  return { phases, end: t + p.standAfter };
}

/** Centre of mass height relative to standing, at time t. */
function comHeight(sched, t) {
  for (const ph of sched.phases) {
    if (t < ph.t0 || t > ph.t0 + ph.T) continue;
    const tau = t - ph.t0;
    return { y: ph.y(tau), flight: ph.kind === 'flight', hop: ph.hop, tau, T: ph.T };
  }
  return { y: 0, flight: false };
}

/**
 * Simulate. Returns { samples: [{t, u, v}], truth: { pxPerMetre, ... } }.
 * pxPerMetre is f / Z at the trunk at rest — the number the estimate is for.
 */
export function simulate(opts = {}) {
  const p = { ...DEFAULTS, ...opts };
  const r = rng(p.seed);
  const sched = makeHopSchedule(p, r);
  const f = p.height / 2 / Math.tan(((p.vfovDeg / 2) * Math.PI) / 180);
  const cx = p.width / 2;
  const cy = p.height / 2;
  const pitch = (p.pitchDeg * Math.PI) / 180;
  const roll = (p.rollDeg * Math.PI) / 180;

  // camera basis in world coordinates (pitched down by `pitch`, then rolled)
  // forward
  const fw = [0, -Math.sin(pitch), Math.cos(pitch)];
  // up before roll
  const up0 = [0, Math.cos(pitch), Math.sin(pitch)];
  const right0 = [1, 0, 0];
  const right = right0.map((x, i) => Math.cos(roll) * x + Math.sin(roll) * up0[i]);
  const up = up0.map((x, i) => Math.cos(roll) * x - Math.sin(roll) * right0[i]);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  const project = (P) => {
    const rel = [P[0], P[1] - p.cameraHeight, P[2]];
    const Xc = dot(rel, right);
    const Yc = -dot(rel, up); // image v grows downwards
    const Zc = dot(rel, fw);
    return { u: cx + (f * Xc) / Zc, v: cy + (f * Yc) / Zc, Z: Zc };
  };

  const trunkAt = (t) => {
    const c = comHeight(sched, t);
    let off = 0;
    if (c.flight && p.tuckMm) {
      const x = c.tau / c.T;
      const shape = p.tuckShape === 'late' ? Math.max(0, (x - 0.5) * 2) ** 2 : Math.sin(Math.PI * x);
      off -= (p.tuckMm / 1000) * shape; // trunk sinks against the centre of mass
    }
    if (p.headBobMm) {
      // after each landing, a decaying wobble
      for (const ph of sched.phases) {
        if (ph.kind !== 'contact' || t < ph.t0) continue;
        const tau = t - ph.t0;
        if (tau < 0.5) off += (p.headBobMm / 1000) * Math.exp(-tau / 0.08) * Math.sin(2 * Math.PI * 9 * tau);
      }
    }
    const P = [
      p.lateral + p.driftX * t,
      p.trunkHeight + c.y + off,
      p.distance * Math.cos(pitch) + p.driftZ * t, // so the trunk sits near the optical axis when pitched
    ];
    return { P, flight: c.flight, off };
  };

  // where the trunk sits at rest; pxPerMetre is defined there
  const rest = project(trunkAt(0).P);
  // and where it is in the middle of the hopping, which differs only if the
  // person drifts towards or away from the camera while they hop
  const flights = sched.phases.filter((x) => x.kind === 'flight');
  const tMid = flights.reduce((s, x) => s + x.t0 + x.T / 2, 0) / flights.length;
  const mid = project(trunkAt(tMid).P);
  const truth = {
    f,
    Z: rest.Z,
    pxPerMetre: f / rest.Z,
    pxPerMetreHops: f / mid.Z,
    restU: rest.u,
    restV: rest.v,
    pitchDeg: p.pitchDeg,
    rollDeg: p.rollDeg,
    flightPhases: sched.phases.filter((x) => x.kind === 'flight').map((x) => ({ t0: x.t0, t1: x.t0 + x.T })),
    // project a point given relative to the trunk at rest (metres, x right,
    // y up, z away from the camera), for checking a width measured in the picture
    projectFromTrunk: (dx, dy, dz = 0, t = 0) => {
      const P = trunkAt(t).P;
      return project([P[0] + dx, P[1] + dy, P[2] + dz]);
    },
    cx,
    cy,
    end: sched.end,
  };

  const samples = [];
  const dt = 1 / p.fps;
  const n = Math.floor(sched.end / dt);
  for (let i = 0; i < n; i++) {
    if (p.dropRate && r.next() < p.dropRate) continue;
    const tNominal = i * dt;
    // first pass: where is it, to know which row it is on (rolling shutter)
    let pos = project(trunkAt(tNominal).P);
    let tCap = tNominal;
    if (p.readoutMs) {
      const frac = p.readoutAxis === 'v' ? pos.v / p.height : pos.u / p.width;
      tCap = tNominal + (frac * p.readoutMs) / 1000;
      pos = project(trunkAt(tCap).P);
    }
    if (p.exposureMs) {
      let su = 0;
      let sv = 0;
      const K = 7;
      for (let k = 0; k < K; k++) {
        const te = tCap + ((k / (K - 1) - 0.5) * p.exposureMs) / 1000;
        const q = project(trunkAt(te).P);
        su += q.u;
        sv += q.v;
      }
      pos = { u: su / K, v: sv / K };
    }
    let u = pos.u + p.noisePx * r.normal();
    let v = pos.v + p.noisePx * r.normal();
    if (p.outlierRate && r.next() < p.outlierRate) {
      u += p.outlierPx * r.normal();
      v += p.outlierPx * r.normal();
    }
    const t = tNominal + (p.timeJitterMs / 1000) * r.normal();
    // centre of mass minus trunk, in picture pixels (v down): the trunk sits
    // `off` metres above the centre of mass, so the centre of mass is `off`
    // metres below it in the picture
    const offNow = trunkAt(tCap).off;
    const comOffsetV = offNow * (f / pos.Z || f / p.distance) + p.comNoisePx * r.normal();
    samples.push({ t, u, v, comOffsetV });
  }
  return { samples, truth, params: p };
}

/**
 * The centre of mass alone, for drawing a video of a hop (test/e2e): height in
 * metres above standing at any time, the flights, and when it all ends.
 */
export function hopTrajectory(opts = {}) {
  const p = { ...DEFAULTS, ...opts };
  const r = rng(p.seed);
  const sched = makeHopSchedule(p, r);
  return {
    at: (t) => comHeight(sched, t).y,
    end: sched.end,
    flights: sched.phases.filter((x) => x.kind === 'flight').map((x) => ({ t0: x.t0, t1: x.t0 + x.T })),
  };
}
