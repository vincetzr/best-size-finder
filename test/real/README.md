# Tests on real bodies

The page has not yet been tried on people in a shop (`FIELD.md`). These tests use public data of
real people instead. None of the data is in this repository: all of it is free to download but
limited to research or non-commercial use (BodyM: CC BY-NC 4.0; NOMO-3d-400: scientific research only;
the phone photos: CC BY-NC-ND 4.0), so it is for measuring the method, not for building anything
that ships.

## BodyM: the two pictures, on 2,505 real people

Amazon's BodyM has front and side silhouettes of real people, made from phone photos, with each
person's chest girth and height taken from a 3D scan. The people stand with their arms a little
away from the body, not out to the sides as the page asks, so their arms cover the chest in most
front views. There are no hops, so each person's measured height sets the scale instead.

    mkdir bodym && cd bodym
    bash ../bodym_fetch.sh                       # about 9,000 small PNGs, from s3://amazon-bodym
    for s in train testA testB; do python3 ../bodym_profiles.py $s; done
    python3 ../bodym_evaluate.py                 # trains on train, scores testA and testB
    python3 ../bodym_gallery.py                  # each person's numbers, and their outlines drawn with what was measured

Every drawing was checked by eye (October 2026). In 117 of the 487 people a mistake changes the
measurement: 84 broken outlines (most often the feet cut off at the bottom of the side photo, which
throws the scale), 14 lines that take in part of an arm (a pinhole at the armpit can pass for a gap),
11 lines that miss the fullest part of the chest (a fixed 72% of height does not suit everyone), and
6 usable photos skipped. Without them the learned model's error is 2.8 cm and the formula's 4.3 cm.

## NOMO-3d-400: the quarter turn, on 356 real body scans

Real people scanned in tight underwear (TC2 scanner), with the scanner's own chest or bust girth.
The script cuts each scan at chest height, keeps the chest's own outline (the arms are separate
pieces there), and looks at it as the page's camera would during the turn: a pinhole 2.2 m away,
the silhouette's width at each angle, girth = π × the mean width.

    # https://zenodo.org/records/3735905 (690 MB); unzip the "repetitions-removed" scans and txt files
    python3 -I nomo_turn.py <folder with the extracted .obj and .txt files>

Only the women's scans give the height of the scanner's bust line, so only they make a clean test;
the men's chest girth depends mostly on where it is cut, which their files do not say.

## Real phone photos: 22 adults, front and side, with a tape chest

The only real photos with a tape chest we found free to download: two small samples on Hugging Face
(UniqueData, 21 people; Unidata, 6, three of whom are UniqueData's), CC BY-NC-ND 4.0. Two of the 24
are children and are left out. People took their own photos at home, arms down by their sides, in
everyday clothes, the phone usually low and tilted up; the chest is by tape, with photos of the
measuring, by whom is not said. No hops and no turn, so the page's own method cannot run: each
person's stated height stands in for the ruler.

    python3 -I photos_fetch.py photos                # the two samples and ANSUR II, into ./photos
    node photos_measure.mjs photos                   # the page's pose model and measuring code
    python3 -I photos_score.py photos [bodym]        # each method against the tape

The page refuses all 22, rightly: the arms touch the body at chest height in every front photo, one
side photo cuts off the top of the head and one hides the far foot. Its formula forced onto those
numbers reads 31 cm high, because the arms are counted as chest. Height and weight alone, the
questions size websites ask (lines fitted on ANSUR II), miss by 3.2 cm on average. The model learned
on BodyM's outlines misses by 10.5 cm, mostly high: BodyM's people wore tight clothes, these people
loose ones. On many side photos the pose model's heel point sits at the ankle, not the floor; the
page places its side chest line from that point (`FIELD.md`).

## Results (October 2026)

| Test | Mean error | Within 1 cm |
|---|---|---|
| BodyM, the page's width-and-depth formula (photos where the chest is clear of the arms) | 4.0 cm (testB), 7.7 cm (testA) | 7–15% |
| BodyM, a simple model learned from both outlines and height (Amazon's own network: 1.9 cm on testA) | 2.5 cm (testA), 3.2 cm (testB) | 21–33% |
| NOMO women, the chest's outline (what a perfect turn reads) | 0.39 cm | 97% |
| NOMO women, half turn (180°) through the page's camera | 0.62 cm | 89% |
| NOMO women, quarter turn (90°), as the page does it | 0.90 cm | 70% |
| NOMO women, the page's width-and-depth formula | 10.1 cm (always high) | 0% |
| Real photos (22 adults), the page | refused all 22 (arms down, no hops) | – |
| Real photos, the page's formula forced on them | 31 cm (20 people, always high) | 0% |
| Real photos, height + weight only (what size websites ask) | 3.2 cm | 18% |
| Real photos, the model learned on BodyM | 10.5 cm (20 people) | 0% |

The scans are perfect outlines, turned on a computer with every angle and the scale known exactly,
and checked against the scanner's own bust number, not a tape. The quarter turn moves about 0.2 cm
for each degree the customer starts off square, which is most of its gap to the half turn; the page
cannot yet read an angle past 90°. Two cuts caught part of an arm and are counted in the averages.
On a real customer, camera noise, clothing, breathing and the scale add to the turn's error
(`HOW-IT-MEASURES.md`).
