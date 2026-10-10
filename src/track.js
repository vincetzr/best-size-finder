/**
 * THE TRUNK, FRAME BY FRAME.
 *
 * The gravity ruler (gravity.js) fits free fall to where the trunk is in every
 * frame of a hop, and it needs that to a fraction of a pixel: on the simulated
 * hopper 0.4 px of tracking noise is 0.7 per cent of scatter in the scale, and
 * a whole pixel is 1.4. Pose landmarks jitter by several pixels and are
 * smoothed over time, which flattens the very curvature being measured, so
 * they are not used for this. A patch of the picture is: neck, shoulders, upper
 * arms with the hands on the hips and the top of the chest are one rigid thing
 * in a stiff-legged hop, and full of edges against the background.
 *
 * The patch is cut once, from a frame of the customer standing still, and
 * every later frame is matched against that same patch — never against the
 * frame before — so an error in one frame is not carried into the next.
 *
 * Each frame is found twice over. Roughly first: the patch is slid over every
 * whole-pixel position in a window round where the caller expects it, on a
 * picture shrunk until that is cheap, and scored by zero-mean normalised
 * cross-correlation, which does not mind the camera turning its brightness up.
 * Then exactly: Lucas–Kanade on a Gaussian pyramid, coarse to fine, solving for
 * the shift together with a gain and an offset in brightness. It is the
 * inverse-compositional form: the gradients are the patch's own, not the
 * frame's, so they and the normal equations are worked out once, when the
 * reference is set, and a frame costs one pass over the patch per iteration.
 *
 * The patch is weighed in small blocks, and a block that does not match — a
 * hand across the chest, a strip of background that stays put while the body
 * moves — counts for less, so it cannot drag the answer with it.
 *
 * Image coordinates: u (x) right, v (y) down, pixels, origin top-left. A shift
 * (dx, dy) means the patch's contents now sit dx right and dy down of where
 * they were in the reference.
 */

/** Rec. 601 luma weights (ITU-R BT.601), which is what a camera's "Y" means. */
const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;

// The pyramid kernel: binomial 1 4 6 4 1 / 16, Burt and Adelson's (a = 0.375),
// a Gaussian of σ = 1 px. The finest level is smoothed with it too: that takes
// out the top octave, which is where bilinear interpolation is least faithful
// to a true shift (its error grows as the square of the frequency) and where
// sensor noise and demosaicing live.
const K0 = 6 / 16;
const K1 = 4 / 16;
const K2 = 1 / 16;
const KR = 2; // the kernel's reach, pixels each side

/** Below this correlation the match is not trusted (the brief's threshold). */
const MIN_SCORE = 0.6;

// Lucas–Kanade stops when a step is smaller than this. On the finest level it
// is a tenth of the error the noise-free tests allow; on the coarser levels
// the answer only has to land well inside the reach of the next finer one,
// which is a good fraction of a pixel there.
const STEP_TOL = 0.005; // px, finest level
const COARSE_STEP_TOL = 0.05; // px of that level
const MAX_ITER = 30; // per level

// Robust weighting. The patch is cut into BLOCK × BLOCK squares, and each is
// weighed by Tukey's biweight on its RMS residual against the median block's:
// a block TUKEY_C times worse than typical counts for nothing. Blocks rather
// than pixels because the normal equations of each block can then be summed
// ahead of time; four pixels because the band lost along the edge of an
// occluder, or along the outline where body meets still background, is then
// thin.
const BLOCK = 4;
const TUKEY_C = 3;
// A block is never judged against a typical residual of less than this many
// grey levels: on a perfect match every residual is a rounding error, and a
// block a little worse than none is not an outlier. A phone camera's noise,
// after the smoothing above, is about this size.
const RESIDUAL_FLOOR = 1;

// The whole-pixel search runs on block sums 2^k pixels square, with k the
// smallest that keeps the search within this many multiply-adds — about half
// a millisecond in V8 — and no coarser than leaves MIN_SEARCH_SIDE blocks
// across the patch's shorter side. For a 200 × 260 patch and a window of
// ±0.6 of its height that is k = 4: a 12 × 16 patch slid over 21 × 21 places.
const SEARCH_BUDGET = 3e5;
const MIN_SEARCH_SIDE = 8;
// How far Lucas–Kanade on the coarsest level may move from where the
// whole-pixel search put it, in that level's pixels, before it is lost.
const LK_MARGIN = 2;
// A gain outside this range is not lighting; it is a match gone wrong.
const MIN_GAIN = 0.2;
const MAX_GAIN = 5;

/**
 * Luma, 0..255, from RGBA bytes (an ImageData's data). `out` is filled and
 * returned if given, so a page tracking every frame need not allocate.
 */
export function toGray(rgba, width, height, out) {
  const n = width * height;
  if (out && out.length < n) throw new RangeError(`toGray: out holds ${out.length}, needs ${n}`);
  const g = out || new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = LUMA_R * rgba[j] + LUMA_G * rgba[j + 1] + LUMA_B * rgba[j + 2];
  return g;
}

/**
 * Smooth `gray` with the kernel over a window of the finest level, reading
 * past the frame's edges as its edge pixels repeated. `hbuf` holds the
 * horizontal pass ((h + 4) × w), `pad` one row of the frame (w + 4) for rows
 * that run past the left or right edge.
 */
function smoothInto(gray, width, height, win, out, hbuf, pad) {
  const { x: ax, y: ay, w, h } = win;
  const n = w + 2 * KR;
  const x0 = ax - KR;
  const inside = x0 >= 0 && x0 + n <= width;
  for (let r = 0; r < h + 2 * KR; r++) {
    let y = ay - KR + r;
    if (y < 0) y = 0;
    else if (y >= height) y = height - 1;
    const o = r * w;
    if (inside) {
      let p = y * width + ax;
      for (let i = 0; i < w; i++, p++) hbuf[o + i] = K2 * (gray[p - 2] + gray[p + 2]) + K1 * (gray[p - 1] + gray[p + 1]) + K0 * gray[p];
      continue;
    }
    const off = y * width;
    for (let i = 0; i < n; i++) {
      let x = x0 + i;
      if (x < 0) x = 0;
      else if (x >= width) x = width - 1;
      pad[i] = gray[off + x];
    }
    for (let i = 0; i < w; i++) hbuf[o + i] = K2 * (pad[i] + pad[i + 4]) + K1 * (pad[i + 1] + pad[i + 3]) + K0 * pad[i + 2];
  }
  for (let r = 0; r < h; r++) {
    const a = r * w;
    const b = a + w;
    const c = b + w;
    const d = c + w;
    const e = d + w;
    for (let i = 0; i < w; i++) out[a + i] = K2 * (hbuf[a + i] + hbuf[e + i]) + K1 * (hbuf[b + i] + hbuf[d + i]) + K0 * hbuf[c + i];
  }
}

/**
 * One pyramid step: smooth `src` (a window of level l) and keep every second
 * pixel, into window `dst` of level l + 1. Pixel i of level l + 1 sits over
 * pixel 2i of level l, so a shift d at level l is d / 2 at level l + 1. The
 * source window must cover the destination's reach; planWindows sees to it.
 */
function reduceInto(src, swin, dst, out, tmp) {
  const { x: dx, y: dy, w, h } = dst;
  const sw = swin.w;
  const rows = 2 * h + 3;
  for (let r = 0; r < rows; r++) {
    const o = r * w;
    let X = (2 * dy - KR + r - swin.y) * sw + 2 * dx - swin.x;
    for (let i = 0; i < w; i++, X += 2) tmp[o + i] = K2 * (src[X - 2] + src[X + 2]) + K1 * (src[X - 1] + src[X + 1]) + K0 * src[X];
  }
  for (let j = 0; j < h; j++) {
    const a = 2 * j * w;
    const b = a + w;
    const c = b + w;
    const d = c + w;
    const e = d + w;
    const o = j * w;
    for (let i = 0; i < w; i++) out[o + i] = K2 * (tmp[a + i] + tmp[e + i]) + K1 * (tmp[b + i] + tmp[d + i]) + K0 * tmp[c + i];
  }
}

/** Fill windows wins[0..] of the pyramid of `gray`: level 0 smoothed, then reduced. */
function buildPyramid(gray, width, height, wins, bufs, scratch) {
  smoothInto(gray, width, height, wins[0], bufs[0], scratch.hbuf, scratch.pad);
  for (let l = 1; l < wins.length; l++) reduceInto(bufs[l - 1], wins[l - 1], wins[l], bufs[l], scratch.rtmp);
}

/** The level-l window from which window `win` of level l + 1 can be reduced. */
function reach(win, out) {
  out.x = 2 * win.x - KR;
  out.y = 2 * win.y - KR;
  out.w = 2 * win.w + 3;
  out.h = 2 * win.h + 3;
  return out;
}

/** Sums of `gray` over blocks s pixels square, bw × bh of them from (ax, ay). */
function blockSums(gray, width, height, ax, ay, s, bw, bh, out, colIdx) {
  const nx = bw * s;
  const inside = ax >= 0 && ax + nx <= width;
  if (!inside) {
    for (let c = 0; c < nx; c++) {
      const x = ax + c;
      colIdx[c] = x < 0 ? 0 : x >= width ? width - 1 : x;
    }
  }
  out.fill(0, 0, bw * bh);
  for (let by = 0; by < bh; by++) {
    const o = by * bw;
    for (let yy = 0; yy < s; yy++) {
      let y = ay + by * s + yy;
      if (y < 0) y = 0;
      else if (y >= height) y = height - 1;
      const off = y * width;
      if (inside && s >= 4) {
        // s is a power of two; four running sums for the reason in bestMatch
        let p = off + ax;
        for (let bx = 0; bx < bw; bx++) {
          let a = 0;
          let b = 0;
          let c = 0;
          let d = 0;
          for (let xx = 0; xx < s; xx += 4, p += 4) {
            a += gray[p];
            b += gray[p + 1];
            c += gray[p + 2];
            d += gray[p + 3];
          }
          out[o + bx] += a + b + c + d;
        }
      } else if (inside) {
        let p = off + ax;
        for (let bx = 0; bx < bw; bx++) {
          let sum = 0;
          for (let xx = 0; xx < s; xx++) sum += gray[p++];
          out[o + bx] += sum;
        }
      } else {
        let c = 0;
        for (let bx = 0; bx < bw; bx++) {
          let sum = 0;
          for (let xx = 0; xx < s; xx++) sum += gray[off + colIdx[c++]];
          out[o + bx] += sum;
        }
      }
    }
  }
}

/** Summed-area tables of an image and of its square, (w + 1) × (h + 1). */
function integrate(img, w, h, ii, ii2) {
  const W1 = w + 1;
  for (let x = 0; x <= w; x++) {
    ii[x] = 0;
    ii2[x] = 0;
  }
  for (let y = 0; y < h; y++) {
    const o = (y + 1) * W1;
    const p = y * W1;
    const q = y * w;
    ii[o] = 0;
    ii2[o] = 0;
    let rs = 0;
    let rs2 = 0;
    for (let x = 0; x < w; x++) {
      const v = img[q + x];
      rs += v;
      rs2 += v * v;
      ii[o + x + 1] = ii[p + x + 1] + rs;
      ii2[o + x + 1] = ii2[p + x + 1] + rs2;
    }
  }
}

/**
 * Exhaustive zero-mean normalised cross-correlation of a zero-mean template
 * (tw × th) over positions [i0, i1] × [j0, j1] of an image iw wide, whose
 * summed-area tables are ii and ii2. A position over a flat patch (no
 * variance, as where the frame's edge has been repeated) is passed over.
 * Writes the best position, Σ t·I there and Σ I there into `out`; out.score is
 * the correlation times the template's norm.
 */
function bestMatch(tpl, tw, th, img, iw, ii, ii2, i0, i1, j0, j1, out) {
  const n = tw * th;
  const W1 = iw + 1;
  out.score = -Infinity;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const a = j * W1 + i;
      const b = a + tw;
      const c = (j + th) * W1 + i;
      const d = c + tw;
      const sum = ii[d] - ii[b] - ii[c] + ii[a];
      const v = ii2[d] - ii2[b] - ii2[c] + ii2[a] - (sum * sum) / n;
      if (!(v > 1e-6 * n)) continue;
      // four running sums, not one: a single sum waits on its own last
      // addition every time, and that wait, not the arithmetic, is the cost
      let n0 = 0;
      let n1 = 0;
      let n2 = 0;
      let n3 = 0;
      for (let y = 0; y < th; y++) {
        let p = (j + y) * iw + i;
        let q = y * tw;
        const q4 = q + (tw & ~3);
        const qe = q + tw;
        for (; q < q4; q += 4, p += 4) {
          n0 += tpl[q] * img[p];
          n1 += tpl[q + 1] * img[p + 1];
          n2 += tpl[q + 2] * img[p + 2];
          n3 += tpl[q + 3] * img[p + 3];
        }
        for (; q < qe; q++, p++) n0 += tpl[q] * img[p];
      }
      const num = n0 + n1 + n2 + n3;
      const score = num / Math.sqrt(v);
      if (score > out.score) {
        out.score = score;
        out.i = i;
        out.j = j;
        out.num = num;
        out.sum = sum;
        out.v = v;
      }
    }
  }
  return out;
}

/** The k-th smallest of a[0..n) (Hoare's selection; reorders a). */
function select(a, n, k) {
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const pivot = a[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (a[i] < pivot) i++;
      while (a[j] > pivot) j--;
      if (i <= j) {
        const t = a[i];
        a[i] = a[j];
        a[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  return a[k];
}

/**
 * Solve the 4 × 4 symmetric positive definite system h x = v by Cholesky.
 * h is the upper triangle, row by row (10 numbers). False if it is singular.
 */
function solve4(h, v, x) {
  const l00 = Math.sqrt(h[0]);
  if (!(l00 > 0)) return false;
  const l10 = h[1] / l00;
  const l20 = h[2] / l00;
  const l30 = h[3] / l00;
  const d1 = h[4] - l10 * l10;
  if (!(d1 > 0)) return false;
  const l11 = Math.sqrt(d1);
  const l21 = (h[5] - l20 * l10) / l11;
  const l31 = (h[6] - l30 * l10) / l11;
  const d2 = h[7] - l20 * l20 - l21 * l21;
  if (!(d2 > 0)) return false;
  const l22 = Math.sqrt(d2);
  const l32 = (h[8] - l30 * l20 - l31 * l21) / l22;
  const d3 = h[9] - l30 * l30 - l31 * l31 - l32 * l32;
  if (!(d3 > 0)) return false;
  const l33 = Math.sqrt(d3);
  const z0 = v[0] / l00;
  const z1 = (v[1] - l10 * z0) / l11;
  const z2 = (v[2] - l20 * z0 - l21 * z1) / l22;
  const z3 = (v[3] - l30 * z0 - l31 * z1 - l32 * z2) / l33;
  x[3] = z3 / l33;
  x[2] = (z2 - l32 * x[3]) / l22;
  x[1] = (z1 - l21 * x[2] - l31 * x[3]) / l11;
  x[0] = (z0 - l10 * x[1] - l20 * x[2] - l30 * x[3]) / l00;
  return true;
}

const win = (x = 0, y = 0, w = 0, h = 0) => ({ x, y, w, h });

/** No motion expected; one shared object, so a call that omits it allocates nothing. */
const STILL = Object.freeze({ dx: 0, dy: 0 });

/**
 * Finds one patch of a reference frame in later frames, to a small fraction
 * of a pixel.
 *
 * maxShift: the largest displacement searched for, either way of the
 * prediction, as a fraction of the patch's height (a hop moves the trunk 5 to
 * 15 cm and the patch is about 40). levels: the Gaussian pyramid's depth.
 * Three suits a patch of about 200 × 260. With fewer, the whole-pixel search
 * hands over to a finer level, which has to be searched over a wider window,
 * and tracking is several times slower; with more, the coarsest level is too
 * small to say much.
 */
export class TemplateTracker {
  constructor({ maxShift = 0.6, levels = 3 } = {}) {
    if (!(maxShift > 0)) throw new RangeError('TemplateTracker: maxShift must be positive');
    if (!(Number.isInteger(levels) && levels >= 1)) throw new RangeError('TemplateTracker: levels must be a whole number, 1 or more');
    this.maxShift = maxShift;
    this.levels = levels;
    this.ref = null;
  }

  /** Forget the reference; track() then answers ok: false until a new one is set. */
  reset() {
    this.ref = null;
  }

  /**
   * Cut the patch: box {x0, y0, x1, y1} in pixels of `gray` (luma, as toGray
   * gives). Pixels are taken from round(x0) to round(x1), exclusive. Everything
   * that depends only on the patch is worked out here, and every buffer track()
   * needs is allocated here, so tracking allocates nothing.
   */
  setReference(gray, width, height, box) {
    const X0 = Math.round(box.x0);
    const Y0 = Math.round(box.y0);
    const X1 = Math.round(box.x1);
    const Y1 = Math.round(box.y1);
    if (!(X0 >= 0 && Y0 >= 0 && X1 <= width && Y1 <= height)) throw new RangeError('setReference: the box must lie inside the frame');
    const L = this.levels - 1;
    const W = X1 - X0;
    const H = Y1 - Y0;
    if (!((W >> L) >= 2 * BLOCK && (H >> L) >= 2 * BLOCK)) {
      throw new RangeError(`setReference: a ${W} × ${H} box is too small for ${this.levels} pyramid levels`);
    }

    // the patch on each level: the pixels of that level whose centres fall in it
    const lv = [];
    for (let l = 0; l <= L; l++) {
      const s = 1 << l;
      const tx0 = Math.ceil(X0 / s);
      const ty0 = Math.ceil(Y0 / s);
      const tw = Math.floor((X1 - 1) / s) + 1 - tx0;
      const th = Math.floor((Y1 - 1) / s) + 1 - ty0;
      lv.push({ tx0, ty0, tw, th });
    }

    // the reference's own pyramid, over the patch and one pixel round it for
    // the gradients, plus whatever each coarser level needs to be reduced from
    const rwins = lv.map((p) => win(p.tx0 - 1, p.ty0 - 1, p.tw + 2, p.th + 2));
    for (let l = L - 1; l >= 0; l--) {
      const r = reach(rwins[l + 1], win());
      const a = rwins[l];
      const x1 = Math.max(a.x + a.w, r.x + r.w);
      const y1 = Math.max(a.y + a.h, r.y + r.h);
      a.x = Math.min(a.x, r.x);
      a.y = Math.min(a.y, r.y);
      a.w = x1 - a.x;
      a.h = y1 - a.y;
    }
    const rbufs = rwins.map((w) => new Float32Array(w.w * w.h));
    const rscratch = {
      hbuf: new Float32Array((rwins[0].h + 2 * KR) * rwins[0].w),
      pad: new Float32Array(rwins[0].w + 2 * KR),
      rtmp: new Float32Array(Math.max(1, ...rwins.slice(1).map((w) => (2 * w.h + 3) * w.w))),
    };
    buildPyramid(gray, width, height, rwins, rbufs, rscratch);

    // per level: the patch (zero mean), its gradients, and each block's share
    // of the normal equations for the columns [∂T/∂x, ∂T/∂y, T, 1]
    for (let l = 0; l <= L; l++) {
      const p = lv[l];
      const rw = rwins[l];
      const buf = rbufs[l];
      const n = p.tw * p.th;
      const at = (i, j) => buf[(j - rw.y) * rw.w + (i - rw.x)];
      let mean = 0;
      for (let j = 0; j < p.th; j++) for (let i = 0; i < p.tw; i++) mean += at(p.tx0 + i, p.ty0 + j);
      mean /= n;
      const tpl = new Float32Array(3 * n); // T − mean, ∂T/∂x, ∂T/∂y, interleaved
      let tt = 0;
      for (let j = 0; j < p.th; j++) {
        for (let i = 0; i < p.tw; i++) {
          const X = p.tx0 + i;
          const Y = p.ty0 + j;
          const k = 3 * (j * p.tw + i);
          tpl[k] = at(X, Y) - mean;
          tpl[k + 1] = (at(X + 1, Y) - at(X - 1, Y)) / 2;
          tpl[k + 2] = (at(X, Y + 1) - at(X, Y - 1)) / 2;
          tt += tpl[k] * tpl[k];
        }
      }
      const nbx = Math.ceil(p.tw / BLOCK);
      const nby = Math.ceil(p.th / BLOCK);
      const nb = nbx * nby;
      const hess = new Float64Array(10 * nb);
      const cnt = new Float64Array(nb);
      for (let by = 0; by < nby; by++) {
        for (let bx = 0; bx < nbx; bx++) {
          const b = by * nbx + bx;
          const o = 10 * b;
          for (let j = by * BLOCK; j < Math.min((by + 1) * BLOCK, p.th); j++) {
            for (let i = bx * BLOCK; i < Math.min((bx + 1) * BLOCK, p.tw); i++) {
              const k = 3 * (j * p.tw + i);
              const gx = tpl[k + 1];
              const gy = tpl[k + 2];
              const t = tpl[k];
              hess[o] += gx * gx;
              hess[o + 1] += gx * gy;
              hess[o + 2] += gx * t;
              hess[o + 3] += gx;
              hess[o + 4] += gy * gy;
              hess[o + 5] += gy * t;
              hess[o + 6] += gy;
              hess[o + 7] += t * t;
              hess[o + 8] += t;
              hess[o + 9] += 1;
              cnt[b] += 1;
            }
          }
        }
      }
      Object.assign(p, { mean, tpl, tt, n, nbx, nby, nb, hess, cnt, acc: new Float64Array(5 * nb), ms: new Float64Array(nb), sel: new Float64Array(nb) });
    }
    // the coarsest level's patch on its own, contiguous, for the correlation search
    {
      const p = lv[L];
      p.flat = new Float32Array(p.n);
      for (let k = 0; k < p.n; k++) p.flat[k] = p.tpl[3 * k];
    }

    // the whole-pixel search: how coarse, how far, and the patch at that scale
    const R0 = this.maxShift * H;
    let k = L;
    for (;;) {
      const s = 1 << k;
      const cost = (2 * Math.ceil(R0 / s) + 1) ** 2 * Math.floor(W / s) * Math.floor(H / s);
      if (cost <= SEARCH_BUDGET) break;
      if (Math.min(Math.floor(W / (2 * s)), Math.floor(H / (2 * s))) < MIN_SEARCH_SIDE) break;
      k++;
    }
    const s = 1 << k;
    const stw = Math.floor(W / s);
    const sth = Math.floor(H / s);
    const sR = Math.ceil(R0 / s);
    const sTpl = new Float32Array(stw * sth);
    blockSums(gray, width, height, X0, Y0, s, stw, sth, sTpl, new Int32Array(stw * s));
    let sMean = 0;
    for (let i = 0; i < sTpl.length; i++) sMean += sTpl[i];
    sMean /= sTpl.length;
    for (let i = 0; i < sTpl.length; i++) sTpl[i] -= sMean;
    const sbw = stw + 2 * sR;
    const sbh = sth + 2 * sR;
    // after it, a correlation search on the coarsest pyramid level within the
    // search's own coarseness: 2^(k − L) of that level's pixels either way
    const refineR = Math.max(2, 1 << (k - L));

    // the frame's pyramid windows: on the coarsest level the patch with room
    // for the refinement and for Lucas–Kanade to move; each finer level what
    // the next coarser one is reduced from (which is ample for its own
    // Lucas–Kanade). Their sizes are fixed; track() only moves them.
    const twins = new Array(L + 1);
    const padL = refineR + LK_MARGIN + 1;
    twins[L] = win(0, 0, lv[L].tw + 2 * padL, lv[L].th + 2 * padL);
    for (let l = L - 1; l >= 0; l--) twins[l] = reach(twins[l + 1], win());
    const tbufs = twins.map((w) => new Float32Array(w.w * w.h));
    const wL = twins[L];

    this.ref = {
      X0,
      Y0,
      W,
      H,
      L,
      lv,
      search: { k, s, stw, sth, R: sR, tpl: sTpl, bw: sbw, bh: sbh, img: new Float32Array(sbw * sbh), colIdx: new Int32Array(sbw * s), ii: new Float64Array((sbw + 1) * (sbh + 1)), ii2: new Float64Array((sbw + 1) * (sbh + 1)) },
      refineR,
      padL,
      wins: twins,
      bufs: tbufs,
      scratch: {
        hbuf: new Float32Array((twins[0].h + 2 * KR) * twins[0].w),
        pad: new Float32Array(twins[0].w + 2 * KR),
        rtmp: new Float32Array(Math.max(1, ...twins.slice(1).map((w) => (2 * w.h + 3) * w.w))),
      },
      iiL: new Float64Array((wL.w + 1) * (wL.h + 1)),
      ii2L: new Float64Array((wL.w + 1) * (wL.h + 1)),
      best: { score: -Infinity, i: 0, j: 0, num: 0, sum: 0, v: 0 },
      sol: new Float64Array(4),
      H4: new Float64Array(10),
      v4: new Float64Array(4),
      st: { dx: 0, dy: 0, g: 1, beta: 0, iters: 0, score: NaN },
    };
  }

  /**
   * Where the patch is in this frame: its displacement (dx, dy) in pixels from
   * where it was in the reference, sub-pixel. `predict` is where to look,
   * as a displacement too; the search covers ±maxShift × the patch's height
   * round it. score is the zero-mean normalised cross-correlation with the
   * reference where it was found (0..1). iterations counts Lucas–Kanade
   * passes over all levels.
   *
   * When ok is false, dx and dy are NaN rather than a number nobody should use
   * (and gravity.js drops a sample that is not a number), and `reason` says
   * why: 'poor-match' (score under 0.6), 'off-frame' (the patch, with the
   * smoothing's reach, is not wholly inside the frame), 'lost' (the fine
   * alignment ran away or had nothing to hold on to), 'not-found' (nothing
   * but flat picture in the window), or 'no-reference'.
   */
  track(gray, width, height, predict = STILL) {
    const R = this.ref;
    if (!R) return { ok: false, dx: NaN, dy: NaN, score: NaN, iterations: 0, reason: 'no-reference' };
    const st = R.st;
    st.iters = 0;
    st.score = NaN;
    const pdx = Number.isFinite(predict?.dx) ? predict.dx : 0;
    const pdy = Number.isFinite(predict?.dy) ? predict.dy : 0;

    // 1. whole pixels, coarsely: block sums over the predicted window
    const S = R.search;
    const ox = Math.round(pdx) - S.R * S.s;
    const oy = Math.round(pdy) - S.R * S.s;
    blockSums(gray, width, height, R.X0 + ox, R.Y0 + oy, S.s, S.bw, S.bh, S.img, S.colIdx);
    integrate(S.img, S.bw, S.bh, S.ii, S.ii2);
    const best = bestMatch(S.tpl, S.stw, S.sth, S.img, S.bw, S.ii, S.ii2, 0, 2 * S.R, 0, 2 * S.R, R.best);
    if (!(best.score > -Infinity)) return done(R, false, 'not-found');
    const L = R.L;
    const scaleL = 1 << L;
    const cx = Math.round((ox + best.i * S.s) / scaleL);
    const cy = Math.round((oy + best.j * S.s) / scaleL);

    // 2. the pyramid, over windows round that
    const lvL = R.lv[L];
    const wL = R.wins[L];
    wL.x = lvL.tx0 + cx - R.padL;
    wL.y = lvL.ty0 + cy - R.padL;
    for (let l = L - 1; l >= 0; l--) reach(R.wins[l + 1], R.wins[l]);
    buildPyramid(gray, width, height, R.wins, R.bufs, R.scratch);

    // 3. whole pixels again, on the coarsest level, within the search's coarseness
    integrate(R.bufs[L], wL.w, wL.h, R.iiL, R.ii2L);
    const lo = R.padL - R.refineR;
    const hi = R.padL + R.refineR;
    const fine = bestMatch(lvL.flat, lvL.tw, lvL.th, R.bufs[L], wL.w, R.iiL, R.ii2L, lo, hi, lo, hi, R.best);
    if (!(fine.score > -Infinity)) return done(R, false, 'not-found');
    st.dx = cx + fine.i - R.padL;
    st.dy = cy + fine.j - R.padL;
    // the brightness that best maps the patch onto what is there
    st.g = Math.min(MAX_GAIN, Math.max(MIN_GAIN, fine.num / lvL.tt));
    st.beta = fine.sum / lvL.n;

    // 4. Lucas–Kanade, coarse to fine
    for (let l = L; l >= 0; l--) {
      if (l < L) {
        // the same picture one level finer: shifts double, and the offset is
        // kept as the same absolute brightness against a patch whose mean differs
        st.dx *= 2;
        st.dy *= 2;
        st.beta += st.g * (R.lv[l].mean - R.lv[l + 1].mean);
      }
      const why = this._lk(R, l, l === 0 ? STEP_TOL : COARSE_STEP_TOL);
      if (why) return done(R, false, why);
    }

    // 5. the patch must still be wholly in the frame, smoothing and all
    const ix = Math.floor(st.dx);
    const iy = Math.floor(st.dy);
    const inFrame = R.X0 + ix - KR >= 0 && R.Y0 + iy - KR >= 0 && R.X0 + R.W + ix + KR < width && R.Y0 + R.H + iy + KR < height;
    if (!inFrame) return done(R, false, 'off-frame');
    if (!(st.score >= MIN_SCORE)) return done(R, false, 'poor-match');
    return done(R, true);
  }

  /**
   * Lucas–Kanade on level l, from the state in R.st (shift in this level's
   * pixels, gain, offset), until a step is under `tol`. Returns a reason if
   * it fails, nothing if it converges or runs out of iterations.
   *
   * The model is frame(x + p) = g · T(x) + β. With the patch's own gradients
   * the residual e = frame(x + p) − g T − β is, to first order,
   * −g ∇T · δ + δg T + δβ, where δ is how far p still is from the answer: a
   * linear least-squares problem in the four columns [∂T/∂x, ∂T/∂y, T, 1],
   * whose normal matrix is fixed apart from the block weights.
   */
  _lk(R, l, tol) {
    const p = R.lv[l];
    const w = R.wins[l];
    const F = R.bufs[l];
    const st = R.st;
    const { tw, th, nbx, nby, nb, tpl, hess, cnt, acc, ms, sel } = p;
    const ww = w.w;
    const H4 = R.H4;
    const v4 = R.v4;
    const sol = R.sol;
    const c2 = TUKEY_C * TUKEY_C;
    for (let it = 0; it < MAX_ITER; it++) {
      const ix = Math.floor(st.dx);
      const iy = Math.floor(st.dy);
      const fx = st.dx - ix;
      const fy = st.dy - iy;
      const ox = p.tx0 + ix - w.x;
      const oy = p.ty0 + iy - w.y;
      if (ox < 0 || oy < 0 || ox + tw + 1 > w.w || oy + th + 1 > w.h) return 'lost';
      // every pixel of the patch shares the same fractional shift, so the
      // bilinear weights are four numbers for the whole pass
      const a00 = (1 - fx) * (1 - fy);
      const a01 = fx * (1 - fy);
      const a10 = (1 - fx) * fy;
      const a11 = fx * fy;
      const g = st.g;
      const beta = st.beta;
      let b = 0;
      for (let by = 0; by < nby; by++) {
        const y0 = by * BLOCK;
        const y1 = Math.min(y0 + BLOCK, th);
        for (let bx = 0; bx < nbx; bx++, b++) {
          const x0 = bx * BLOCK;
          const x1 = Math.min(x0 + BLOCK, tw);
          let sx = 0;
          let sy = 0;
          let sT = 0;
          let s1 = 0;
          let s2 = 0;
          for (let y = y0; y < y1; y++) {
            let q = (oy + y) * ww + ox + x0;
            let k = 3 * (y * tw + x0);
            for (let x = x0; x < x1; x++, q++, k += 3) {
              const f = a00 * F[q] + a01 * F[q + 1] + a10 * F[q + ww] + a11 * F[q + ww + 1];
              const t = tpl[k];
              const e = f - g * t - beta;
              sx += e * tpl[k + 1];
              sy += e * tpl[k + 2];
              sT += e * t;
              s1 += e;
              s2 += e * e;
            }
          }
          const o = 5 * b;
          acc[o] = sx;
          acc[o + 1] = sy;
          acc[o + 2] = sT;
          acc[o + 3] = s1;
          acc[o + 4] = s2;
        }
      }
      st.iters++;

      // block weights, against the median block
      let se = 0;
      let se2 = 0;
      let seT = 0;
      for (let i = 0; i < nb; i++) {
        const m = acc[5 * i + 4] / cnt[i];
        ms[i] = m;
        sel[i] = m; // a copy for the median to reorder
        se += acc[5 * i + 3];
        se2 += acc[5 * i + 4];
        seT += acc[5 * i + 2];
      }
      const typical = Math.max(select(sel, nb, nb >> 1), RESIDUAL_FLOOR * RESIDUAL_FLOOR);
      H4.fill(0);
      v4.fill(0);
      for (let i = 0; i < nb; i++) {
        const z = ms[i] / typical;
        if (z >= c2) continue;
        const u = 1 - z / c2;
        const wi = u * u;
        const o = 10 * i;
        for (let j = 0; j < 10; j++) H4[j] += wi * hess[o + j];
        const a = 5 * i;
        v4[0] += wi * acc[a];
        v4[1] += wi * acc[a + 1];
        v4[2] += wi * acc[a + 2];
        v4[3] += wi * acc[a + 3];
      }
      if (l === 0) {
        // the correlation where this pass sampled, from the unweighted sums:
        // with f = e + g T + β and T of zero mean,
        //   Σ f T = Σ e T + g Σ T²,  Σ f = Σ e + n β,
        //   Σ f² = Σ e² + g² Σ T² + n β² + 2 g Σ e T + 2 β Σ e
        const n = p.n;
        const sfT = seT + g * p.tt;
        const sf = se + n * beta;
        const sff = se2 + g * g * p.tt + n * beta * beta + 2 * g * seT + 2 * beta * se;
        const vf = sff - (sf * sf) / n;
        st.score = vf > 0 ? Math.max(0, sfT / Math.sqrt(vf * p.tt)) : 0;
      }
      if (!solve4(H4, v4, sol)) return 'lost';
      const ddx = -sol[0] / g;
      const ddy = -sol[1] / g;
      st.dx += ddx;
      st.dy += ddy;
      st.g += sol[2];
      st.beta += sol[3];
      if (!(st.g > MIN_GAIN && st.g < MAX_GAIN) || !Number.isFinite(st.dx + st.dy)) return 'lost';
      if (Math.hypot(ddx, ddy) < tol) return null;
    }
    return null;
  }
}

function done(R, ok, reason) {
  const st = R.st;
  const out = { ok, dx: ok ? st.dx : NaN, dy: ok ? st.dy : NaN, score: st.score, iterations: st.iters };
  if (!ok) out.reason = reason;
  return out;
}
