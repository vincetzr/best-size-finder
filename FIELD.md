# Checking the hopping page against a tape

Everything in `HOW-IT-MEASURES.md` is shown on a simulator and on a video of a
photograph. Neither is a person. This is how to find out what the page does on
people, in an afternoon, with a tape measure.

## Why height first

The page reports the customer's height, measured, never asked. Height is the
cleanest test of the gravity ruler there is, because it involves no model of a
chest — with one catch: the page measures from the top of the head to the pose
model's lowest heel or toe point, which sits somewhere above the floor, so its
height carries a fixed offset that has nothing to do with the scale (in the
end-to-end test, about 1.5 cm short with the scale right). So read the scale
from the heights the way an offset allows: the *mean* height error is that
offset plus the scale's bias, and cannot separate them; the *spread* of the
height errors, and whether they grow with height (a scale error does, an offset
does not), are the scale's. If the heights scatter by more than a couple of
centimetres, the hops are where to look.

The scale's biggest doubt now is one the simulator and the test video could not
have: the hops are timed on the front of the trunk, and everything is measured
through the middle of the body, a little further back. The page steps the ruler
back by a quarter of the chest's depth and a centimetre, and claims two per cent
for not knowing better (`HOW-IT-MEASURES.md`, *Where on the body the ruler is*).
How far the step really is depends on what the tracker follows — the outline on
a plain top, the pattern on a busy one — so the rows record which it was.

So every row collects both.

## What to have

- A tape measure, and BEST's chest definition: round the fullest part of the
  chest, under the arms, level, on a relaxed breath, over a thin top.
- A height measure: a stadiometer, or a tape on a wall and something flat for the
  head. Measure **in the shoes they will hop in** — the page measures what the
  camera sees.
- The tablet on a stand, upright, at chest height, two to three metres of clear
  floor in front of it.

## Each person

1. Measure height (shoes on) and chest by tape. Write them down before the page
   gives its answer, not after. Note whether their top is plain or patterned
   (stripes, checks, a print) over the chest and shoulders.
2. Run the page from the staff link, `…/scan/?staff` — the tape-check panel
   only appears there, so customers never see earlier customers' rows. Follow
   it through.
3. On the answer, open **Check against a tape (for staff)**, type the two numbers,
   choose the top, and press *Save this row*. The row is kept on this device only.
4. Run it twice more for the same person if there is time: the spread between
   their three answers is the repeatability, which no tape can give. If anyone
   has a plain and a patterned top to hand, once in each is the most direct
   test there is of the step above.

Twenty people of different builds is enough to see whether the method works;
fifty to quote a number.

## At the end

*Download the rows* gives a CSV with, for every run: the tape chest and height,
the page's chest, width, depth and height, the scale's source and claimed
uncertainty, the step from the shirt to the middle of the body and the distance
it assumed, the top, how many hops were used and dropped, whether the eyes
agreed, the frame clock and its jitter, and the size it chose.

What to work out:

- **height error** (page − tape): its mean is the landmark offset above plus
  the scale's bias; its spread, and its slope against height, are the scale's.
  Expect a spread of about 1 per cent if the hops behave as simulated, and up to
  2 per cent more if the step back varies from top to top.
- **the step back**: the height error, as a share of height, on plain tops
  against patterned ones. If the tracker follows the outline on a plain top and
  the shirt on a patterned one, patterned tops read shorter — the ruler was
  read nearer the camera than the page assumed — by up to the chest's depth
  over twice the distance (`distanceM` is in each row): a few per cent.
  Whatever the split, the share that fits best is what `middlePlane` should
  assume, and its doubt can then come down.
- **chest error** (page − tape): mean and spread, and how much of it the height
  error explains (chest error ÷ chest against height error ÷ height should line
  up if the scale is to blame).
- **the turn against the two pictures**: each row has the quarter turn's girth
  (`turnCm`, measured all the way round) and the two-view line's (`twoViewCm`,
  which assumes a typical shape). Whichever is nearer the tape on average should
  get the larger weight — the page currently gives the turn about four fifths.
- **sizes**: how often the page's first size is the tape's size, and how often the
  tape's size is in its first two.
- **refusals**: how often the page asked for the hops again, and why.

Send the CSV and those numbers back to whoever maintains this, and the
"what has not been shown" section of `HOW-IT-MEASURES.md` can be rewritten with
them.
