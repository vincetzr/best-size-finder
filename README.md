# BEST size finder

Stand in front of a camera and get a shooting-vest size. One page, no
dependencies, no build step here — `index.html` carries its own stylesheet and
script and makes no network request once loaded.

**https://vincetzr.github.io/best-size-finder/**

## Why this is a separate repository

A camera needs an origin. `getUserMedia` requires a secure context *and* a frame
that has been granted the camera, so a local file will not do it — `file://` is
not a secure context, and `navigator.mediaDevices` is simply `undefined` there —
and an embedded preview is never granted one. GitHub Pages serves this
top-level over https, which is all it takes. This repository is public because
Pages on a private one needs a paid plan; it holds the measuring page and
nothing else.

## How it works

Nothing leaves the device. There is no upload, no account and no model. The room
is photographed empty, then with the person in it, and the difference is the
person.

- **Chest** is a girth, so a front view is not enough — a barrel and a plank the
  same width across are not the same size of vest. A front view gives the width,
  a side view gives the depth, and Ramanujan's approximation puts an ellipse
  through the two.
- **Length** is the garment's, measured from the intersection of neck and
  shoulder to the bottom of the vest, so the page finds that landmark on the
  outline and draws each candidate size's hem across the customer's own picture.

### The one thing that has to be known

A photograph has no size in it, and no browser will hand over a distance:
Safari on iPadOS exposes no depth API, no camera intrinsics and no focal length,
and one view of an unknown body at an unknown distance is scale-free as a matter
of geometry rather than of effort. So a known length enters once, from the
installation rather than from every customer — one person of known height stands
on the mark, and that fixes how many centimetres the frame spans at that spot
until the camera is moved. It is kept in the browser's local storage.

Everybody afterwards is asked nothing, and their height comes out as a
measurement instead of going in as a question. Stand off the mark and the
shutter waits rather than answering wrongly.

## The hopping page: nothing asked at all

**`scan/`** (https://vincetzr.github.io/best-size-finder/scan/ once on `main`) measures
without the known length above. The customer hops five times on the spot. In the
air they are in free fall, and free fall is 9.81 m/s² for everyone, so the
acceleration of their trunk in the picture, in pixels per second squared, divided
by g, is pixels per metre at the body — no card, no mark on the floor, no height
typed in. Then a picture facing, arms out, and a slow quarter turn with the arms
up: by Cauchy's formula π times the chest's mean width over the turn is the
length a tape would follow round it. Their height comes out as a by-product, which they can check for
themselves against what they know. The eyes, read close up when they tap Start
(the iris is 11.7 mm in nearly every adult), give a second, independent scale to
check it against.

How and why, with the numbers and what is not yet shown: `HOW-IT-MEASURES.md`.
How to check it against a tape measure on real people: `FIELD.md`.

Unlike `index.html`, this page is built from readable source in this repository —
`src/` (ES modules, no build step), `sim/` (the simulated hopper it is tested on),
`test/`:

    npm test                                 # unit tests and the simulator, ~10 s
    node sim/montecarlo.mjs                  # the accuracy table in HOW-IT-MEASURES.md
    node test/e2e/cutout.mjs test/e2e/media/duffy.jpg /tmp/hop   # once: cut the person out
    node test/e2e/run.mjs /tmp/hop           # the real page in Chromium, watching him hop

## Updating

`index.html` is built from `vincetzr/product_extractor`:

    npx vite build --config vite.finder.config.ts
    python3 scripts/build_preview_finder.py

then copy `docs/index.html` here as `index.html`. Pushing to `main` republishes.
