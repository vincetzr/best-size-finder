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
   0.59 per cent against 0.57 for none). Safari has one trap of its own: when
   two camera frames arrive while the page is busy, it hands over the newer
   pixels with the older frame's stamp, and counts one frame, not two. Such a
   frame looks a camera period older than usual when it is delivered, so each
   frame's delay is held against the recent median and one more than three
   quarters of a period over it is left out (`StampCheck`). On a model of
   WebKit's delivery at 60 fps with the pose model running between frames,
   that catches 98 per cent of them and keeps 99.7 per cent of good frames;
   the earlier test, on how long the previous callback ran, caught none.
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

### Where on the body the ruler is

The ruler is pixels per metre where the tracked box is, and that is the front
of the trunk; everything measured with it — the outline's edges side to side
and front to back, the top of the head, the heels — is in the body's middle
plane, about half a chest's depth further from the camera. At two and a half
metres twelve centimetres is five per cent: uncorrected, every length would
read five per cent small, a 175 cm customer 166. Neither the simulator nor the
end-to-end video could show it — both are flat.

Not all of the box is in front, though. For the up-and-down of a hop the
tracker follows the lines that run across the picture: the tops of the
shoulders and the elbows against the room, which are in the middle plane, and
the shirt's collar, seams and pattern, which are on the front. A plain shirt is
mostly outline, a striped one mostly front. So the page takes the tracked
surface as a quarter of the chest's depth in front of the middle, plus a
centimetre, and its error bar takes in the whole range (a seventh of the depth
as a standard deviation, and the focal length's doubt in turning centimetres
into a share). It starts from a typical 24 cm chest and, once the side picture
has measured this customer's, redoes it with theirs (`middlePlane` in
`src/gravity.js`). That doubt — about two per cent at two metres — is now the
largest part of the scale's, bigger than the hops' own; how the tracker splits
its attention between outline and shirt is the thing to measure next.

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

## Carrying the scale to the chest

The hops give pixels per metre where the customer stood. The chest is then read
twice over: a picture facing, arms out like a T, for its width; and a slow
quarter turn with the arms up, ending side on, for its depth — and, frame by
frame, its width at every angle in between (next section). Between the hops and
the pictures a customer may shuffle a few centimetres, which at two and a half
metres is a per cent or two; so the scale is carried by their own nose-to-heel
height in pixels, which raising the arms does not change. Turning does: side on,
the nearer heel is half a stance nearer the camera and lower in the picture, a
few per cent at two metres. So the turn is carried once, from the moment the
customer stands facing with their arms up before it begins, and that distance
holds for the whole turn — they turn with their feet where they are. Widths are
taken across the line of sight: a customer standing off to one side of the
camera's axis is drawn a little wider than they are, by the cosine of the angle
off it. From the width and depth alone the girth comes by the August page's fit
to tape-measured bodies (1.418 w + 1.015 d + 33.52, Ramanujan's ellipse outside
it), ported as it was (`src/sizing.js`), and BEST's chart from there.

## Where the error is now: the chest's shape

Even with the scale at two per cent, it is not what decides the size.
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
arms up, and every frame of it is a width at an angle. The August page built the
same measurement and hid it behind `?turn=1`, because without a scale it had
nothing to multiply the widths by.

The angle comes from how far apart the shoulders look, across the level picture
(not up and down: a camera below the shoulders sees the nearer one higher),
against how far apart they looked facing. In perspective that span is the
cosine of the angle to the line of sight, not to the camera's axis: a customer
standing off to one side faces the tablet already turned a few degrees to the
line they are seen along, and their shoulders meet in the picture when one
points at the tablet, which is not a right angle in the room. Read that way —
cos θ = the span's share times the cosine of the angle off the axis — the turn
comes to the tape within 0.6 per cent wherever the page lets a customer stand,
turning either way, or past side on, through an exact pinhole camera
(`test/sizing.test.mjs`); the calibration this replaced, which took wherever the
turn stopped as side on, was off by one to two per cent for every tenth of their
distance a customer stood off the axis. The angle is least sure near facing and
near side on, which is where a chest's width hardly changes, so the mean barely
notices; and the bin at each end can stand in for its neighbour for the same
reason.

Side on is where the customer stops turning, and the page never says *hold
still* before then: a chest seen ten degrees short of side on reads up to six
per cent deep if it is squarer than an ellipse, and an early *hold still* is
exactly what stops people short. Stopped short, they are nudged once to come
the rest of the way; still short, the depth is corrected for the angle as an
ellipse (exact for one, part of the excess for a squarer chest).

When the turn is read, the answer weighs it against the two-view line by each
one's own error — the two-view line's assumed shape (4 per cent) and the scatter
between its frames, against the turn's 2 (the August page's figures, neither yet
checked against a tape) — and adds the scale's error once, at the end, because
both were read with the same scale: it neither shrinks by averaging nor shows in
their difference. If they disagree by more than three of their own errors, it
gives their middle, wide enough to cover both, and says so. When the turn was
not read — turned too fast, or not all the way — the two-view line stands
alone, and the answer says why. It matters for which size: at ±4 cm the
two-view line alone cannot separate sizes 4 cm apart (2X Small to Large) — the
best of two neighbours always wins by less than twenty points, and the page says
it is close to a coin toss. At the turn's ±2 cm it usually can. End to end, a
drawn chest whose outline is 99.6 cm round, drawn in perspective with the
customer off the camera's axis, read 100.1 by the turn (100.3 against 99.7 on
another run), where the two-view line, assuming a typical chest's shape, said
108.0. Which of the two is nearer the
tape on real customers is the first thing the field rows will show.

## The second ruler: the eyes

The iris is 11.7 mm across in nearly every adult (11.71 ± 0.42 mm, Rüfer and
others 2005; MediaPipe's own model assumes 11.7). When a customer taps Start they
are at arm's length and the iris is twenty-odd pixels: the page reads it, and
from it the distance between their eyes in millimetres. At the hopping distance
the eyes are a few pixels each, but the distance between them is still thirty,
so it carries a second, independent scale out to where they stand, to the
middle of the body as gravity's is — about 4 per cent, against gravity's two.
It is a cross-check: if the two disagree by
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

## On real bodies

Three public datasets of real people test the chest part (`test/real/`); none has hops, so the
scale is taken from each person's measured height or from the scan itself.

- **BodyM** (Amazon; 2,505 people, front and side silhouettes from phone photos, chest from a 3D
  scan). The people stand with their arms near the body, so the chest is clear of the arms in the
  front view in only a few per cent of photos at chest height — the reason the page asks for arms
  out. Where it is clear, the page's width-and-depth line misses by 4.0 cm on average (testB) and
  7.7 cm (testA). A simple model learned from both outlines and height misses by 2.5–3.2 cm, no
  better than guessing from sex, height and weight (2.8–3.1 cm); Amazon's own network, with the same
  outlines and height, reaches 1.9 cm on testA. Two pictures do not reach 1 cm on real bodies.
- **NOMO-3d-400** (356 people scanned in tight underwear, with the scanner's own chest or bust
  girth). Cutting each scan at the scanner's bust height and turning it in front of the page's
  camera, on the 177 women (the men's chest height is not recorded): the chest's outline, which a
  perfect turn reads, agrees with the scanner's bust girth to 0.39 cm on average (97 per cent within
  1 cm); a half turn (180°) through the camera to 0.62 cm (89 per cent); the page's quarter turn to
  0.90 cm (70 per cent). The quarter turn loses to the half mostly because it needs the customer to
  start square to the camera — each degree off moves it about 0.2 cm, and scanned people stand a
  degree or two turned — and partly because a chest is not quite the same on both sides; a half turn
  needs neither, though the page cannot yet read an angle past 90°. Two cuts caught part of an arm
  (11.5 and 14.3 cm out) and are counted. The width-and-depth line reads 10.1 cm high on these bare
  bodies.
- **Phone photos** (two free samples, 24 people, front and side photos taken at home in everyday
  clothes, chest by their own tape). The arms hang against the body and two side photos cut off the
  head, so the page refuses all 24. Forced, its width-and-depth line reads 31 cm high, the arms
  counted as chest. Sex, height and weight alone miss by 3.6 cm.

These are perfect outlines, turned on a computer with every angle and the scale known exactly, and
checked against the scanner's own bust number, not a tape. On a customer, the scale (about 2 per
cent now), reading the angle, the outline's edges, clothing and breathing add to them.

## What has been shown, and what has not

Shown, by the tests in this repository: that the arithmetic is right on every
simulated departure from the ideal; that the error bar it claims is the error it
makes; that tilt and roll are removed; that it refuses rather than guesses; and,
end to end, that the page itself, in Chromium, watching through the browser's
fake camera a video of a real person — a 1902 photograph from the Library of
Congress, cut out by the page's own pose model and moved along a simulated hop
at a chosen scale, with motion blur, sensor noise and JPEG compression —
recovers that scale. Four runs before the turn was reworked: 0.29, 0.20, 0.30
and 0.42 per cent out; since, 0.07, 0.20 and 0.32, each claiming ±1.1 (no accelerometer in a
headless browser, so the pitch is taken on trust); the height it reported,
173–174 cm against 175.0, short by the height of the heel landmark above the
floor (`test/e2e/`). The photograph is flat, so its shirt and its outline are
at one distance; the test draws the pictures' person at the scale a body 25 cm
deep would have at its middle behind a shirt at the video's, and checks the
step back the page takes (0.13 and 0.25 per cent out, claiming ±2.4 with the doubt over
where the tracked lines are) and the widths it then reads (within 0.02 cm of
what the camera sees, which in perspective is 1–2 per cent more than the
chest's own breadth and depth: the nearer parts of a squarish chest are nearer).

That machine saw 27 frames a second once it stopped running the pose model
during the hops — which, in software graphics, took 400 ms a call. On a slow
device the page does the same: the hops get the frames, the knees go unwatched,
and the answer says so.

Not shown: how rigid real people are in the air, where on a real shirt the
tracker's lines are, how well the shoulders give the angle of a real turn, and
how close the chest girth comes to a tape on real customers. All need people
and a tape measure, and
`FIELD.md` says how to collect them. Until then, every accuracy number above is
a statement about the method, not about the shop floor.
