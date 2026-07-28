# Bridges — set aside for review

Status: the Bridges rule is **disabled**. The script now **leaves every "bridge" item alone** (it does not move them, and does not touch their justification). This matches the therapist's per-item "Leave Alone" answers on the bridge compounds in `matching-duplicates.md`. Ben said he will explain the intended handling in a follow-up prompt; this note records the problem and the arguments so that prompt has context.

## The problem

The old rule was "anything whose name contains 'bridge' → 97530 (Therapeutic Activity)", taken from the canonical list where "Bridges" sits under 97530 with the justification *"To assist with bed mobility and assist with core stability during functional tasks."*

Run against the real exercise library, that one keyword catches **60 items**, and they are not all the same kind of thing:

- **Strengthening bridges** (the large majority): single-leg bridge, hamstring bridge, isometric bridge, elevated bridge, staggered bridge, frog bridge, bridge march, and so on. These are typically billed as **Therapeutic Exercise (97110)**, not Therapeutic Activity.
- **Items where "bridge" is incidental** — the word describes a position or a different exercise entirely: "Floor Press - Bridge Position", "Straight Leg Raise - Single Leg Bridge Position", "Straight Leg Raise To Single Leg Bridge", "Reverse Plank Bridge", "Thoracic Spine Bridge", "Shoulder Extension Bridge", "Midback Mobilization - Bridge, Peanut". Sending these to 97530 is clearly wrong; the therapist marked several of them "Leave Alone."

So a single "bridge → 97530" rule over-reaches in two different directions at once.

## Arguments for each direction

**Keep Bridges → 97530 (Therapeutic Activity).**
- It is what the canonical sheet says, with a functional justification (bed mobility, transfers, core stability during functional tasks).
- A bridge genuinely is a functional-mobility movement — it is how a patient bridges to get on/off a bedpan, reposition, or don pants supine. If the billing intent is that functional framing, 97530 is defensible.
- One rule, no per-item bookkeeping.

**Move Bridges → 97110 (Therapeutic Exercise).**
- The overwhelming majority of the library's bridges are strengthening/isometric variants (glute, hamstring, core) — textbook therapeutic exercise.
- It matches how most of these would be billed in practice; the "functional activity" framing really only fits a plain supine bridge used for bed mobility, not "Single Leg Hamstring Bridge - Elevated, Alternating".

**Leave Bridges alone (current behavior).**
- The category is genuinely mixed — some bridges are activity, most are exercise, several aren't bridges at all — so no single code is right for the whole keyword.
- Leaving them where the scribe filed them avoids confidently moving 60 items the wrong way. The therapist can move the occasional real bed-mobility bridge by hand.

## If we keep a rule, the incidental ones should be excluded regardless

Whatever code Bridges lands on, these are not bridges and should never be swept in by the keyword: "Floor Press - Bridge Position", "Reverse Plank Bridge", "Thoracic Spine Bridge", "Shoulder Extension Bridge", "Straight Leg Raise ... Bridge Position", "Straight Leg Raise To Single Leg Bridge", "Midback Mobilization - Bridge, Peanut".

## A middle option

Split the difference by intent: a **plain supine bridge used for bed mobility** → 97530 (matches the canonical justification), while **loaded/single-leg/isometric bridge variants** → 97110 (strengthening). That is more rules to maintain, but it is closest to how the two really differ. Worth it only if bridges show up often enough in real scribe output to be worth the extra rules.

## What happens right now

Until this is decided, the script recognizes any bridge item and does nothing to it — no move, no justification change. Nothing is at risk; the only cost is that a genuine bed-mobility bridge won't be auto-filed. Everything needed to flip it back on (to 97110, to 97530, or to a split rule) is a one- or two-line change in `procedure-matching.js`, and the whole audit can be re-run in seconds to preview the result before committing.
