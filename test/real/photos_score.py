"""Score each way of getting a chest from these real photos against each person's tape chest.

    python3 -I photos_score.py <folder> [<bodym folder>]

<folder> is the one photos_fetch.py and photos_measure.mjs filled. The methods:
- the page: refused or measured (photos_measure.mjs), and "forced", its formula even where it refused;
- height + weight (+ sex), what size websites ask: lines fitted on ANSUR II, each sex on its own;
- a model learned on BodyM's outlines and height (bodym_evaluate.py), given these photos' outlines.
  Only with a BodyM folder that bodym_profiles.py has run in; BodyM is non-commercial, like these photos.

Errors are answer minus tape. "Right size" is the chance the answer and the tape land in the same size
on a chart with sizes 4 cm apart, over every place the chart's size lines could fall: for an error e,
max(0, 1 - |e|/4). Writes <folder>/scores.json.
"""
import csv
import json
import os
import sys

import numpy as np
from PIL import Image

out = os.path.realpath(sys.argv[1])
people = [p for p in json.load(open(os.path.join(out, "people.json"))) if not p["sameAs"] and p["age"] >= 18]
page = {r["key"]: r for r in json.load(open(os.path.join(out, "page_results.json")))}


def fit(X, y):
    X = np.c_[np.ones(len(X)), np.array(X)]
    w, *_ = np.linalg.lstsq(X, np.array(y), rcond=None)
    return lambda x: float(np.r_[1, x] @ w)


A = []
for s, female in [("MALE", False), ("FEMALE", True)]:
    for r in csv.DictReader(open(os.path.join(out, "ansur", f"ANSUR_II_{s}_Public.csv"), encoding="latin-1")):
        A.append(dict(female=female, chest=float(r["chestcircumference"]) / 10, stature=float(r["stature"]) / 10, weight=float(r["weightkg"]) / 10))
hw = {f: fit([[r["stature"], r["weight"]] for r in A if r["female"] == f], [r["chest"] for r in A if r["female"] == f]) for f in (False, True)}

learned = None
if len(sys.argv) > 2:
    here, bm = os.path.dirname(os.path.abspath(__file__)), os.path.realpath(sys.argv[2])
    cwd = os.getcwd()
    os.chdir(bm)
    exec(open(os.path.join(here, "bodym_evaluate.py")).read().split("results = {}")[0])  # S, feats, ridge_fit
    os.chdir(cwd)
    T = S["train"]
    model, _ = ridge_fit(feats(T, "profiles+height"), T["chest"], T["sid"])

    def outline(key, view):
        return np.array(Image.open(os.path.join(out, "outlines", f"{key}-{view}.pgm"))) > 127

    def profiles(a, front, height):
        """BodyM's features: at every 1% of the outline's height from 60% to 80%, the width in cm (front:
        every piece across the row; side: the widest)."""
        ys = np.where(a.any(1))[0]
        top, bot = ys.min(), ys.max()
        s = (bot - top) / height
        vals = []
        for q in np.round(np.arange(0.60, 0.805, 0.01), 2):
            d = np.diff(np.r_[0, a[int(round(bot - q * (bot - top)))].astype(np.int8), 0])
            runs = [(x, y) for x, y in zip(np.where(d == 1)[0], np.where(d == -1)[0]) if y - x > 3]
            vals.append(np.nan if not runs else (sum(y - x for x, y in runs) if front else max(y - x for x, y in runs)) / s)
        return vals

    def learned(p):
        wid, dep = profiles(outline(p["key"], "front"), True, p["height"]), profiles(outline(p["key"], "side"), False, p["height"])
        return float(model(np.c_[[dep], [wid], [[p["height"]]]])[0])

rows = []
for p in people:
    r = page[p["key"]]
    rec = dict(key=p["key"], chest=p["chest"], chestFlag=p["chestFlag"], refused=r.get("refused"),
               page=r.get("page"), forced=r.get("forced"), heightWeight=hw[p["female"]]([p["height"], p["weight"]]))
    if learned and r.get("side"):
        rec["learned"] = learned(p)
    rows.append(rec)
json.dump(rows, open(os.path.join(out, "scores.json"), "w"), indent=1)


def show(k, sel=lambda r: True):
    e = np.array([r[k] - r["chest"] for r in rows if r.get(k) is not None and sel(r)])
    if not len(e):
        return f"{k:13s} none"
    return (f"{k:13s} n {len(e):2d}  mean error {np.abs(e).mean():5.2f} cm  bias {e.mean():+6.2f}  within 2 cm {(np.abs(e) <= 2).sum():2d}"
            f"  right size {100 * np.clip(1 - np.abs(e) / 4, 0, None).mean():3.0f}%  size or next {100 * np.clip(2 - np.abs(e) / 4, 0, 1).mean():3.0f}%")


print(len(rows), "adults;", sum(r["page"] is not None for r in rows), "measured by the page;", sum(r["chestFlag"] for r in rows), "tape values tagged _tbr")
for k in ["page", "forced", "heightWeight", "learned"]:
    print(show(k))
print("without the values tagged _tbr:")
for k in ["heightWeight", "learned"]:
    print(show(k, lambda r: not r["chestFlag"]))
