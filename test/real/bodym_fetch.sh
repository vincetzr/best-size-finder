#!/bin/bash
# Download every BodyM silhouette (front: mask/, side: mask_left/) for the three splits.
# run from the folder that should hold the data: bash bodym_fetch.sh
for s in testA testB train; do
  for v in mask mask_left; do
    mkdir -p $s/$v
    python3 - "$s/$v/" > $s/$v.keys <<'PY'
import sys, re, urllib.request, urllib.parse
prefix = sys.argv[1]; token = None
while True:
    q = {'list-type': '2', 'prefix': prefix, 'max-keys': '1000'}
    if token: q['continuation-token'] = token
    t = urllib.request.urlopen('https://amazon-bodym.s3.amazonaws.com/?' + urllib.parse.urlencode(q), timeout=60).read().decode()
    for k in re.findall(r'<Key>([^<]*\.png)</Key>', t): print(k)
    m = re.search(r'<NextContinuationToken>([^<]*)</NextContinuationToken>', t)
    if not m: break
    token = m.group(1)
PY
    cat $s/$v.keys | xargs -P 24 -I{} sh -c 'f="{}"; [ -s "$f" ] || curl -sS -m 60 --retry 3 -o "$f" "https://amazon-bodym.s3.amazonaws.com/$f"'
    echo "$s/$v: $(ls $s/$v | wc -l) of $(wc -l < $s/$v.keys)"
  done
done
