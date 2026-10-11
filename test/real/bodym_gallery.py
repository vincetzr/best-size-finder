"""Per-person results for the gallery, computed exactly as bodym_evaluate.py does, plus the drawings.

Run from the BodyM data folder, after bodym_profiles.py: python3 ../bodym_gallery.py -> gallery/.

For every testA and testB person: their measured chest (from BodyM's 3D scan), the page's
width-and-depth formula (where a photo shows the chest clear of the arms), the learned model, the
errors (each person's photos averaged), and one photo pair drawn with what was measured.
"""
import json
import os

import numpy as np
from PIL import Image, ImageDraw

src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "bodym_evaluate.py")).read().split("results = {}")[0]
exec(src)  # S, FR, august, feats, ridge_fit

CELL_W, CELL_H = 160, 300
TEAL = (20, 120, 126)
ORANGE = (235, 104, 52)
RED = (200, 45, 40)

T = S["train"]
model, lam = ridge_fit(feats(T, "profiles+height"), T["chest"], T["sid"])
LO, HI = 0.60, 0.80


def page_estimate(P, i):
    for q in [0.72, 0.71, 0.70]:
        j = FR.index(q)
        if np.isfinite(P["torso"][i, j]):
            return float(august(np.array([P["torso"][i, j]]), np.array([P["depth"][i, j]]))[0]), q
    return None, None


def runs(row):
    d = np.diff(np.r_[0, row.astype(np.int8), 0])
    s = np.where(d == 1)[0]
    e = np.where(d == -1)[0]
    return [(a, b) for a, b in zip(s, e) if b - a > 3]


def drawn(split, pid, view, q, measurable):
    """One silhouette, cropped and scaled into a cell, with the model's band and the chest line."""
    a = np.array(Image.open(f"{split}/{view}/{pid}.png").convert("L")) > 127
    ys, xs = np.where(a)
    top, bot = ys.min(), ys.max()
    H = bot - top
    im = Image.fromarray(np.where(a, 70, 244).astype(np.uint8)).convert("RGB")
    d = ImageDraw.Draw(im, "RGBA")
    # the band the learned model reads: every 1% of height from 60% to 80%
    yb0, yb1 = int(round(bot - HI * H)), int(round(bot - LO * H))
    d.rectangle([(0, yb0), (a.shape[1], yb1)], fill=TEAL + (40,))
    # the chest line at q
    y = int(round(bot - q * H))
    r = runs(a[y])
    cx = np.median(np.where(a[int(bot - 0.55 * H)])[0])
    if view == "mask":
        mid = [ab for ab in r if ab[0] <= cx < ab[1]]
        if measurable and mid:
            l, rr = mid[0]
            col, dash = ORANGE, False
        else:  # arms touching: the run includes them, so the page's formula cannot use it
            l, rr = min(x for x, _ in r), max(x for _, x in r)
            col, dash = RED, True
    else:
        l, rr = max(r, key=lambda ab: ab[1] - ab[0])
        col, dash = ORANGE, False
    w = 12
    if dash:
        for x in range(l, rr, 30):
            d.line([(x, y), (min(x + 18, rr), y)], fill=col, width=w)
    else:
        d.line([(l, y), (rr, y)], fill=col, width=w)
    for x in (l, rr):
        d.line([(x, y - 26), (x, y + 26)], fill=col, width=w)
    # crop round the body, keeping the aspect, into the cell
    pad = 16
    x0, x1 = max(0, xs.min() - pad), min(a.shape[1], xs.max() + pad)
    y0, y1 = max(0, top - pad), min(a.shape[0], bot + pad)
    crop = im.crop((x0, y0, x1, y1))
    s = min(CELL_W / crop.width, CELL_H / crop.height)
    crop = crop.resize((max(1, int(crop.width * s)), max(1, int(crop.height * s))), Image.LANCZOS)
    cell = Image.new("RGB", (CELL_W, CELL_H), (244, 244, 244))
    cell.paste(crop, ((CELL_W - crop.width) // 2, (CELL_H - crop.height) // 2))
    return cell


people = []
cells = []
for split in ["testA", "testB"]:
    P = S[split]
    learned = model(feats(P, "profiles+height"))
    order = {}
    for i, sid in enumerate(P["sid"]):
        order.setdefault(sid, []).append(i)
    for sid, idx in order.items():
        pages = [(page_estimate(P, i), i) for i in idx]
        pv = [v for (v, q), i in pages if v is not None]
        show = next((i for (v, q), i in pages if v is not None), idx[0])
        (_, qshow) = page_estimate(P, show)
        measurable = qshow is not None
        q = qshow or 0.72
        chest = float(P["chest"][idx[0]])
        rec = dict(
            id=len(people),
            set="A" if split == "testA" else "B",
            female=bool(P["female"][idx[0]]),
            height=round(float(P["height"][idx[0]]), 1),
            chest=round(chest, 1),
            photos=len(idx),
            photosClear=len(pv),
            page=round(float(np.mean(pv)), 1) if pv else None,
            pageErr=round(float(np.mean(pv)) - chest, 2) if pv else None,
            learned=round(float(np.mean(learned[idx])), 1),
            learnedErr=round(float(np.mean(learned[idx])) - chest, 2),
            shown=dict(pid=str(P["pid"][show]), q=q, measurable=measurable,
                       width=round(float(P["torso"][show, FR.index(q)]), 1) if measurable else None,
                       depth=round(float(P["depth"][show, FR.index(q)]), 1)),
        )
        people.append(rec)
        cells.append((drawn(split, P["pid"][show], "mask", q, measurable), drawn(split, P["pid"][show], "mask_left", q, True)))

# sprite sheet: each person a front cell and a side cell, 20 people a row
PER_ROW = 20
rows = (len(cells) + PER_ROW - 1) // PER_ROW
sheet = Image.new("RGB", (PER_ROW * 2 * CELL_W, rows * CELL_H), (244, 244, 244))
for k, (f, s) in enumerate(cells):
    x, y = (k % PER_ROW) * 2 * CELL_W, (k // PER_ROW) * CELL_H
    sheet.paste(f, (x, y))
    sheet.paste(s, (x + CELL_W, y))
os.makedirs("gallery", exist_ok=True)
# a fixed palette, so the marks keep their exact colours: the grey outline on the grey ground, each of
# them under the teal band, and the two line colours
pal_cols = [(244, 244, 244), (70, 70, 70), (217, 230, 230), (54, 89, 92), ORANGE, RED, (255, 255, 255), (150, 150, 150), (200, 205, 205), (110, 120, 121)]
pal = Image.new("P", (1, 1)); flat = [c for col in pal_cols for c in col]; pal.putpalette(flat + [0] * (768 - len(flat)))
sheet.quantize(palette=pal, dither=Image.Dither.NONE).save("gallery/sprite.png", optimize=True)
json.dump(dict(people=people, cell=[CELL_W, CELL_H], perRow=PER_ROW, ridgeLambda=lam), open("gallery/people.json", "w"))
pe = np.array([p["pageErr"] for p in people if p["pageErr"] is not None])
le = np.array([p["learnedErr"] for p in people])
print(len(people), "people;", len(pe), "with the page formula; page MAE %.2f, learned MAE %.2f" % (np.abs(pe).mean(), np.abs(le).mean()))
for st in "AB":
    a = np.array([p["learnedErr"] for p in people if p["set"] == st]); b = np.array([p["pageErr"] for p in people if p["set"] == st and p["pageErr"] is not None])
    print(st, "learned MAE %.2f (n=%d), page MAE %.2f (n=%d)" % (np.abs(a).mean(), len(a), np.abs(b).mean(), len(b)))

# numbered contact sheets for the audit: 50 people each, 10 a row
from PIL import ImageFont
font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
for start in range(0, len(cells), 50):
    chunk = cells[start:start + 50]
    sh = Image.new("RGB", (10 * 2 * CELL_W, ((len(chunk) + 9) // 10) * (CELL_H + 30)), (255, 255, 255))
    dd = ImageDraw.Draw(sh)
    for k, (f, s_) in enumerate(chunk):
        x, y = (k % 10) * 2 * CELL_W, (k // 10) * (CELL_H + 30)
        sh.paste(f, (x, y + 30)); sh.paste(s_, (x + CELL_W, y + 30))
        dd.text((x + 6, y + 4), f"#{start + k}", fill=(0, 0, 0), font=font)
        dd.line([(x, y), (x, y + CELL_H + 30)], fill=(200, 200, 200), width=2)
    sh.save(f"gallery/sheet-{start // 50:02d}.png", optimize=True)
print("sheets", (len(cells) + 49) // 50)
