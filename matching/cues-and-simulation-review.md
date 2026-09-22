# Provider cues → 97112 and "simulate/replicates" → 97530 — evidence review

Status: **simulate/replicate → 97530 is IMPLEMENTED (v15.25.0); the cue rule is still awaiting decisions.** This is the requested list of what these two proposed rules would actually catch, and where they collide with existing rules. Companion to `BRIDGES-review.md` and `procedure-matching-QUESTIONS.md`.

> **2026-09-22 ruling (therapist, via Ben) — rule 3 is settled and shipped.**
> Match `simulat*` / `replicat*` against the intervention **details** (the
> `[aria-label="Intervention details"]` div), not the name. On a conflict with any
> other rule, **this rule wins** — it is now rule 0, the first entry in `RULES`.
> Consequences accepted with that ruling: it also overrides the "leave alone"
> excludes (TKE, Bridges, curtsey-step), and it is move-only, so the item does not
> pick up the losing rule's canonical justification. See the "What shipped" section
> at the bottom.

Corpus: every intervention harvested from all `captures/*.mhtml` — **254 unique (name, details) pairs** across ~20 real chart notes. Also cross-checked against the exercise-name catalogs in `reference/` (2,701 filtered / 3,193 original names) and the 156 harvested names in `procedure-matching.test.js`.

## Headline finding: these two rules cannot key on the intervention NAME

Every rule in `procedure-matching.js` today matches on the item's **name**. Neither of these can:

| Trigger | Hits in the 2,701-name exercise catalog | Hits in 254 real interventions (name) | Hits in 254 real interventions (details) |
|---|---|---|---|
| cue / cues / cued / cueing | 1 (`Side Plank Cueing and Progressions`) | 1 (`Squats with Knee Alignment Cueing`) | **33** |
| simulate / replicates / mimics | 0 | 0 | **0** (1 false positive: "symptom reproduction") |

So cue language lives in the **intervention details** — the free text the scribe writes — not in the name. Implementing rule 2 means the matcher gains a second input (`resolveProcedure(name, detailsText)`), which is a real change to the engine's shape, not another row in the table.

### Trap: the tool's own justifications contain cue language

Two canonical justifications we *write ourselves* say "cues":

- MET: `"…with tactile and vc to help facilitate proper proprioception and posture."`
- Balance (`J.gluteMed`): `"Verbal and tactile cues to glute med for upright posture"`

A naive details scan therefore re-triggers on everything the tool has already justified. The analysis below strips both strings before testing; any implementation must do the same, or the rule becomes self-fulfilling.

---

## Rule 2 — provider cues → 97112. What it would catch

33 of 254 interventions mention cues. Broken down by what happens to them:

### A. Would MOVE (currently under 97110, no competing name rule) — 6 items

These are the rule's actual yield. All 6 are strength/machine/ROM exercises whose notes record therapist cueing:

| Current card | Intervention | Details evidence |
|---|---|---|
| 97110 | Theraband Shoulder Internal Rotation | "Therapist cued to keep elbow tucked at side." |
| 97110 | Chin Tuck | "clinician cueing for neutral spine … component of postural re-education" |
| 97110 | Leg Press | "therapist cued for proper knee alignment over toes" |
| 97110 | Leg Extension - Unilateral | "Therapist cued for smooth controlled movement." |
| 97110 | Hook Lying Pelvic Clock | "AROM pre, post MET with verbal, visual and tactile cues" |
| 97110 | Ankle Alphabet Writing - Bilateral | "clinician cued left ankle engagement throughout" |

(A 7th, `Rib Mobilization`, also moves 97110 → 97112 — but the existing Rib→MET rule already does that. Not attributable to this rule.)

**This is the whole upside: 6 items out of 254 (2.4%).** Worth having — 97112 pays more than 97110 — but it is a small rule, and see the false-positive risk below.

### B. Already under 97112 — 16 items, no change

FRS Right/Left Thoracic, MET for posteriorly subluxed rib with IR, Shoulder Shrug and Postural Correction, Postural Correction with Isometric Pull-Down, Single-Leg Balance - Left, Seated Short Foot (Arch Lift), Diaphragmatic Breathing, Trunk Rotation, Cervical/Thoracic-dynamic stability, Dead Bug, Single Leg Airplane, Lumbar Sidebending, Dynamic Cranial - Cervical - Thoracic, Diaphragmatic Breathing with Rib Facilitation, Single-Leg Stance with Horizontal Head Turns.

Useful as validation — the rule agrees with the therapist's own filing 16/16 times where they'd already made the call. **It never contradicted a human 97112 placement.**

### C. CONFLICTS with an existing name rule — 8 items

This is the part that needs your decision. Applying "higher reimbursement wins" (see below):

| Current card | Intervention | Name rule says | Cue rule says | Winner under "higher pays" | Net effect |
|---|---|---|---|---|---|
| 97110 | Anterior Hip Stretch - Stride Lunge on Steps | **97530** Lunge | 97112 | **97530** (name rule) | unchanged from today |
| 97110 | Step-Ups with Knee Valgus Correction | **97530** Step up | 97112 | **97530** (name rule) | unchanged from today |
| 97530 | Squats with Knee Alignment Cueing | **97530** Squat | 97112 | **97530** (name rule) | unchanged from today |
| 97110 | Quad Set with Straight Leg Raise | 97110 SLR | **97112** | **97112** (cue rule) | **changes** |
| 97110 | Straight Leg Raise - Bilateral | 97110 SLR | **97112** | **97112** (cue rule) | **changes** |
| 97110 | Supine Bridge | *leave alone* (Bridges under review) | **97112** | ? — see Q3 | **changes** |
| 97112 | Wall Calf Stretch - Knee Straight, Dynamic | 97110 Stretch | **97112** | **97112** (cue rule) | **changes** — and it *stops* today's downgrade |
| 97112 | PRI Chest Wall Stretch | 97110 Stretch | **97112** | **97112** (cue rule) | **changes** — same |

Two things worth pulling out:

1. **The last two are a bug the cue rule would fix.** Today, `Wall Calf Stretch` and `PRI Chest Wall Stretch` sit under 97112 where the therapist put them, and Fix Procedures would *move them down to 97110* because of the blanket Stretch rule. A cue rule at higher precedence than Stretch stops that downgrade. This is arguably a stronger argument for the rule than the 6 items in bucket A.
2. **The straight-leg-raise pair is the false-positive risk.** "Clinician cued patient to keep knee straight and kick leg up high" is ordinary exercise instruction, not neuromuscular re-education. If the rule fires on *any* mention of a cue, it will reclassify plain therapeutic exercise as neuro re-ed on the strength of one sentence — which is exactly the kind of upcoding a compliance reviewer would flag. **A cue phrase alone does not document neuromuscular re-education.** Whatever we ship should probably require cue language *plus* a purpose word (proprioception, balance, posture, motor control, facilitation, recruitment, stabilization, neuromuscular) — and even then, the justification we append has to say why.

### D. Private-pay card — 2 items, out of scope

`Rib Mobilization/Manipulation Right Ribs 1, 2, and 5`, `Cervical/Thoracic-dynamic stability`.

---

## Rule 3 — "simulate / replicates" → 97530. What it would catch

**Nothing in the corpus.** Zero of 254 real interventions and zero of 2,701 catalog names contain simulate / simulation / replicates / mimics. The single near-hit is a false positive that must be excluded:

> `Straight leg raise mobility stretch` — "Clinician assessed effect of tibial rotation on **symptom reproduction**."

"Reproduction" of *symptoms* is the opposite of simulating a functional task. So: match `simulat*` / `replicat*` / `mimic*`, and do **not** add `reproduc*` to the family.

Because nothing fires, this rule is cheap and low-risk to add — but we also have no evidence it will ever fire, and no example to tune the phrasing against. Conflicts are hypothetical: since 97530 is the top-paying of the three, "higher reimbursement wins" makes it beat every 97110 and 97112 rule automatically, so it would sit near the top of the table. Its only real competitor would be another 97530 rule, where the code is the same and only the justification text differs.

~~**Recommendation:** hold it until the clinic sends one real note where the scribe wrote "simulates".~~ **Superseded 2026-09-22** — the therapist ruled directly rather than waiting for a capture. See "What shipped" below.

---

## The "higher reimbursement wins" ordering

The requested tie-break needs an actual ranking. Typical Medicare PFS ordering for these codes (national, non-facility) is:

> **97530 Therapeutic Activity ≳ 97535 Self-Care/Home Mgmt > 97112 Neuromuscular Re-ed > 97110 Therapeutic Exercise**

97530 and 97535 are close, with 97112 a few dollars below and 97110 the lowest. **Please confirm against Choice Therapy's actual fee schedule / payer mix before it becomes precedence** — the top two are near enough that a specific contract could invert them, and this ordering would silently drive every future tie.

Once confirmed, the table order becomes: 97530 rules → 97535 → 97112 (incl. the cue rule) → 97110. That is roughly the current order already, which is why applying the tie-break changes only 5 of 254 items.

⚠ **Compliance caveat, stated once:** "prefer whichever pays more" is only defensible when the documentation genuinely supports both codes. Coding to the higher-paying option on ambiguous documentation is upcoding. The safe form of this rule is "when the note documents *both*, file the one that pays more" — which is why the cue rule needs a purpose word, not just the word "cue".

---

## What shipped for rule 3 (v15.25.0)

```js
// rule 0 — first in the table, so it beats everything
{ label: 'Simulated functional activity (details)', code: '97530', justMode: 'none',
  test: (n, d) => _has(d, 'simulat') || _has(d, 'replicat') }
```

- **Reads the details, not the name.** `resolveProcedure(name, details)` now takes a second argument — the normalized `[aria-label="Intervention details"]` text. Every other rule's `test` ignores it, and a one-argument call behaves exactly as before, so nothing else in the engine changed shape. All three call sites pass it: Fix Procedures, Fix Private Pay (via `listDone()`), and the read-only preview. `Fixer.readDetails(li)` is the reader, and it deliberately does **not** require `contenteditable` — a signed/locked note still renders the text.
- **Stems, not whole words.** `simulat` catches simulate/simulates/simulation/simulated; `replicat` catches replicate/replicates/replicating. `reproduc` is **excluded** — "symptom reproduction" is the opposite of simulating a functional task and is the only near-miss in the 254-item corpus. `mimic` is not included either (not asked for); adding it is a one-token change.
- **Move-only.** The detail sentence already documents the functional simulation, so it is its own justification, and there is no approved canonical wording for this rule. It also means a simulated activity does **not** inherit the losing rule's text (e.g. no "Improve ablity to squat and recover" on a squat that simulated a car transfer).
- **It overrides the excludes.** A TKE, a bridge, or a curtsey-step-to-balance whose details document a simulation now moves to 97530 instead of being left alone. That follows directly from "highest priority" and was accepted with the ruling — but it is the one behaviour worth watching once bridges are finally settled.
- **Zero regressions:** replayed over all 254 real interventions, no item's verdict changes (nothing in the corpus says simulate/replicate yet — as expected, since the phrase is the compliance director's habit and every capture is Cheri's).
- Seven tests cover it in `procedure-matching.test.js`, including a positional assertion that it stays at index 0.

**Still worth collecting:** one real note where the scribe actually wrote it, to confirm the scribe echoes the therapist's phrasing rather than paraphrasing it away.

## Open questions

0. ~~**"Simulate" phrasing.**~~ Settled 2026-09-22 — see above.
1. **Cue trigger strictness.** Bare cue mention (6 moves, 2 of them dubious), or cue + purpose word (proprioception / balance / posture / motor control / facilitation / recruitment / stabilization / neuromuscular)? The stricter form drops the two straight-leg-raise items and keeps the rest.
2. **Justification text for the cue rule.** Every 97112 rule today carries either the MET splice or `J.gluteMed` ("Verbal and tactile cues to glute med for upright posture") — which is glute-specific and wrong for a chin tuck. A cue rule needs its own canonical sentence. What should it say?
3. **`Supine Bridge`.** Bridges are currently *left alone* pending `BRIDGES-review.md`. Does a cue mention override that, or do bridges stay parked?
4. **Does the details text survive?** The rule reads the scribe's details field. If the therapist has already edited it, or the scribe phrases a session summary differently, the trigger disappears. Confirm this is acceptable — name-based rules are stable, this one is not.
5. ~~**"Simulate" phrasing.** Need one real note. Which exact words does the scribe use?~~ — **settled**; shipped as `simulat*`/`replicat*` on the details. A real note is still worth having to confirm the scribe echoes the phrasing rather than paraphrasing it.
6. **Does the cue rule also become highest-priority?** The simulate ruling set a precedent: a details-based rule that beats everything, excludes included. It does **not** automatically follow that the cue rule gets the same standing — 97112 pays less than the 97530 rules it would have to outrank, so under "higher-paying wins" the cue rule should sit *below* them, not above. Confirm which the therapist means before the cue rule ships.
