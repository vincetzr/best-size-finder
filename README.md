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

## Updating

Built from `vincetzr/product_extractor`:

    npx vite build --config vite.finder.config.ts
    python3 scripts/build_preview_finder.py

then copy `docs/index.html` here as `index.html`. Pushing to `main` republishes.
