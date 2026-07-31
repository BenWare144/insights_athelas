# Fix-Procedures — matching questions for the therapist

This feature generalizes the existing "Fix MET" button. It scans the interventions
the scribe produced, matches each name against your canonical list in
`Stuff for EMR.xlsx`, and — for anything filed under the wrong CPT code — moves it to
the correct section (and can set the standard justification).

**How matching works (plain English):** we lower-case the name, strip punctuation and
hyphens, then look for keywords. So `"Lateral Step-Ups - 6 inch step"` becomes
`lateral step ups 6 inch step`, which contains `step up`, so it matches **Step up →
97530**. Plurals fall out for free (`step ups` still contains `step up`).

I tested the draft rules against **156 real intervention names** pulled from your
example chart notes. Below: what's confident, and the handful of judgment calls I need
you to settle. Answer inline (write **YES/NO** or your preference after each ▶).

---

## A. Confident matches — no action needed (just so you can spot-check)

These matched cleanly and I don't think they're controversial:

- **All Step-Up variants →** Step up (97530): `Lateral step ups`, `Lateral Step-Ups - 6 inch step`,
  `Step-Ups`, `Step-Up with Toe Raise Variation`, `Step-Ups with Knee Valgus Correction`, `Step up`
- **All MET variants →** MET (97112): `MET`, `MET AC Joint - Hold Relax`,
  `MET for posteriorly subluxed rib`, `MET to Superior Tib-Fib Joint`, `MET - CT Junction (FRS T1 and T2)`, etc.
- **PROM items →** PROM (97110): `Hip Internal Rotation PROM`, `Knee Flexion PROM`
BEN: These are all good.

And these correctly **did NOT** match (they look similar but are genuinely different):

- `TKE on Cable column` — has "cable column" but it's a Terminal Knee Extension, **not** push/pull cable. ✓ excluded
BEN: `TKE on Cable column` should match "cable column"  anything with cable column should be a therapeutic activity. (97530)
- `Single Arm Pull` — has "pull" but no "cable". ✓ excluded
BEN: Correct
- `Single-Leg Heel Raise` — has "single leg" but it's a heel raise, not a stand/balance. ✓ excluded
BEN: Correct
- `Anterior Hip Stretch - Stride Lunge on Steps` — has "lunge" but it's a stretch (no direction word). ✓ excluded
BEN: `Anterior Hip Stretch - Stride Lunge on Steps` This should be a therapeutic activity. (97530) Anything with a Lunge should be 97530.


---

## B. Judgment calls I need you to settle

### 1. Squat variations → generic "Squat"?
Right now these all match **Squat → 97530** (justification: *"Improve ability to squat and recover"*):
`Chair squat`, `Mini Squats`, `Partial squat`, `Squats with Knee Alignment Cueing`.

▶ Treat all squat variants as your "Squat"? **(YES/NO)**
BEN: YES
▶ Special case: is **"Chair squat"** actually your **"Sit to Stand"** instead? (Both are
  97530, but Sit to Stand's justification is *"Improve toilet transfers"* — different text.) **(Squat / Sit-to-Stand)**
BEN: NO

### 2. "Single-Leg Balance" → your "Single leg stand"?
`Single-Leg Balance - Left` currently matches **Single leg stand → 97112** (glute-med posture justification).
Balance and stand are the same idea to me, but you tell me.
BEN: YES they are the same thing

▶ Match "…Balance…" as a single-leg stand? **(YES/NO)**
BEN: YES

### 3. "Tandem Stance" → your "Tandem stand"?
`Tandem Stance, eyes open` matches the tandem family (97112). "Stance" vs "stand".

▶ Correct to treat "stance" = "stand"? **(YES/NO)**
BEN: YES

### 4. The balance family is redundant — can I collapse it?
Your list has six 97112 balance items that **all share the exact same justification**
(*"Verbal and tactile cues to glute med for upright posture"*): `Semi Tandem`,
`Tandem stand`, `Single leg stand`, `Airex`, `Airex tandem`, `Airex semi-tandem`.
Because the code and justification are identical, the script can't (and doesn't need to)
tell them apart — it just needs to recognize "this is a balance item → 97112, glute-med
justification." You flagged Airex tandem / semi-tandem as redundant; they are, for this
purpose.
BEN: YES

▶ OK to treat all six as one "balance → 97112" bucket? **(YES/NO)**
BEN: YES

### 5. MET justification — which text?
Your xlsx has **four specific MET rows** (torsional backward, torsional forward, L/E, U/E),
each with its own justification. But the real MET names the scribe makes
(`MET AC Joint`, `MET to Superior Tib-Fib Joint`, `MET for posteriorly subluxed rib`…)
don't line up with those four. The current script writes a **generic, name-spliced**
justification instead, e.g. *"Muscle energy technique applied to AC Joint - Hold Relax,
with tactile and vc to help facilitate proper proprioception and posture."*

▶ Keep the generic name-spliced MET justification? **(YES/NO)**
BEN: YES
▶ Or should specific MET names map to one of your four xlsx justifications? If so, tell me
  which real names → which of the four. **(explain)**
BEN: Sorry, the xlsx justifications are outdated data, I have removed them from the file. All MET procedures should be done with the "MET - X" pattern. Can you try to make this robust to the form? For example, I want the X that gets subbed to be extracted like so:
`MET AC Joint` -> `MET X`
`MET to Superior Tib-Fib Joint` -> `MET to X`
`MET for posteriorly subluxed rib` -> `MET for X`


### 6. Garbage/test MET names
`MET - 1243543t`, `MET - jhgkhjg`, `MET - 143t41` look like test typing. They'd still be
treated as MET and moved to 97112.

▶ Move these anyway (harmless), or ignore names that look like junk? **(MOVE / IGNORE)**
BEN: IGNORE These were indeed for my testing

---

## C. Canonical procedures with NO example yet (matchers are untested)

None of your example notes contained these, so I wrote best-guess rules but couldn't
verify them against real scribe output. Please confirm the scribe's likely wording, or
flag if the rule sounds wrong:

| Your procedure | CPT | My current rule matches if name contains… | Worry |
|---|---|---|---|
| Step down | 97530 | "step down" | none expected |
| Sit to Stand | 97530 | "sit to stand" | scribe might write "STS" — should I add that? ▶ |
| Sit to Supine | 97530 | "sit to supine" | — |
| Forward lunges | 97530 | "lunge" + "forward" | scribe may just say "Lunges" with no direction ▶ |
| Reverse lunges | 97530 | "lunge" + "reverse" | same |
| Side lunges | 97530 | "lunge" + "side" | same |
| Push cable column | 97530 | "cable" + "push" | — |
| Pull cable column | 97530 | "cable" + "pull" | — |
| Matrix | 97530 | whole word "matrix" | — |
| Bridges | 97530 | "bridge" | — |
| Airex / Airex tandem / semi | 97112 | "airex" | — |
| passive range of motion | 97110 | "passive" + "range" + "motion" | — |

▶ For the lunges: does the scribe ever write a plain **"Lunges"** with no forward/reverse/side?
  If yes, where should an undirected "Lunges" go — or should it be left alone? **(answer)**
BEN: As written above, this should be a therapeutic activity. (97530) Anything with a Lunge should be 97530.

---

## D. Two behavior questions (how the feature acts, not what it matches)

### 7. Move even when the scribe's placement looks reasonable?
Your canonical list is the source of truth. So if the scribe files "Squat" under 97110
(Therapeutic Exercise) instead of your 97530, the button will **move it to 97530**.
BEN: YES looks good.

▶ Always move a matched item to its canonical CPT, even if the scribe's guess was plausible? **(YES/NO)**
BEN: YES

### 8. Overwrite justification on every matched item?
"Fix MET" already rewrites the justification text. Generalizing that means every matched
item gets its canonical justification written into the "Intervention details" field,
**replacing** whatever the scribe wrote.
▶ Overwrite justification for every matched procedure? **(YES / NO / only-if-blank)**
BEN: Outside of the MET thing, append justification, don't replace.
---

## E. What I built while waiting on answers

- `redesign/procedure-matching.js` — the matching table as a clean, drop-in module (18 rules).
- `redesign/procedure-matching.test.js` — run `node procedure-matching.test.js` to see
  every real name → what it matches. Re-run it after any rule change.

Once you answer A–D, I'll finalize the table and wire it into the userscript (generalizing
the working Fix-MET drag machinery to move to 97110 / 97112 / 97530 as needed).
