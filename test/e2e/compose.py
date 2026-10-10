"""Draw the end-to-end test's video: a real person, cut out of a photograph,
hopping in front of a wall along a simulated trajectory, at a scale chosen
here — so the page's answer can be checked against a number that is known.

The person moves as a rigid body (a photograph cannot bend its knees), so this
tests the page's machinery — the camera clock, the tracker on real pixels,
the fit — and not how rigid real people are in the air.

Usage: python3 compose.py cutoutdir trajectory.json out.mjpeg truth.json
"""
import io
import json
import sys

import numpy as np
from PIL import Image, ImageFilter

STATURE_M = 1.75  # the person is declared this tall; the scale follows
FRAME_W, FRAME_H = 540, 960
PERSON_FRACTION = 0.72  # of the frame height, head to heel
NOISE = 1.5  # grey levels of sensor noise
JPEG_Q = 88

cut, traj_path, out_path, truth_path = sys.argv[1:5]
meta = json.load(open(f"{cut}/landmarks.json"))
photo = Image.open(next(p for p in [f"{cut}/photo.jpg", f"{cut}/photo.jpeg", f"{cut}/photo.png"] if __import__("os").path.exists(p))).convert("RGB")
mask = Image.open(f"{cut}/mask.png").convert("L").resize(photo.size, Image.BILINEAR)
a = np.asarray(mask, dtype=np.float32) / 255.0
ys, xs = np.nonzero(a > 0.5)
lm = meta["landmarks"]
heel = max(lm[29]["y"], lm[30]["y"], lm[31]["y"], lm[32]["y"]) * photo.size[1]
top = ys.min()
x0, x1 = xs.min(), xs.max()
pad = int(0.06 * (heel - top))
box = (max(0, x0 - pad), max(0, top - pad), min(photo.size[0], x1 + pad), min(photo.size[1], ys.max() + pad))
person = photo.crop(box)
alpha = mask.crop(box).filter(ImageFilter.GaussianBlur(0.8))
scale = PERSON_FRACTION * FRAME_H / (heel - top)
size = (round(person.size[0] * scale), round(person.size[1] * scale))
person = np.asarray(person.resize(size, Image.LANCZOS), dtype=np.float32)
alpha = np.asarray(alpha.resize(size, Image.BILINEAR), dtype=np.float32)[..., None] / 255.0
px_per_m = (heel - top) * scale / STATURE_M

# where the person stands: centred, heels at 84% of the frame
top_in_frame = 0.84 * FRAME_H - (heel - box[1]) * scale
left_in_frame = (FRAME_W - size[0]) / 2

# the wall and the floor
yy, xx = np.mgrid[0:FRAME_H, 0:FRAME_W].astype(np.float32)
rng = np.random.default_rng(7)
wall = 196 + 18 * np.sin(xx / 97.0) * np.cos(yy / 131.0) + rng.normal(0, 3, (FRAME_H, FRAME_W))
floor = yy > 0.86 * FRAME_H
bg = np.stack([wall * 0.98, wall * 0.96, wall * 0.9], -1)
bg[floor] = np.array([120, 104, 90]) + rng.normal(0, 4, (floor.sum(), 3))
bg = bg.astype(np.float32)


def shifted(img, dx, dy):
    """Bilinear sub-pixel shift of an array (h, w, c) by (dx, dy)."""
    ix, iy = int(np.floor(dx)), int(np.floor(dy))
    fx, fy = dx - ix, dy - iy
    p = np.pad(img, ((1, 1), (1, 1), (0, 0)))
    a00 = p[1:-1, 1:-1]
    a01 = p[1:-1, :-2]
    a10 = p[:-2, 1:-1]
    a11 = p[:-2, :-2]
    out = (1 - fx) * (1 - fy) * a00 + fx * (1 - fy) * a01 + (1 - fx) * fy * a10 + fx * fy * a11
    return out, ix, iy


traj = json.load(open(traj_path))
frames = traj["frames"]
with open(out_path, "wb") as fh:
    for k, ys_m in enumerate(frames):
        acc = np.zeros_like(bg)
        for y_m in ys_m:
            dy = -y_m * px_per_m  # up is minus in the picture
            ox = left_in_frame
            oy = top_in_frame + dy
            P, ix, iy = shifted(person, ox - np.floor(ox), oy - np.floor(oy))
            A, _, _ = shifted(alpha, ox - np.floor(ox), oy - np.floor(oy))
            X = int(np.floor(ox)) + ix
            Y = int(np.floor(oy)) + iy
            f = bg.copy()
            h, w = P.shape[:2]
            ys0, xs0 = max(0, Y), max(0, X)
            ys1, xs1 = min(FRAME_H, Y + h), min(FRAME_W, X + w)
            sub_p = P[ys0 - Y:ys1 - Y, xs0 - X:xs1 - X]
            sub_a = A[ys0 - Y:ys1 - Y, xs0 - X:xs1 - X]
            f[ys0:ys1, xs0:xs1] = sub_a * sub_p + (1 - sub_a) * f[ys0:ys1, xs0:xs1]
            acc += f
        acc /= len(ys_m)
        acc += rng.normal(0, NOISE, acc.shape)
        img = Image.fromarray(np.clip(acc, 0, 255).astype(np.uint8))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=JPEG_Q)
        fh.write(buf.getvalue())
        if k % 100 == 0:
            print(f"frame {k}/{len(frames)}", flush=True)

json.dump(
    {
        "pxPerMetre": px_per_m,
        "statureM": STATURE_M,
        "frame": [FRAME_W, FRAME_H],
        "fps": traj["fps"],
        "headTopY": top_in_frame + (top - box[1]) * scale,
        "heelY": 0.84 * FRAME_H,
    },
    open(truth_path, "w"),
    indent=1,
)
print(f"{len(frames)} frames; truth {px_per_m:.2f} px/m")
