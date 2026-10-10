// The two pictures a photograph cannot pose for — arms out facing, arms up
// side on — drawn here instead, for the end-to-end test only. Injected into
// the page before it loads (run.mjs); the page's own pose model is used for
// everything else, and for these two stages this answers in its place with a
// person whose chest is a known width and depth, at the true scale of the
// video, standing a little nearer than they hopped (so carrying the scale
// from the hops to the pictures is tested too).
//
// window.__scanTruth = { pxPerMetre, widthM, depthM, nearer } is set by run.mjs.
(() => {
  const T = () => window.__scanTruth;

  function body(stage, S) {
    const W = S.W;
    const H = S.H;
    // the hopping person's nose-to-heel, in pixels, as the page itself saw it
    const rest = S.hop.restLandmarks;
    const restNoseHeel = (Math.max(rest[29].y, rest[30].y) - rest[0].y) * H;
    const t = T();
    const k = t.pxPerMetre * t.nearer; // pixels per metre in these pictures
    const noseH = (restNoseHeel * t.nearer) / k; // nose above heel, metres
    const cx = W / 2;
    const heelY = 0.86 * H;
    const Y = (h) => heelY - h * k;
    const X = (m) => cx + m * k;
    const P = (xm, h, vis = 1) => ({ x: X(xm) / W, y: Y(h) / H, z: 0, visibility: vis });
    const sh = 0.81 * noseH;
    const hip = 0.52 * noseH;
    const knee = 0.28 * noseH;
    const L = Array.from({ length: 33 }, () => P(0, noseH));
    const front = stage === 'front';
    // person's left is the picture's right, facing an unmirrored camera
    const half = front ? 0.18 : 0.02;
    L[0] = P(front ? 0 : 0.1, noseH);
    L[2] = P(front ? 0.03 : 0.08, noseH + 0.03);
    L[5] = P(front ? -0.03 : 0.08, noseH + 0.03);
    L[7] = P(front ? 0.075 : -0.02, noseH);
    L[8] = P(front ? -0.075 : -0.02, noseH);
    L[11] = P(half, sh);
    L[12] = P(-half, sh);
    if (front) {
      L[13] = P(0.48, sh);
      L[14] = P(-0.48, sh);
      L[15] = P(0.78, sh);
      L[16] = P(-0.78, sh);
    } else {
      L[13] = P(0.03, noseH + 0.05);
      L[14] = P(-0.01, noseH + 0.05);
      L[15] = P(0.04, noseH + 0.3);
      L[16] = P(0.0, noseH + 0.3);
    }
    for (const [i, x] of [
      [17, 0.8],
      [19, 0.82],
      [21, 0.8],
    ]) {
      L[i] = { ...L[15], x: front ? X(x) / W : L[15].x };
      L[i + 1] = { ...L[16], x: front ? X(-x) / W : L[16].x };
    }
    const hx = front ? 0.1 : 0.02;
    L[23] = P(hx, hip);
    L[24] = P(-hx, hip);
    L[25] = P(hx, knee);
    L[26] = P(-hx, knee);
    L[27] = P(hx, 0.07);
    L[28] = P(-hx, 0.07);
    L[29] = P(hx, 0);
    L[30] = P(-hx, 0);
    L[31] = P(front ? hx + 0.03 : 0.12, 0.01);
    L[32] = P(front ? -hx - 0.03 : 0.12, 0.01);

    // the outline: trunk a box of the chest's width (or depth) from shoulders to
    // hips, so the chest line meets it at exactly that; arms well clear of it
    const mask = new Float32Array(W * H);
    const box = (x0m, x1m, h0, h1) => {
      // antialiased: coverage of each pixel by the box
      const xa = X(x0m);
      const xb = X(x1m);
      const ya = Y(h1);
      const yb = Y(h0);
      for (let y = Math.max(0, Math.floor(ya)); y < Math.min(H, Math.ceil(yb)); y++) {
        const cy = Math.min(y + 1, yb) - Math.max(y, ya);
        for (let x = Math.max(0, Math.floor(xa)); x < Math.min(W, Math.ceil(xb)); x++) {
          const c = (Math.min(x + 1, xb) - Math.max(x, xa)) * cy;
          if (c > 0) mask[y * W + x] = Math.min(1, mask[y * W + x] + c);
        }
      }
    };
    const span = front ? t.widthM : t.depthM;
    box(-span / 2, span / 2, hip - 0.05, sh + 0.02); // trunk
    box(-0.06, 0.06, sh, noseH - 0.05); // neck
    box(-0.08, 0.08, noseH - 0.12, noseH + 0.11); // head
    box(-0.16, -0.02, 0, hip); // legs
    box(0.02, 0.16, 0, hip);
    if (front) {
      box(span / 2 - 0.01, 0.84, sh - 0.025, sh + 0.035); // arms out, thin
      box(-0.84, -span / 2 + 0.01, sh - 0.025, sh + 0.035);
    } else box(-0.05, 0.07, sh, noseH + 0.35); // arms up, behind the head
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
      if (T() && (S.stage === 'front' || S.stage === 'side')) return body(S.stage, S);
      return real.detectForVideo(source, ts);
    },
    setOptions: (...a) => real.setOptions && real.setOptions(...a),
  });
})();
