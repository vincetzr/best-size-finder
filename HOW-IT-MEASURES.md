# How the hopping page measures

`scan/` measures a customer for a BEST vest from the front camera of a phone or
tablet and asks them nothing: no height, no weight, no card, nobody of known
height standing on a mark first. This is how, what it rests on, and what has and
has not been shown.

## The problem it solves

A photograph has no size in it. One view of a body at an unknown distance is
scale-free as a matter of geometry, and no browser hands over a distance —
Safari on iOS exposes no LiDAR, no depth, no WebXR and no camera intrinsics. So a
known length has to enter from somewhere, and every sizing app asks the customer
for it: Bodygram and 3DLOOK require height (and weight), MTailor asks height.
The August version of this page tried everything else:

| scale source | what happened |
|---|---|
| sonar chirp from the tablet's speaker | measured the tablet's own ringing, not the person ("0.43 m, three times over"); retracted |
| bank card or A4 sheet held at the chest | seen in 29 of 40 real photographs, within a fifth in 2 of 6 marked by hand |
| a person of known height on a mark | right, once per installation, and wrong as soon as anyone stands elsewhere |
| head width, 19.3 cm | ±9 % between people: ±10 cm on a chest |
| asking height and weight | ±3 cm — which is why its landing page ended up leading with it |

## Gravity is the ruler

While both feet are off the floor, a body is in free fall, and free fall is
9.81 m/s² for everyone. Follow a point on the trunk through a hop and its
acceleration in the picture comes out in pixels per second squared; divided by g,
that is **pixels per metre at the body itself** — not at a card held some
centimetres in front of it, not at a mark on the floor.

What has to be true, and how the page makes it so:

1. **The frames' capture times are known.** The answer is in seconds squared, so
   a mistimed frame is a misplaced point. `src/timing.js` takes the capture clock
   from `requestVideoFrameCallback` and, when the stamps scatter, snaps them back
   onto the camera's own regular grid — from the browser's own frame count
   where it gives one, otherwise by a periodogram — used only when the scatter
   is white (`test/timing.test.mjs`; in the table below, 5 ms of jitter scatters
   0.59 per cent against 0.57 for none).
2. **The trunk moves with the centre of mass in the air.** It does when the body
   is held still: hands on hips, knees straight, the ankles doing the hopping.
   Folding the legs moves the centre of mass against the trunk and reads as
   gravity being stronger or weaker (the NOT RIGID rows below). The page watches
   the legs with the pose model and drops any hop in which they shortened, against
   the trunk, by more than 3 per cent: about a 20° fold of the knees, which by the
   segment model moves the centre of mass about 2 mm against the trunk — worth
   about a per cent by the table, at worst.
3. **Only flight is fitted.** Ground force rises from nothing at touch-down, so
   the first frame on the ground sits almost on the parabola — the trap that
   makes this harder than it looks. Contact can only hold a body *up* against
   free fall, so the end of each flight is found with a one-sided test, and one
   more sample is taken off each end. On the simulator that one sample is the
   difference between a bias of −0.8 per cent and one of 0.1.
4. **The point is tracked to a fraction of a pixel.** A template of the neck,
   shoulders, upper arms and chest — rigid in that pose, and edged against the
   room — is followed by Lucas–Kanade against the first frame, not frame to frame,
   so it cannot drift (`src/track.js`). Pose landmarks jitter by pixels and are
   smoothed in time, so they are not used for this.
5. **The camera's tilt is taken out.** Free fall seen by a tilted camera is
   foreshortened and, off-centre, bent by perspective. The tablet's accelerometer
   gives its pitch and roll (`src/level.js`); the picture is rectified to what a
   level camera would have seen, in which a fall is exactly a parabola. A level
   on the screen asks for the tablet upright to within 5°; with that, a focal
   length a fifth out costs under 0.6 per cent. Tilted 20° with the picture
   rectified, a 40 cm chest measures 39.9 cm, as it does through a level camera
   (`test/level.test.mjs`).

Every hop is a reading; they share one acceleration and are fitted together, and
the spread between them sets the error bar — which, on every case simulated, is
the size of the error actually made.

The idea is not new: Bieler, Günel, Fua and Salzmann (ICCV 2019, "Gravity as a
Reference for Estimating a Person's Height from Video") estimated people's height
from jumps to 2.3 per cent with pose keypoints at 30 Hz, and named keypoint
jitter as the main error. What is new here is aimed at exactly that: a rigid,
sub-pixel trunk template instead of keypoints; a one-sided, trimmed flight
window instead of hand-picked segments; several hops fitted jointly; the frame
clock recovered; and the camera's tilt read off its own accelerometer.

### On the simulator

`sim/hopper.mjs` is a spring-mass hopper — free fall in the air, a half-sine
ground force on the floor, peaking at two to three times body weight — seen by a
pinhole camera, with every departure from the ideal switchable. 200 runs a case,
five hops, 30 fps, scale error in per cent (`node sim/montecarlo.mjs`):

| case | bias % | scatter % | 95th pct of error % | claimed % | refused |
|---|---:|---:|---:|---:|---:|
| ideal: no noise at all | 0.04 | 0.00 | 0.04 | 0.00 | 0/200 |
| nominal: 30 fps, 0.4 px tracker noise | 0.17 | 0.57 | 1.23 | 0.69 | 0/200 |
| 60 fps | 0.04 | 0.37 | 0.70 | 0.36 | 0/200 |
| tracker noise 1 px | 0.24 | 1.20 | 2.32 | 1.38 | 0/200 |
| short hops (0.20 s in the air) | 0.22 | 1.13 | 2.45 | 1.19 | 0/200 |
| camera rolled 8° | 0.17 | 0.58 | 1.17 | 0.69 | 0/200 |
| rolling shutter, 30 ms readout down the rows | 0.06 | 0.63 | 1.19 | 0.71 | 0/200 |
| motion blur, 25 ms exposure | 0.17 | 0.62 | 1.23 | 0.71 | 0/200 |
| timestamps jittered 2 ms | 0.17 | 0.58 | 1.25 | 0.69 | 0/200 |
| timestamps jittered 5 ms | 0.17 | 0.59 | 1.23 | 0.69 | 2/200 |
| one frame in ten lost | 0.10 | 0.76 | 1.43 | 0.77 | 2/200 |
| tracking slips: 3% of frames 12 px off | 0.08 | 0.70 | 1.35 | 0.74 | 1/200 |
| drifting towards the camera 5 cm/s | 0.73 | 0.85 | 1.93 | 0.85 | 0/200 |
| trunk wobble on landing, 3 mm | 0.13 | 0.67 | 1.40 | 0.76 | 0/200 |
| NOT RIGID: trunk sinks 5 mm late in flight | 2.46 | 0.94 | 4.28 | 0.96 | 0/200 |
| NOT RIGID: trunk sinks 10 mm late in flight | 4.53 | 1.28 | 6.74 | 1.05 | 0/200 |
| NOT RIGID: trunk dips 5 mm mid-flight | -5.37 | 0.77 | 6.60 | 0.71 | 0/200 |

A refusal is the page asking for the hops again, never a number.

The last three rows are the honest limit of physics alone: a body that is not
rigid in the air reads wrong, and its error bar does not know. That is what the
knee check is for, and it is why the instruction is *knees straight, from the
ankles*. Correcting for the legs instead — adding the pose model's centre of
mass to the tracked trunk — removes the bias exactly when the pose is accurate
to 0.3 px, and costs more than it saves at 0.8 px, so the page gates rather
than corrects.

## Carrying the scale to the two pictures

The hops give pixels per metre where the customer stood. The chest is then
photographed facing (arms out, for the width) and side on (arms up, for the
depth). Between pictures a customer may shuffle a few centimetres, which at two
and a half metres is a per cent or two; so the scale is carried by their own
nose-to-heel height in pixels, which neither raising the arms nor turning on the
spot changes. The girth comes from width and depth by the August page's fit to
tape-measured bodies (1.418 w + 1.015 d + 33.52, Ramanujan's ellipse outside it),
ported as it was (`src/sizing.js`), and BEST's chart from there.

## Where the error is now: the chest's shape

With the scale at about one per cent, it is no longer what decides the size.
A girth worked out from one width and one depth has to assume the shape in
between, and ANSUR II (the US Army's 2012 survey: 4,082 men and 1,986 women,
tape and calipers, public domain) says what that costs even when the width and
depth are exact (`sim/girth_ansur.py`, ten-fold cross-validated):

| girth from | error SD | mean miss | men | women |
|---|---:|---:|---:|---:|
| breadth and depth, best straight line | 3.64 cm | 2.92 cm | −1.7 cm | +3.4 cm |
| the same, and height (which the hops now give) | 3.37 cm | 2.69 cm | −1.2 cm | +2.5 cm |

So: about ±3.5 cm whatever the scale — the August page's asserted 4 per cent
was about right — and most of what is left is that the same width and depth
make a different girth on a man and on a woman. Height helps a little. The page
keeps the August line rather than one fitted here, because ANSUR's calipers on
skin are not the page's silhouettes on clothes (the August line reads 3 cm low on
ANSUR, consistent with its having been fitted to silhouettes); the field rows
(`FIELD.md`) are what can settle it.

The way past it is not a better guess at the shape but not guessing: a tape
follows the chest's convex outline, and by Cauchy's formula that outline's
length is π times its mean width over a half turn (a quarter, for a body the
same on both sides). So the side picture is now the end of a slow quarter turn,
arms up, and every frame of it is a width at an angle. The angle comes from how
far apart the shoulders look against how far apart they looked facing — least
sure near facing and near side on, which is exactly where a chest's width
hardly changes, so the mean barely notices (`test/sizing.test.mjs`: a squarer-
than-elliptical chest read through noisy angles, within 2 per cent; clean,
within 1). The August page built the same measurement and hid it behind
`?turn=1`, because without a scale it had nothing to multiply the widths by.

When the turn is read, the answer weighs it against the two-view line by how
sure each is (2 per cent against 4, the August page's own figures for each,
neither yet checked against a tape), and says if they disagree by more than
either should be wrong by. When it is not — turned too fast, or not all the way —
the two-view line stands alone, and the answer says why. It matters for which
size: at ±4 cm the two-view line alone cannot separate sizes 4 cm apart (2X Small
to Large) — the best of two neighbours always wins by less than twenty points,
and the page says it is close to a coin toss. At the turn's ±2 cm it usually can. End to end, a drawn
chest whose outline is 99.5 cm round read 99.6 by the turn, where the two-view
line, assuming a typical chest's shape, said 106.9. Which of the two is nearer
the tape on real customers is the first thing the field rows will show.

## The second ruler: the eyes

The iris is 11.7 mm across in nearly every adult (11.71 ± 0.42 mm, Rüfer and
others 2005; MediaPipe's own model assumes 11.7). When a customer taps Start they
are at arm's length and the iris is twenty-odd pixels: the page reads it, and
from it the distance between their eyes in millimetres. At the hopping distance
the eyes are a few pixels each, but the distance between them is still thirty,
so it carries a second, independent scale out to where they stand — about
4 per cent, against gravity's one. It is a cross-check: if the two disagree by
more than they should, the page says so. And for someone who cannot hop, it is
the scale, with the margin it deserves (`src/iris.js`).

## What the camera alone cannot do, and what was not tried

- **LiDAR and depth** are not available to web pages on iOS at all, and WebXR's
  depth on Android needs the phone to move (depth from motion) and uses the rear
  camera. A native App Clip with ARKit body tracking would get metric depth on a
  LiDAR iPad; that is a different product.
- **Sound** can range between two devices to a centimetre (BeepBeep, 2007), but
  a distance is no use without the camera's focal length, which browsers do not
  give either. Gravity makes both unnecessary.

## What has been shown, and what has not

Shown, by the tests in this repository: that the arithmetic is right on every
simulated departure from the ideal; that the error bar it claims is the error it
makes; that tilt and roll are removed; that it refuses rather than guesses; and,
end to end, that the page itself, in Chromium, watching through the browser's
fake camera a video of a real person — a 1902 photograph from the Library of
Congress, cut out by the page's own pose model and moved along a simulated hop
at a chosen scale, with motion blur, sensor noise and JPEG compression —
recovers that scale. Four runs: 0.29, 0.20, 0.30 and 0.42 per cent out, each
claiming ±1.1 (no accelerometer in a headless browser, so the pitch is taken
on trust); the height it reported, 173.2–173.4 cm against 175.0, short by the
height of the heel landmark above the floor (`test/e2e/`).

That machine saw 27 frames a second once it stopped running the pose model
during the hops — which, in software graphics, took 400 ms a call. On a slow
device the page does the same: the hops get the frames, the knees go unwatched,
and the answer says so.

Not shown: how rigid real people are in the air, how well the shoulders give
the angle of a real turn, and how close the chest girth comes to a tape on real
customers. Both need people and a tape measure, and
`FIELD.md` says how to collect them. Until then, every accuracy number above is
a statement about the method, not about the shop floor.
