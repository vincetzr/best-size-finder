"""Download the two free samples of real phone photos with a tape chest, and the survey the height and
weight guess is fitted on.

    python3 -I photos_fetch.py <folder>

- UniqueData "Body Measurements Dataset" (21 people) and Unidata "Body Measurements Image Dataset"
  (6 people), from Hugging Face. CC BY-NC-ND 4.0: non-commercial use, no changes. Not for this
  repository.
- ANSUR II (US Army, public domain), for the height + weight lines.

Writes <folder>/people.json: one entry per person, with the dataset's tape chest, height, weight and
sex, and "sameAs" for a person whose photos are byte for byte another's (three of Unidata's six are
UniqueData's). Values the dataset marks "_tbr" (to be reviewed) are kept, flagged.
"""
import csv
import hashlib
import json
import os
import subprocess
import sys
import urllib.parse

out = os.path.realpath(sys.argv[1])
os.makedirs(out, exist_ok=True)
SETS = [
    ("uniquedata", "UniqueData/body-measurements-dataset", lambda p: p.endswith(("front_img.jpg", "side_img.jpg", "measurements.json")) or p in ("README.md", "body.csv")),
    ("unidata", "ud-biometrics/body-measurements-image-dataset", lambda p: p.endswith(("front_img.jpg", "side_img.jpg", ".csv")) or p == "README.md"),
]


def fetch(url, target):
    target = os.path.realpath(target)
    assert target.startswith(out + os.sep)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    if not os.path.exists(target):
        subprocess.run(["curl", "-sS", "-L", "-f", "-m", "120", "--retry", "3", "-o", target, url], check=True)


for name, repo, want in SETS:
    tree = os.path.join(out, name, "tree.json")
    fetch(f"https://huggingface.co/api/datasets/{repo}/tree/main?recursive=true", tree)
    for x in json.load(open(tree)):
        if x["type"] == "file" and want(x["path"]):
            fetch(f"https://huggingface.co/datasets/{repo}/resolve/main/{urllib.parse.quote(x['path'])}", os.path.join(out, name, x["path"]))
for s in ["MALE", "FEMALE"]:
    fetch(f"https://tools.openlab.psu.edu/publicData/ANSUR_II_{s}_Public.csv", os.path.join(out, "ansur", f"ANSUR_II_{s}_Public.csv"))


def num(v):
    v = str(v)
    return float(v.replace("_tbr", "")), v.endswith("_tbr")


people = []
base = os.path.join(out, "uniquedata", "files")
for i in sorted((d for d in os.listdir(base) if d.isdigit()), key=int):
    m = json.load(open(os.path.join(base, i, "measurements.json")))
    people.append(dict(source="UniqueData", id=int(i), m=m, dir=f"uniquedata/files/{i}"))
sheet = next(f for f in os.listdir(os.path.join(out, "unidata")) if f.endswith(".csv"))
for r in csv.DictReader(open(os.path.join(out, "unidata", sheet))):
    people.append(dict(source="Unidata", id=int(r["set_id"]), m=r, dir=f"unidata/{r['set_id']}"))

seen = {}
for p in people:
    m = p.pop("m")
    chest, flag = num(m["chest_circumference_cm"])
    p.update(key=f"{p['source'].lower()}-{p['id']:02d}", chest=chest, chestFlag=flag, height=num(m["height"])[0],
             weight=num(m["weight"])[0], female=m["gender"] == "female",
             front=f"{p.pop('dir')}/front_img.jpg")
    p["side"] = p["front"].replace("front_img", "side_img")
    digest = hashlib.sha256(b"".join(open(os.path.join(out, p[v]), "rb").read() for v in ("front", "side"))).hexdigest()
    p["sameAs"] = seen.get(digest)
    seen.setdefault(digest, p["key"])
json.dump(people, open(os.path.join(out, "people.json"), "w"), indent=1)
print(len(people), "entries;", sum(p["sameAs"] is None for p in people), "different people;",
      sum(p["chestFlag"] for p in people if p["sameAs"] is None), "chest values marked to be reviewed")
