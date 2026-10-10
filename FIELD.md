# Checking the hopping page against a tape

Everything in `HOW-IT-MEASURES.md` is shown on a simulator and on a video of a
photograph. Neither is a person. This is how to find out what the page does on
people, in an afternoon, with a tape measure.

## Why height first

The page reports the customer's height, measured, never asked. Height is the
cleanest test of the gravity ruler there is, because it involves no model of a
chest: if the height is right to a centimetre, the scale is right to about half
a per cent, and any remaining error in the chest is the chest model's. If the
height is wrong, nothing after it can be right, and the hops are where to look.

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
   gives its answer, not after.
2. Run the page: `…/scan/`. Follow it through.
3. On the answer, open **Check against a tape (for staff)**, type the two numbers
   and press *Save this row*. The row is kept on this device only.
4. Run it twice more for the same person if there is time: the spread between
   their three answers is the repeatability, which no tape can give.

Twenty people of different builds is enough to see whether the method works;
fifty to quote a number.

## At the end

*Download the rows* gives a CSV with, for every run: the tape chest and height,
the page's chest, width, depth and height, the scale's source and claimed
uncertainty, how many hops were used and dropped, whether the eyes agreed, the
frame clock and its jitter, and the size it chose.

What to work out:

- **height error** (page − tape): its mean is the scale's bias, its spread the
  scale's scatter. Expect about ±1 per cent if the hops behave as simulated.
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
