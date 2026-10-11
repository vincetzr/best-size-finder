"""Chest girth from real front and side silhouettes (BodyM), against each person's measured chest.

Trains on BodyM's train people only and tests on testA and testB people, who are never seen in
training. Errors are per person (a person's photos averaged), in cm.
"""
import json

import numpy as np

S = {s: dict(np.load(f"{s}/profiles.npz")) for s in ["train", "testA", "testB"]}
FR = list(np.round(S["train"]["fracs"], 2))


def august(w, d):
    a, b = w / 2, d / 2
    ram = np.pi * (3 * (a + b) - np.sqrt((3 * a + b) * (a + 3 * b)))
    inside = (w >= 22) & (w <= 48) & (d >= 16) & (d <= 36)
    return np.where(inside, 1.418 * w + 1.015 * d + 33.52, 1.177 * ram)


def per_person(P, pred):
    out = {}
    for sid, p, c in zip(P["sid"], pred, P["chest"]):
        if np.isfinite(p):
            out.setdefault(sid, [[], c])[0].append(p)
    return np.array([np.mean(v[0]) - v[1] for v in out.values()])


def stats(e):
    e = e[np.isfinite(e)]
    return dict(n=int(len(e)), bias=round(float(e.mean()), 2), sd=round(float(e.std()), 2), mae=round(float(np.abs(e).mean()), 2),
                within1=round(float((np.abs(e) <= 1).mean() * 100)), within2=round(float((np.abs(e) <= 2).mean() * 100)), within4=round(float((np.abs(e) <= 4).mean() * 100)))


def feats(P, kind):
    lo, hi = FR.index(0.60), FR.index(0.80)
    h = P["height"][:, None]
    if kind == "depth+height":
        return np.c_[P["depth"][:, FR.index(0.72)], h]
    if kind == "profiles+height":
        return np.c_[P["depth"][:, lo:hi + 1], P["whole"][:, lo:hi + 1], h]
    raise ValueError(kind)


def ridge_fit(X, y, groups, lams=(0.01, 0.1, 1, 10, 100, 1000)):
    mu, sd = np.nanmean(X, 0), np.nanstd(X, 0) + 1e-9
    Z = np.nan_to_num((X - mu) / sd)
    ug = np.unique(groups)
    rng = np.random.default_rng(0)
    fold = dict(zip(ug, rng.integers(0, 5, len(ug))))
    f = np.array([fold[g] for g in groups])
    best = None
    for lam in lams:
        err = []
        for k in range(5):
            tr, te = f != k, f == k
            A = np.c_[np.ones(tr.sum()), Z[tr]]
            w = np.linalg.solve(A.T @ A + lam * np.diag([0] + [1] * Z.shape[1]), A.T @ y[tr])
            err.append(np.abs(np.c_[np.ones(te.sum()), Z[te]] @ w - y[te]))
        m = np.concatenate(err).mean()
        if best is None or m < best[0]:
            best = (m, lam)
    lam = best[1]
    A = np.c_[np.ones(len(y)), Z]
    w = np.linalg.solve(A.T @ A + lam * np.diag([0] + [1] * Z.shape[1]), A.T @ y)
    return lambda X2: np.c_[np.ones(len(X2)), np.nan_to_num((X2 - mu) / sd)] @ w, lam


results = {}
# 1. the page's own formula, where the chest is clear of the arms (best level per photo, at or below 0.72 of height)
for s in ["testA", "testB"]:
    P = S[s]
    W, D = np.full(len(P["chest"]), np.nan), np.full(len(P["chest"]), np.nan)
    for i in range(len(W)):
        for q in [0.72, 0.71, 0.70]:
            j = FR.index(q)
            if np.isfinite(P["torso"][i, j]):
                W[i], D[i] = P["torso"][i, j], P["depth"][i, j]
                break
    results[f"page formula, chest clear of arms ({s})"] = stats(per_person(P, august(W, D)))
# 2. learned from BodyM's training people
for kind in ["depth+height", "profiles+height"]:
    T = S["train"]
    model, lam = ridge_fit(feats(T, kind), T["chest"], T["sid"])
    for s in ["testA", "testB"]:
        results[f"learned: {kind} ({s})"] = stats(per_person(S[s], model(feats(S[s], kind))))
for k, v in results.items():
    print(f"{k:55s} {v}")
json.dump(results, open("results.json", "w"), indent=1)
