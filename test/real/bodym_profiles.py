"""Width and depth profiles of every BodyM silhouette pair, in cm.

For each photo: the front silhouette's width (whole row, and the torso alone where the arms are
clear of it) and the side silhouette's depth, at every 1% of the person's height from 40% to 86%,
each scaled by that silhouette's own height in pixels against the person's measured height (the
hops would give the scale on the page; BodyM has no hops, so the measured height stands in).

python3 profiles.py <split>   ->  <split>/profiles.npz
"""
import csv
import os
import sys

import numpy as np
from PIL import Image

split = sys.argv[1]
FRACS = np.round(np.arange(0.40, 0.865, 0.01), 2)
meas = {r["subject_id"]: r for r in csv.DictReader(open(f"{split}/measurements.csv"))}
meta = {r["subject_id"]: r for r in csv.DictReader(open(f"{split}/hwg_metadata.csv"))}
pairs = [(r["subject_id"], r["photo_id"]) for r in csv.DictReader(open(f"{split}/subject_to_photo_map.csv"))]


def runs(row):
    d = np.diff(np.r_[0, row.astype(np.int8), 0])
    s = np.where(d == 1)[0]
    e = np.where(d == -1)[0]
    return [(a, b) for a, b in zip(s, e) if b - a > 3]


def load(path):
    a = np.array(Image.open(path).convert("L")) > 127
    ys = np.where(a.any(1))[0]
    return a, ys.min(), ys.max()


rows = []
for sid, pid in pairs:
    f, s = f"{split}/mask/{pid}.png", f"{split}/mask_left/{pid}.png"
    if not (os.path.exists(f) and os.path.exists(s)) or sid not in meas:
        continue
    try:
        F, ft, fb = load(f)
        Sd, st, sb = load(s)
    except Exception:
        continue
    hcm = float(meas[sid]["height"])
    fs, ss = (fb - ft) / hcm, (sb - st) / hcm  # pixels per cm, each view
    xs = np.where(F[int(fb - 0.55 * (fb - ft))])[0]
    cx = np.median(xs) if len(xs) else F.shape[1] / 2
    whole, torso, depth, nruns = [], [], [], []
    for q in FRACS:
        y = int(round(fb - q * (fb - ft)))
        r = runs(F[y])
        whole.append(sum(b - a for a, b in r) / fs if r else np.nan)
        mid = [ab for ab in r if ab[0] <= cx < ab[1]]
        torso.append((mid[0][1] - mid[0][0]) / fs if len(r) >= 3 and mid else np.nan)
        nruns.append(len(r))
        y2 = int(round(sb - q * (sb - st)))
        r2 = runs(Sd[y2])
        depth.append(max(b - a for a, b in r2) / ss if r2 else np.nan)
    m = meas[sid]
    rows.append(
        dict(
            sid=sid,
            pid=pid,
            female=meta.get(sid, {}).get("gender") == "female",
            height=hcm,
            weight=float(meta[sid]["weight_kg"]) if sid in meta else np.nan,
            chest=float(m["chest"]),
            waist=float(m["waist"]),
            whole=whole,
            torso=torso,
            depth=depth,
            nruns=nruns,
            fpx=fb - ft,
            spx=sb - st,
        )
    )
np.savez_compressed(
    f"{split}/profiles.npz",
    fracs=FRACS,
    sid=np.array([r["sid"] for r in rows]),
    pid=np.array([r["pid"] for r in rows]),
    female=np.array([r["female"] for r in rows]),
    height=np.array([r["height"] for r in rows]),
    weight=np.array([r["weight"] for r in rows]),
    chest=np.array([r["chest"] for r in rows]),
    waist=np.array([r["waist"] for r in rows]),
    whole=np.array([r["whole"] for r in rows]),
    torso=np.array([r["torso"] for r in rows]),
    depth=np.array([r["depth"] for r in rows]),
    nruns=np.array([r["nruns"] for r in rows]),
    fpx=np.array([r["fpx"] for r in rows]),
    spx=np.array([r["spx"] for r in rows]),
)
print(split, len(rows), "photo pairs from", len(set(r["sid"] for r in rows)), "people")
