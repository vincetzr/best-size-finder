# Tests on real bodies

The page has not yet been tried on people in a shop (`FIELD.md`). These two tests use public data
of real people instead. Neither dataset is in this repository: both are free to download but limited
to research use (BodyM: CC BY-NC 4.0; NOMO-3d-400: scientific research only), so they are for
measuring the method, not for building anything that ships.

## BodyM: the two pictures, on 2,505 real people

Amazon's BodyM has front and side silhouettes of real people, made from phone photos, with each
person's chest girth and height taken from a 3D scan. The people stand with their arms a little
away from the body, not out to the sides as the page asks, so their arms cover the chest in most
front views. There are no hops, so each person's measured height sets the scale instead.

    mkdir bodym && cd bodym
    bash ../bodym_fetch.sh                       # about 9,000 small PNGs, from s3://amazon-bodym
    for s in train testA testB; do python3 ../bodym_profiles.py $s; done
    python3 ../bodym_evaluate.py                 # trains on train, scores testA and testB

## NOMO-3d-400: the quarter turn, on 356 real body scans

Real people scanned in tight underwear (TC2 scanner), with the scanner's own chest or bust girth.
The script cuts each scan at chest height, keeps the chest's own outline (the arms are separate
pieces there), and looks at it as the page's camera would during the turn: a pinhole 2.2 m away,
the silhouette's width at each angle, girth = π × the mean width.

    # https://zenodo.org/records/3735905 (690 MB); unzip the "repetitions-removed" scans and txt files
    python3 -I nomo_turn.py <folder with the extracted .obj and .txt files>

Only the women's scans give the height of the scanner's bust line, so only they make a clean test;
the men's chest girth depends mostly on where it is cut, which their files do not say.

## Results (October 2026)

| Test | Mean error | Within 1 cm |
|---|---|---|
| BodyM, the page's width-and-depth formula (photos where the chest is clear of the arms) | 4.0 cm (testB), 7.7 cm (testA) | 7–16% |
| BodyM, a model learned from both outlines and height (best two-picture result here) | 2.5 cm (testA), 3.2 cm (testB) | 21–33% |
| NOMO women, the chest's outline (what a perfect turn reads) | 0.39 cm | 97% |
| NOMO women, half turn (180°) through the page's camera | 0.62 cm | 89% |
| NOMO women, quarter turn (90°), as the page does it | 0.90 cm | 70% |
| NOMO women, the page's width-and-depth formula | 10.1 cm (always high) | 0% |

The scans are perfect outlines: no camera noise, no clothing, no breathing, and the scale is exact.
On a real customer those add to the turn's error (`HOW-IT-MEASURES.md`).
