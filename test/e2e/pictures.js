// The two pictures a photograph cannot pose for — arms out facing, arms up
// side on — drawn here instead, for the end-to-end test only. Injected into
// the page before it loads (run.mjs); the page's own pose model is used for
// everything else, and for these two stages this answers in its place with a
// person whose chest is a known width and depth, at the true scale of the
// video, standing a little nearer than they hopped (so carrying the scale
// from the hops to the pictures is tested too).
//
// window.__scanTruth = { pxPerMetre, widthM, depthM, nearer, n } is set by
// run.mjs, pxPerMetre at the body's middle plane.
//
// Side on, the person TURNS: facing with arms up, then a quarter turn to the
// left that is slow at the ends and quick in the middle, then still. The
// trunk's cross-section is a superellipse |x/a|^n + |y/b|^n = 1 (squarer than
// an ellipse, as chests are), so its width at each angle, and its perimeter —
// what a tape would read — are known.
//
// The person stands OFF a little to one side of the camera's line, and the
// turn is drawn in perspective (a pinhole at the page's own nominal focal
// length): the chest's outline and the two shoulders are projected from
// where they are in the room, so the shoulders' span is the cosine of the
// angle to the line of sight, not to the camera's axis; the near shoulder is
// drawn lower or higher than the far one, as a camera below the shoulders
// sees them; and side on the near heel is drawn lower, as it is nearer the
// camera — which would change the nose-to-heel ruler during the turn. The
// person turns until one shoulder points at the tablet, as asked.
(() => {
  const T = () => window.__scanTruth;
  let sideFrame = 0;
  let lastStage = '';
  let section = null;
  function crossSection(a, b, n) {
    const pts = [];
    for (let k = 0; k < 2000; k++) {
      const t = (2 * Math.PI * k) / 2000;
      const c = Math.cos(t);
      const s = Math.sin(t);
      pts.push([a * Math.sign(c) * Math.abs(c) ** (2 / n), b * Math.sign(s) * Math.abs(s) ** (2 / n)]);
    }
    let P = 0;
    for (let k = 0; k < pts.length; k++) P += Math.hypot(pts[(k + 1) % pts.length][0] - pts[k][0], pts[(k + 1) % pts.length][1] - pts[k][1]);
    const width = (th) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const [x, y] of pts) {
        const q = x * Math.cos(th) + y * Math.sin(th);
        if (q < lo) lo = q;
        if (q > hi) hi = q;
      }
      return hi - lo;
    };
    // the outline's extent across the picture, in pixels from the picture's
    // centre, turned th to the left and centred x0 to the right at distance Z
    const seen = (th, x0, Z, f) => {
      let lo = Infinity;
      let hi = -Infinity;
      const c = Math.cos(th);
      const s = Math.sin(th);
      for (const [x, y] of pts) {
        const u = (f * (x0 + x * c - y * s)) / (Z + x * s + y * c);
        if (u < lo) lo = u;
        if (u > hi) hi = u;
      }
      return { lo, hi };
    };
    return { P, width, seen };
  }
  // the angle turned in the room, by frames into the side stage: to where
  // the shoulder points at the camera, which for someone standing off the
  // axis is short of a right angle in the room by their angle off it
  const FACING = 36;
  const TURNING = 70;
  const OFF = 0.08; // standing this share of their distance to the right of the camera's line
  const CAMERA_BELOW_SHOULDERS = 0.4; // metres
  const angleAt = (k) => {
    if (k < FACING) return 0;
    const u = Math.min(1, (k - FACING) / TURNING);
    return ((1 - Math.cos(Math.PI * u)) / 2) * (Math.PI / 2 - Math.atan(OFF));
  };

  function body(stage, S) {
    const W = S.W;
    const H = S.H;
    // the hopping person's nose-to-heel, in pixels, as the page itself saw it
    const rest = S.hop.restLandmarks;
    const restNoseHeel = (Math.max(rest[29].y, rest[30].y) - rest[0].y) * H;
    const t = T();
    const k = t.pxPerMetre * t.nearer; // pixels per metre in these pictures
    const noseH = (restNoseHeel * t.nearer) / k; // nose above heel, metres
    const f = S.camera.focalPx;
    const Z = f / k; // the person's distance, metres
    const x0 = OFF * Z;
    const cx = W / 2 + x0 * k;
    const heelY = 0.86 * H;
    const Y = (h) => heelY - h * k;
    const X = (m) => cx + m * k;
    // a point at (lateral m, height h) of the body, dz metres further than its centre, seen through the pinhole
    const camRow = Y(0.81 * noseH - CAMERA_BELOW_SHOULDERS);
    const Pp = (xm, h, dz) => ({ x: (W / 2 + (X(xm) - W / 2) * (Z / (Z + dz))) / W, y: (camRow + (Y(h) - camRow) * (Z / (Z + dz))) / H, z: 0, visibility: 1 });
    const P = (xm, h, vis = 1) => ({ x: X(xm) / W, y: Y(h) / H, z: 0, visibility: vis });
    const sh = 0.81 * noseH;
    const hip = 0.52 * noseH;
    const knee = 0.28 * noseH;
    const L = Array.from({ length: 33 }, () => P(0, noseH));
    const front = stage === 'front';
    if (!section) section = crossSection(t.widthM / 2, t.depthM / 2, t.n);
    window.__scanTruth.perimeterM = section.P;
    const th = front ? 0 : angleAt(sideFrame);
    const c = Math.cos(th);
    // person's left is the picture's right, facing an unmirrored camera
    const sn = Math.sin(th);
    L[0] = P(0.1 * sn, noseH);
    L[2] = P(0.03 * c + 0.08 * sn, noseH + 0.03);
    L[5] = P(-0.03 * c + 0.08 * sn, noseH + 0.03);
    L[7] = P(0.075 * c - 0.02 * sn, noseH);
    L[8] = P(-0.075 * c - 0.02 * sn, noseH);
    // shoulders: the left one goes further away as they turn to their left
    L[11] = Pp(0.18 * c, sh, 0.18 * sn);
    L[12] = Pp(-0.18 * c, sh, -0.18 * sn);
    if (front) {
      L[13] = P(0.48, sh);
      L[14] = P(-0.48, sh);
      L[15] = P(0.78, sh);
      L[16] = P(-0.78, sh);
    } else {
      L[13] = P(0.12 * c, noseH + 0.05);
      L[14] = P(-0.12 * c, noseH + 0.05);
      L[15] = P(0.1 * c, noseH + 0.3);
      L[16] = P(-0.1 * c, noseH + 0.3);
    }
    for (const [i, x] of [
      [17, 0.8],
      [19, 0.82],
      [21, 0.8],
    ]) {
      L[i] = { ...L[15], x: front ? X(x) / W : L[15].x };
      L[i + 1] = { ...L[16], x: front ? X(-x) / W : L[16].x };
    }
    const hx = 0.1 * Math.max(c, 0.2);
    L[23] = P(hx, hip);
    L[24] = P(-hx, hip);
    L[25] = P(hx, knee);
    L[26] = P(-hx, knee);
    L[27] = P(hx, 0.07);
    L[28] = P(-hx, 0.07);
    // side on, the near heel is nearer the camera, so lower in the picture
    L[29] = P(hx, 0 - 0.04 * noseH * sn * sn);
    L[30] = P(-hx, 0 - 0.04 * noseH * sn * sn);
    L[31] = P(front ? hx + 0.03 : 0.12, 0.01);
    L[32] = P(front ? -hx - 0.03 : 0.12, 0.01);

    // the outline: trunk a box of the chest's width (or depth) from shoulders to
    // hips, so the chest line meets it at exactly that; arms well clear of it
    const mask = new Float32Array(W * H);
    const box = (x0m, x1m, h0, h1) => boxPx(X(x0m), X(x1m), h0, h1);
    function boxPx(xa, xb, h0, h1) {
      // antialiased: coverage of each pixel by the box
      const ya = Y(h1);
      const yb = Y(h0);
      for (let y = Math.max(0, Math.floor(ya)); y < Math.min(H, Math.ceil(yb)); y++) {
        const cy = Math.min(y + 1, yb) - Math.max(y, ya);
        for (let x = Math.max(0, Math.floor(xa)); x < Math.min(W, Math.ceil(xb)); x++) {
          const c = (Math.min(x + 1, xb) - Math.max(x, xa)) * cy;
          if (c > 0) mask[y * W + x] = Math.min(1, mask[y * W + x] + c);
        }
      }
    }
    // the trunk: the cross-section's outline at this angle, through the pinhole
    const { lo, hi } = section.seen(th, x0, Z, f);
    boxPx(W / 2 + lo, W / 2 + hi, hip - 0.05, sh + 0.02);
    // what a pinhole sees of it, across the line of sight, in metres: a
    // little more than the chest's own width, because its nearer parts are
    // nearer (run.mjs checks the page against this, and shows both)
    const across = (hi - lo) / Math.hypot(1, (lo + hi) / 2 / f) / k;
    if (front) window.__scanTruth.seenFrontM = across;
    else window.__scanTruth.seenSideM = across;
    box(-0.06, 0.06, sh, noseH - 0.05); // neck
    box(-0.08, 0.08, noseH - 0.12, noseH + 0.11); // head
    box(-0.16, -0.02, 0, hip); // legs
    box(0.02, 0.16, 0, hip);
    if (front) {
      // arms out, thin, from the trunk's sides as drawn
      box((W / 2 + hi - cx) / k - 0.01, 0.84, sh - 0.025, sh + 0.035);
      box(-0.84, (W / 2 + lo - cx) / k + 0.01, sh - 0.025, sh + 0.035);
    } else {
      box(-0.12 * c - 0.04, -0.12 * c + 0.04, sh + 0.04, noseH + 0.35); // arms up, beside the head
      box(0.12 * c - 0.04, 0.12 * c + 0.04, sh + 0.04, noseH + 0.35);
    }
    return {
      landmarks: [L],
      segmentationMasks: [{ width: W, height: H, getAsFloat32Array: () => mask, close() {} }],
    };
  }

  window.__scanWrapPose = (real) => ({
    hasMasks: real.hasMasks,
    delegate: real.delegate,
    detectForVideo(source, ts) {
      const S = window.__scan;
      if (S.stage !== lastStage) {
        lastStage = S.stage;
        sideFrame = 0;
      }
      if (T() && (S.stage === 'front' || S.stage === 'side')) {
        const r = body(S.stage, S);
        if (S.stage === 'side') sideFrame++;
        return r;
      }
      return real.detectForVideo(source, ts);
    },
    setOptions: (...a) => real.setOptions && real.setOptions(...a),
  });
})();
