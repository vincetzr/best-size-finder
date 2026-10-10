"""How much of a chest's girth its width and depth decide, on 6,068 real people.

ANSUR II (US Army, 2012; public domain) measured 4,082 men and 1,986 women
with a tape and calipers: chest circumference, chest breadth, chest depth,
stature. Fitting girth from breadth and depth there says how big the error
of any two-view chest is even when the width and the depth are known exactly
— the floor under the hopping page's chest, whatever the scale.

    curl -O http://tools.openlab.psu.edu/publicData/ANSUR_II_MALE_Public.csv
    curl -O http://tools.openlab.psu.edu/publicData/ANSUR_II_FEMALE_Public.csv
    python3 sim/girth_ansur.py <directory with both>

Caveat: ANSUR's breadth and depth are calipers on skin; the page reads
silhouettes of clothed people. So the August line (fitted to silhouettes,
presumably) reads low here, and a fit here would read high there. Only field
data can join the two (FIELD.md).
"""
import csv, sys, math
import numpy as np
D = sys.argv[1]
rows = []
for sex in ['MALE', 'FEMALE']:
    for r in csv.DictReader(open(f'{D}/ANSUR_II_{sex}_Public.csv', encoding='latin-1')):
        rows.append((sex == 'MALE', float(r['chestbreadth']) / 10, float(r['chestdepth']) / 10, float(r['chestcircumference']) / 10, float(r['stature']) / 10, float(r['weightkg']) / 10))
A = np.array(rows, dtype=float)
male, w, d, c, h = A[:, 0].astype(bool), A[:, 1], A[:, 2], A[:, 3], A[:, 4]
print(f'n={len(A)} (men {male.sum()}, women {(~male).sum()}); chest {c.min():.0f}-{c.max():.0f} cm; breadth {w.min():.0f}-{w.max():.0f}; depth {d.min():.0f}-{d.max():.0f}; height {h.min():.0f}-{h.max():.0f}')

def ram(a, b):
    hh = ((a - b) ** 2) / ((a + b) ** 2)
    return math.pi * (a + b) * (1 + 3 * hh / (10 + np.sqrt(4 - 3 * hh)))

def report(name, pred):
    e = pred - c
    def s(m):
        return f'bias {e[m].mean():+5.2f}  sd {e[m].std():4.2f}  mae {np.abs(e[m]).mean():4.2f}  p95 {np.percentile(np.abs(e[m]), 95):4.2f}'
    print(f'{name:44s} all: {s(np.ones_like(male))} | men: {s(male)} | women: {s(~male)}')

# the August line, inside its box, ellipse x1.177 outside
inside = (w >= 24) & (w <= 62) & (d >= 13) & (d <= 44)
aug = np.where(inside, 1.418 * w + 1.015 * d + 33.52, ram(w / 2, d / 2) * 1.177)
print(f'inside the August box: {inside.mean()*100:.1f}%')
report('August line (as shipped)', aug)
report('Ramanujan ellipse x1.177', ram(w / 2, d / 2) * 1.177)

# cross-validated fits, sex-agnostic (the page does not know sex)
rng = np.random.default_rng(0)
idx = rng.permutation(len(A))
folds = np.array_split(idx, 10)
def cv(X):
    pred = np.zeros(len(A))
    for k in range(10):
        test = folds[k]
        train = np.setdiff1d(idx, test)
        beta, *_ = np.linalg.lstsq(X[train], c[train], rcond=None)
        pred[test] = X[test] @ beta
    beta, *_ = np.linalg.lstsq(X, c, rcond=None)
    return pred, beta
one = np.ones(len(A))
P = ram(w / 2, d / 2)
for name, X in [
    ('fit: a w + b d + c', np.c_[w, d, one]),
    ('fit: k * ellipse', np.c_[P]),
    ('fit: k * ellipse + c', np.c_[P, one]),
    ('fit: a w + b d + c + e h', np.c_[w, d, one, h]),
    ('fit: k ellipse + c + e h', np.c_[P, one, h]),
    ('fit: w, d, w*d, h, c', np.c_[w, d, w * d, h, one]),
]:
    pred, beta = cv(X)
    report(name + ' (10-fold CV)', pred)
    print(' ' * 46, 'coefficients', np.round(beta, 4))
