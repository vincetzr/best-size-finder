"""The page's quarter turn, run on real people's 3D body scans (NOMO-3d-400, TC2 scanner).

For each scan: cut a horizontal slice at chest height, keep the chest's own outline (the arms are
separate pieces when they hang clear, and are above the chest in the page's arms-up turn), then
look at it as the page's camera would during a quarter turn: a pinhole 2.2 m away, the outline's
silhouette width at every angle, and girth = pi x the mean width over 12 angle bins (Cauchy's
formula, as src/sizing.js chestFromTurn). Also the page's two-picture line (width facing, depth
side on) and the outline's exact convex length. All against the scanner's own chest girth.

python3 -I nomo_turn.py <extracted folder>  ->  results.json, and a summary
"""
import glob
import json
import math
import os
import re
import sys

import numpy as np

root = sys.argv[1]
DIST = 2.2  # metres from the camera to the body's middle
F = 957.0  # the page's nominal focal length for a 720 x 1280 picture, px


def load_obj(path):
    V, Fc = [], []
    with open(path, "r", errors="ignore") as fh:
        for line in fh:
            if line.startswith("v "):
                p = line.split()
                V.append((float(p[1]), float(p[2]), float(p[3])))
            elif line.startswith("f "):
                idx = [int(t.split("/")[0]) for t in line.split()[1:]]
                for k in range(1, len(idx) - 1):
                    Fc.append((idx[0], idx[k], idx[k + 1]))
    V = np.array(V, float)
    Fc = np.array(Fc, int)
    Fc = np.where(Fc > 0, Fc - 1, Fc + len(V))
    return V, Fc


def slice_loops(V, Fc, up, h):
    """Segments where the plane up = h cuts the mesh, joined into loops; each loop as an (n, 2) array."""
    z = V[:, up]
    a = [i for i in range(3) if i != up]
    tri = z[Fc]
    above = tri > h
    cut = above.any(1) & ~above.all(1)
    segs = []
    for f in Fc[cut]:
        pts = []
        for i, j in ((0, 1), (1, 2), (2, 0)):
            zi, zj = z[f[i]], z[f[j]]
            if (zi > h) != (zj > h):
                t = (h - zi) / (zj - zi)
                p = V[f[i]] + t * (V[f[j]] - V[f[i]])
                pts.append((round(p[a[0]], 5), round(p[a[1]], 5)))
        if len(pts) == 2:
            segs.append(pts)
    # join segments into connected pieces by shared end points
    parent = {}

    def find(x):
        while parent.setdefault(x, x) != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for p, q in segs:
        parent[find(p)] = find(q)
    groups = {}
    for p, q in segs:
        groups.setdefault(find(p), []).extend([p, q])
    return [np.array(sorted(set(g))) for g in groups.values() if len(g) > 20]


def hull(P):
    P = np.unique(P, axis=0)
    P = P[np.lexsort((P[:, 1], P[:, 0]))]

    def half(pts):
        h = []
        for p in pts:
            while len(h) >= 2 and ((h[-1][0] - h[-2][0]) * (p[1] - h[-2][1]) - (h[-1][1] - h[-2][1]) * (p[0] - h[-2][0])) <= 0:
                h.pop()
            h.append(p)
        return h

    lower, upper = half(P), half(P[::-1])
    return np.array(lower[:-1] + upper[:-1])


def perimeter(H):
    return float(np.sum(np.hypot(*(np.roll(H, -1, 0) - H).T)))


def turn_girth(H, bins=12, span=90.0):
    """pi x the mean silhouette width over 12 angle bins, seen through the page's pinhole, widths
    taken across the line of sight and scaled at the body's middle (as the page does)."""
    widths = []
    for k in range(bins):
        th = math.radians((k + 0.5) * span / bins)
        c, s = math.cos(th), math.sin(th)
        x = H[:, 0] * c - H[:, 1] * s
        zz = H[:, 0] * s + H[:, 1] * c + DIST
        u = F * x / zz
        lo, hi = u.min(), u.max()
        across = (hi - lo) / math.hypot(1, (lo + hi) / 2 / F)
        widths.append(across / (F / DIST))
    return math.pi * float(np.mean(widths)), widths


def august(w, d):
    """The page's girthFromWidthDepth (src/sizing.js): its line inside its box, else its Ramanujan ellipse x 1.177."""
    a, b = w / 2, d / 2
    h = (a - b) ** 2 / (a + b) ** 2
    ram = math.pi * (a + b) * (1 + 3 * h / (10 + math.sqrt(4 - 3 * h)))
    if 24 <= w <= 62 and 13 <= d <= 44:
        return 1.418 * w + 1.015 * d + 33.52
    return 1.177 * ram


out = []
objs = sorted(glob.glob(os.path.join(root, "**", "*.obj"), recursive=True))
txt_of = {os.path.splitext(os.path.basename(t))[0]: t for t in glob.glob(os.path.join(root, "**", "*.txt"), recursive=True)}
print(len(objs), "scans,", len(txt_of), "measurement files")
for path in objs:
    name = os.path.splitext(os.path.basename(path))[0]
    if name not in txt_of:
        continue
    txt = open(txt_of[name], errors="ignore").read()
    m = re.search(r"CHEST_Circ\s*=\s*([\d.]+)", txt) or re.search(r"BUST_Circ\s*=\s*([\d.]+)", txt)
    if not m:
        continue
    truth = float(m.group(1))
    try:
        V, Fc = load_obj(path)
    except Exception:
        continue
    ext = V.max(0) - V.min(0)
    up = int(np.argmax(ext))
    unit = 100.0 if ext[up] < 3 else (0.1 if ext[up] > 300 else 1.0)  # to cm
    V = V * unit
    zmin, zmax = V[:, up].min(), V[:, up].max()
    stature = zmax - zmin
    a = [i for i in range(3) if i != up]
    best = None
    # the scanner's own bust height where it gives one (women); otherwise the fullest part of the
    # chest, under the arms, as BEST measures it: the largest chest outline from 68% to 76% of height
    bh = re.search(r"Bust_Height\s*=\s*([\d.]+)", txt)
    levels = [(float(bh.group(1)) + dz - zmin) / stature for dz in (0, -0.5, 0.5, -1, 1, -1.5, 1.5, -2, 2)] if bh else list(np.arange(0.68, 0.765, 0.005))
    for q in levels:
        loops = slice_loops(V, Fc, up, zmin + q * stature)
        if not loops:
            continue
        centre = np.median(V[:, a], 0)
        torso = min(loops, key=lambda L: np.hypot(*(L.mean(0) - centre)))
        # the arms clear of the chest: two real arm outlines (over 15 cm round), one each side
        arms = [L for L in loops if L is not torso and perimeter(hull(L)) > 15]
        sides = {np.sign(L.mean(0)[0] - torso.mean(0)[0]) for L in arms}
        if len(arms) < 2 or len(sides) < 2:
            continue
        Hc = hull(torso)
        per = perimeter(Hc)
        if bh:  # the first level, nearest the scanner's own, at which the arms are clear
            best = dict(q=round(float(q), 3), hullCm=per, H=Hc / 100.0)
            break
        if best is None or per > best["hullCm"]:
            best = dict(q=round(float(q), 3), hullCm=per, H=Hc / 100.0)
    if best is None:
        out.append(dict(scan=os.path.basename(path), truth=truth, usable=False))
        continue
    Hm = best.pop("H")
    Hm = Hm - Hm.mean(0)
    girth, widths = turn_girth(Hm)
    girth_half, _ = turn_girth(Hm, bins=24, span=180.0)
    girth_q48, _ = turn_girth(Hm, bins=48)
    w0 = widths[0] * 100
    d90 = widths[-1] * 100
    rec = dict(scan=os.path.basename(path), truth=truth, usable=True, stature=round(stature, 1), q=best["q"], hullCm=round(best["hullCm"], 2),
               turnCm=round(girth * 100, 2), halfTurnCm=round(girth_half * 100, 2), quarter48Cm=round(girth_q48 * 100, 2), widthCm=round(w0, 2), depthCm=round(d90, 2),
               twoViewCm=round(august(w0, d90), 2), female=name.startswith("female"), level="scanner's bust height" if bh else "fullest chest")
    out.append(rec)
    print(name, rec["truth"], rec["turnCm"], rec["twoViewCm"], flush=True)
json.dump(out, open("results.json", "w"), indent=0)

# the summary: women only, where the scanner gives the height of its own bust line; the men's
# chest line height is not in the files, and the girth there depends mostly on where it is cut
use = [r for r in out if r.get("usable") and r["female"]]
for k, label in [("hullCm", "the chest's outline (a perfect turn)"), ("halfTurnCm", "half turn, 24 angles"), ("turnCm", "quarter turn, 12 angles (the page)"), ("twoViewCm", "width and depth formula")]:
    e = np.array([r[k] - r["truth"] for r in use])
    print(f"{label:38s} n={len(e)} bias {e.mean():+.2f} SD {e.std():.2f} mean |error| {np.abs(e).mean():.2f} cm, within 1 cm {100 * (np.abs(e) <= 1).mean():.0f}%")
