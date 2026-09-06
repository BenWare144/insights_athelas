# HANDOFF.md — bring-up-to-speed

Start here, then `AGENTS.md` (how to work in the repo) and `DECISIONS.md` (why things are the way they are + problems already solved). `CHANGELOG.md` has the per-version history.

## What this project is

A browser add-on that automates chart-note busywork in **Athelas Insights** (a physical-therapy EHR at insights.athelas.com). It ships as a **Tampermonkey userscript** (source of truth) and a generated **Chrome MV3 extension** (same code, MAIN world). Its headline value: the AI scribe files interventions under the wrong CPT code, and this tool moves each to the right code (97110/97112/97530) with the correct justification in one click — plus survey/goal helpers on initial evals, calendar shortcuts, and a settings panel to toggle features. It collects/transmits no data and runs only on Athelas.

## Who's who

(This repo is public — keep third-party names/emails out of committed files.)

- **Ben** — the developer (handing off to his Claude Code). Commits as `BenWare144 <bwarex@gmail.com>`; he does the GitHub pushes and Web Store uploads.
- **Cheri Ware, DPT** — Ben's mom; the original user, trading as **Lake Region Consulting** (the Web Store publisher). The tool is currently customized to her.
- **The clinic** evaluating a wider rollout — a compliance director there is test-driving it, with another stakeholder involved. Their internal evaluation email thread (the source of the requests below) is held by Ben, not committed here.

## Where it's at (Aug 2026)

- **Version `15.22.0`**, 38/38 tests green. All commits are LOCAL — Ben pushes.
- **Live features:** Fix Procedures (incl. non-reimbursed 98960 → 97535), Fix Diagnosis (ICD-10 7th character S → D), pre-sign critical warnings, Fix Private Pay, functional-outcome survey quick-add + status button + goal-from-score (initial-eval notes), calendar Open Note + popup clamp, jump-to-Flowsheet, compact layout, and the Extension Settings toggle panel.
- **Shelved:** calendar auto Day→Week (misbehaves; code kept, not called).
- **Deployment:** userscript is live on Cheri's machine (auto-updates from a local `file://` build via `npm run build:local` + Tampermonkey "Check for updates"). The extension is **accepted and published (unlisted)** on the Web Store, item ID `lnacagncbpglinobghcdeadaodonpjdf`, for clinic force-install — the earlier keyword-spam rejection was fixed in `deploy/store-listing.md` and the resubmission went through. Rejection email archived in `deploy/store-review/`. `deploy/athelas-insights-helper-v15.22.0.zip` is built and ready to upload.
- **Not verified on the live site yet:** everything added in 15.22.0 was written against `captures/[patient] Chart Note_diagnotis_codes_example.mhtml` and never run against a real note — no capture in the repo contains a 98960 card, so the `ensureCard('97535')` path (does the +CPT dialog even offer 97535?) and the whole Fix Diagnosis interaction need a live pass. See "verification checklist" below.
- **Everything a new agent needs is in-repo** (this file, AGENTS.md, DECISIONS.md, CHANGELOG.md, DEPLOYMENT.md) — the previous work happened in Claude "cowork" whose separate memory does NOT travel to Claude Code, so these docs are the source of truth.

## Current work / what's next — the Choice Therapy email requests

Four requests came out of the compliance review. **Two are built (15.22.0), two are blocked on decisions.**

1. ✅⚠ **Non-reimbursed billing codes → an appropriate PT CPT.** Built. `NON_REIMBURSED` in `matching/procedure-matching.js` maps **98960 → 97535**; Fix Procedures moves items off it (name rule picks the destination when it has one, "leave alone" rules overridden). Deliberately an open family — adding a code is a one-line change plus the mirror. **But on 2026-09-04 the compliance director wrote that she removed 98960 from the clinic's fee schedule and "He does not need to add that rule!"** — so the specific 98960 mapping may now be dead weight at Choice Therapy. Kept anyway as a dormant safety net (it costs nothing, the fee-schedule change is clinic-side and reversible, and the family + the pre-sign warning scaffolding are what future codes plug into). Decide whether to keep or strip before the next release. Still open either way: the FULL list of codes that shouldn't be used (98961/98962? 97150? G-codes?).
2. ⏸ **"Provider cues" documented → 97112.** BLOCKED on decisions — the evidence review is `matching/cues-and-simulation-review.md` (what it would catch, the 8 conflicts, and why it can't be a name rule). Headline: cue language is in the intervention **details**, not the name, so this changes the matcher's shape; it would move 6 of 254 real items and fix 2 wrong downgrades, but a bare "cue" mention also catches ordinary exercise instruction.
3. ⏸ **"Simulate / replicates" → 97530.** BLOCKED — zero hits in 254 real interventions and 2,701 catalog names, so there's nothing to tune against. Need one real note where the scribe wrote it. Same doc. **Why the corpus is empty is now clear:** the compliance director described her *own* habit — "I know I usually verbalize with patient what the task replicates or simulates" — and she had barely started using the tool when she wrote it. Every capture in `captures/` is Cheri's notes, so the phrase would only start appearing in the other therapists' notes. Ask her for one.
4. ✅ **Diagnosis "S → D".** Built as the **Fix Diagnosis** button — confirmed to be the ICD-10 7th-character episode indicator. Adds the `…D` code, verifies it landed, then removes the `…S` code.

5. 🆕 **Plan of Care on an eval should default to 90 days** (2026-09-04, the newest request; NOT started). Problem as stated: the therapist tells the patient what they'll *start* with, the scribe writes that into the eval's plan — "1x/week for 4 weeks" — and therapists don't change it to 90 days, so the POC expires early. **Not yet an agreed request:** the compliance director asked the other director "do you agree with this change?" and there is no answer in the thread. Two things must be settled before it can be built:
   - **What "90 days" means in this form.** 90 days is 12.86 weeks, so it is neither 12 weeks (84d) nor 13 weeks (91d, which would overshoot a 90-day certification). If the Duration-Units Select offers "Days" it should be `90 Days`; if it only offers Weeks it has to be `12 Weeks` and someone has to accept the 84-day window. **Needs a capture with that dropdown open** (see DECISIONS.md — MUI Selects don't render their options until opened).
   - **Auto vs. prompted.** Everything else in this tool is review-before-apply, and this one edits a billing/certification document on every eval. Silently rewriting the plan the therapist just discussed with the patient is a different category of change from moving a CPT code. Recommended shape: a **warning/fix button in the Plan of Care header** (red when the duration is under 90 days, green when it isn't) using the existing status-colour + review-dialog machinery, rather than a silent default.
   - Also unknown: whether `end_date` and `visit_count` re-derive when `duration` is set programmatically, or must be written too (they are consistent with `frequency × duration` and `start + duration` in every capture). Needs a live pass.

**Positive feedback (informs priorities, not tasks):** the reviewer loved the survey quick-add (most-popular-on-top + make-it-a-goal). They didn't find jump-to-Flowsheet useful — which they can disable in Extension Settings (validates the toggle system). The toggles, calendar Open Note, and jump-to-procedures are all confirmed wins.

## Verification checklist for 15.22.0 (needs a live note)

Nothing below could be checked offline — no capture in the repo contains a 98960 card, and the diagnosis interaction was written from a static snapshot.

1. **Does the +CPT dialog offer 97535?** `ensureCard('97535')` matches dialog options by `textContent.includes(code)`. If 97535 isn't in that list, Fix Procedures can move items off 98960 only when a 97535 card already exists.
2. **Fix Diagnosis end to end** on a note with a real `…S` code: does typing the full target into `input[aria-label="Search for diagnosis codes"]` produce `li[role="option"][title="<code>"]`, does clicking it add the chip, and does the chip's CloseIcon remove the old one? Console tag `[athelas:fix-dx]`.
3. **Principal-diagnosis ordering.** New codes append to the end. Confirm what the app does to the "Principal ·" designation when the principal code is the one replaced.
4. **Warning buttons** land above `section[aria-label="Provider(s)"]` and disappear once fixed.
5. **Status colours** flip red↔green without visible lag, and the shared status bus doesn't feel heavy on Cheri's laptop.

## Open questions to resolve before planning

1. **The rest of the non-reimbursed list.** 98960 is handled. What else, and what's each target? Also: is 98960 → 97535 always right, or does it want to be a settings choice?
2. **Provider cues → 97112 / "simulate" → 97530.** See the five questions at the end of `matching/cues-and-simulation-review.md` — chiefly (a) bare cue mention vs cue + purpose word, (b) what justification sentence a cue rule should append, and (c) one real "simulate" note.
3. **Confirm the reimbursement ordering.** The "higher-paying category wins" tie-break is currently assumed to be 97530 ≳ 97535 > 97112 > 97110 (typical Medicare PFS). Confirm against Choice Therapy's actual fee schedule before it becomes precedence — 97530 and 97535 are close enough that a contract could invert them.
4. **Role differentiation (exploratory, on hold).** Cheri asked the clinic this directly on 2026-08-25 — "would [98960 → 97535] work for all disciplines, or do you want just specifically for PTs?" — and **it was never answered**; the thread moved on. Can the page tell us the user's discipline? **Yes** — the credential next to the provider name in `[data-section="notarize"] section[aria-label="Provider(s)"]` (`DPT`, `OTR/L`, `CCC-SLP`, …); it is the only place the app states it, and it's the *note's* provider rather than the logged-in account. `athProviderInfo()` / `window.__athelasProviderInfo()` read it and `athDiscipline()` maps it to PT/OT/SLP (returning null rather than guessing on an unknown credential). Nothing is gated on it. If OT can't bill a PT activity and needs an OT-specific code, `NON_REIMBURSED` becomes a per-discipline map.
5. **Company-wide vs Cheri-specific:** the matching rules are one shared set. Should these new rules apply to all Choice Therapy therapists, or stay Cheri's? If therapists want different code mappings (not just on/off), that implies per-user config beyond the current toggles.

## Future feature ideas (logged, not scheduled)

- **Hide the diagnosis field's "Clear" X.** `button[aria-label="Clear"]` in the Diagnosis Codes autocomplete removes EVERY code at once — a one-click way to destroy the diagnosis list with no obvious undo. Consider hiding or guarding it (the script never clicks it; this is about protecting the human).
- **Remove an emptied non-reimbursed CPT card.** Fix Procedures moves the interventions off 98960 but leaves the (now empty) card on the note; removing it is currently manual.

## How to work here (the short version)

- Edit the userscript (and the canonical `matching/` or `surveys/` file first for logic). Bump the version in all four spots, regenerate `content.js`, `npm test`, `npm run build:local`, rebuild the store zip, update `CHANGELOG.md`. Commit locally; **don't push**.
- Verify DOM behavior on the live site or an `.mhtml` capture in `captures/` (PHI — never leaves the repo). When you can't verify, say so.
- Watch the recurring gotchas in `DECISIONS.md` (esp. `align-self: flex-end` for right-alignment, and MUI `mousedown` to open selects).
