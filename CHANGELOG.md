# Changelog

## 15.25.6 — 2026-10-14

- **Fixed: the survey quick-add buttons had disappeared on evaluations.** Athelas now groups the note into Subjective / Objective / Assessment / Plan, and Functional Outcomes sits inside **Objective**. When that group is closed, Functional Outcomes is hidden — and the quick-add buttons with it. The buttons now move up into the **Objective** heading whenever the group is closed, so they are always in view, and clicking one opens the group before adding the survey.
- When the group is open, the buttons sit where they always did, above "Add a functional outcome form".
- (Goals moved too: they are now under **Plan**, just above Plan of Care.)

**Not yet confirmed on a live note.** Checked against two of today's evaluation pages, where the Objective group was closed both times. Opening the group was simulated, because a saved page cannot run Athelas's own code.

## 15.25.5 — 2026-10-13

No change to what the helper does on the page. This release changes what it writes to the browser console.

- **Console logs no longer contain chart content.** The helper writes a running log to the browser console (DevTools), and a saved copy of that log is what we ask for when something goes wrong. Until now that log included the real values the helper read from or typed into the chart: goal sentences and target dates, plan-of-care durations and end dates, diagnosis codes, intervention names, and the address of the patient's chart. A saved log was therefore patient data, which is why the old ones could no longer be used for debugging.
- **What the log says now:** which step ran, which field it touched, and whether the value took. A chart value is shown only as a same-length placeholder: letters become `x`/`X` and digits become `0`, so `Knee 03/14/2026` is logged as `Xxxx 00/00/0000`. That keeps the format visible (enough to spot a date typed in the wrong order, or a field left blank) without the content. Things that are not about the patient are still logged as they are: CPT codes, the matching rule that fired, the helper's own justification text, survey names, counts and timings.
- Page elements are logged as a short description (`<input name="duration" type="number">`) instead of the live element. DevTools would otherwise copy the element's attributes, including its current value, into a saved log.
- **For developers only:** `localStorage.setItem('athelas-helper:log-values', '1')` and a page reload bring the real values back. A warning at the top of the console says it is on. Remove the key and reload to go back. Do not turn it on on a therapist's machine.

**Checked by tests only.** The new rule is covered by automated tests that fail on the old logging, and the code passes a syntax check, but nobody has saved a console log from a live note yet. The first one sent in after this update is the real check: it should not contain a single real name, date, code or sentence from the chart.

## 15.25.4 — 2026-10-13

- **Fixed: Fix Procedures could not add a missing CPT card.** When an intervention has to move to a code that is not on the note yet, the helper clicks "+ CPT", ticks the code and clicks "Add 1 CPT code". It was finding both of those buttons through a hidden attribute that turns out not to belong to Athelas: in our saved pages it is on the buttons up to 21 July and on none from 27 July on, so something else in the browser (probably another extension) was adding it. Wherever that attribute is missing, the helper could not find "+ CPT", and those items were skipped without a message; only moves to a card that already existed went through. Both buttons are now found by their own labels.
- **A card that cannot be added is now reported.** You get a message naming the code ("Could not add a 97112 … card — its items were left where they are") and the closing summary says so, instead of "Done: no changes".
- Nothing else changes: where the old attribute is still present it is used first.

**Not yet confirmed on a live note.** The "+ CPT" button lookup was checked against today's page. The "Add 1 CPT code" lookup was checked against a July capture of that dialog; there is no capture of the dialog since the site update, so if Athelas changed it the way it changed the goal dialog, this step could still fail. The console says which step: `[athelas:fix-met]` "no +CPT button", "CPT dialog never appeared", "no … option", or "no Add N CPT code button".

## 15.25.3 — 2026-10-13

- **Fixed: a blank band down the left side of every chart note.** Athelas replaced its left-hand navigation with a new sidebar. The compact layout still carried a rule written for the old one — "start the page 200px in from the left" — and with the old navigation gone, that rule just pushed the whole note 200px to the right and left an empty strip beside the sidebar. The rule is removed. On a 1600px-wide window the note goes from 915px wide back to 1147px.
- **The compact layout no longer touches the sidebar or the page frame at all.** It used to narrow the old navigation to save space. The new sidebar can be resized or collapsed with its own handle, so that is now yours to set and the helper leaves it alone.
- **The 16px gutters either side of the note are trimmed again.** That rule had quietly stopped matching after the same site update.
- **It now checks itself.** The first time a note finishes loading, the helper compares the note's position with the compact layout on and off. If the compact layout is ever pushing the note sideways or squeezing it — which is what a future site update could do again — it switches itself off until the page is reloaded and says so in a message at the bottom of the screen. You get Athelas's normal layout instead of a broken one. Please pass that message along if you see it.

**Not yet confirmed on a live note.** Checked against a saved copy of today's page at two window widths.

## 15.25.2 — 2026-10-13

- **Fixed: "Survey Complete! Create Goal?" opened an empty goal form.** Athelas changed the Goal Title box in its "Create new Goal" dialog — it is now a multi-line box — and the helper could no longer find it. So it opened the dialog and stopped, leaving every field blank. It finds the box again and fills the title, target date, initial state and target state as before.
- **It no longer creates a half-filled goal.** Before clicking Create Goal, the helper now re-reads every field it filled. If one is missing or didn't take, it leaves the dialog open and tells you which field to finish by hand, instead of submitting. Until now it submitted regardless.
- **It can only write into the open dialog.** Every goal already on the note has its own Initial / Current / Target State boxes. If the helper couldn't find a field in the dialog it used to go looking across the whole page, which could have overwritten the first existing goal. That fallback is gone.
- The dialog also has a new **Duration** field. The helper leaves it alone and sets the Target Date, as before.

**Not yet confirmed on a live note.** This was fixed from a saved copy of the page, which can show where the fields are but not how the live form reacts. If a goal still doesn't come out right, the message at the bottom of the screen now says which field was the problem — please pass that along.

## 15.25.1 — 2026-10-13

No functional change. Removes real patient names from the shipped code and the project docs.

- Four code comments and doc references cited example page captures by their filenames, and every capture is named after a real patient. This repository is public, and the comment shipped inside the extension's `content.js`, so the names were published. They are now cited with the patient part globbed out (`captures/*_diagnotis_codes_example.mhtml`), and one doc line that quoted a real plan of care no longer does.
- AGENTS.md now states the rule explicitly: capture filenames are PHI, cite them globbed, and never paste clinical specifics or clinic staff names into tracked files.
- **Please re-upload** — the published 15.25.0 package still contains one of the names in a comment.

## 15.25.0 — 2026-09-22

- **"Simulates / replicates" in the note now files the item under Therapeutic Activity (97530).** When the documentation says the task simulates or replicates a functional activity — "performed to simulate getting out of a car", "the movement replicates reaching into an overhead cupboard" — Fix Procedures moves it to 97530. It matches on the intervention's **details** (the text the scribe writes), not its name, because that phrasing is something the therapist says to the patient and never appears in an exercise name.
- **This rule outranks every other rule**, per the therapist. If a squat, a lunge, a stretch, a MET or a balance exercise was documented as simulating a functional activity, 97530 wins. It also overrides the "leave alone" rules — a bridge or a TKE whose note documents a simulation is now moved rather than skipped.
- No canonical justification is appended: the sentence in the note already documents the simulation, so it is its own justification. (That also means the item doesn't pick up the losing rule's boilerplate.)
- It catches simulate / simulates / simulation / simulated and replicate / replicates / replicating. It deliberately does **not** catch "reproduction" — reproducing a patient's *symptoms* is the opposite of simulating a functional task.
- Replayed against every intervention in the example notes: no existing item changes where it files. The new rule only fires on wording that isn't in any of them yet.

## 15.24.0 — 2026-09-06

- **The plan-of-care fix now applies itself the first time an evaluation opens**, which is what the clinic originally asked for ("auto default to 90 days"). It is still the same change — duration to 12 weeks, frequency untouched, only ever lengthening — but you no longer have to click the button on a fresh note. A toast says what changed and offers **Undo**.
- **Once per note, ever.** The note gets exactly one automatic attempt, and it is used up even when nothing needed changing — so if you deliberately shorten a plan afterwards, re-opening the note will not undo your decision. The button is always there if you want to apply it by hand later.
- Signed notes are never touched, and this only happens on evaluations.
- It has its own switch in Extension Settings ("…and apply it automatically the first time an eval opens"), directly under the Fix Plan of Care switch — turn it off to go back to click-to-apply.

**One limitation worth knowing:** Athelas doesn't tell us whether a note has been opened before — only the four free-text sections carry a "Last updated" stamp, and the Plan of Care section has none. So "first open" means *first time on this computer, in this browser*. On a second machine, or after clearing browser data, a note could get one more automatic attempt. Because the change only ever lengthens and no-ops at 12 weeks or more, the only case where that matters is a plan you had deliberately shortened — hence the Undo.

## 15.23.1 — 2026-09-06

No user-visible change. Groundwork/bugfix in the (still unused) provider-discipline detection behind the possible role-aware code mapping.

- `athProviderInfo()` now identifies the **logged-in user**, not just "the note's first provider". The row that owns the **Sign** button is you — you can only sign as yourself — while co-signers show "Awaiting Signature". The old heuristic used the "Supervising Provider" label, which is wrong: on several real notes the logged-in therapist is herself labelled Supervising Provider and still owns the Sign button.
- Fixed two detection bugs found by replaying all 11 distinct provider blocks in `captures/`: the section's own "Provider(s)" heading was being read as a provider, and material-symbol icons render their name as text (the Sign button's raw text is `"signatureSign"`), so no exact-text match on a control could ever succeed. Detection is now 11/11 on the captures, up from 0/11.
- The discipline is cached in page localStorage (`athelas-helper:me`) so it survives notes where the signal is ambiguous — a co-signed note has no unique signer. **Credential and discipline only, no name**; local, never transmitted.

## 15.23.0 — 2026-09-06

- **New "Fix Plan of Care" button** in the Plan of Care header, on evaluation notes only. On an eval the therapist tells the patient what they'll *start* with — "1x/week for 4 weeks" — the scribe writes exactly that into the plan, and nobody changes it to the full certification window, so the plan expires early. The button lengthens the **duration** to 12 weeks and lets the app recalculate the end date and visit count (it writes them itself only if the app doesn't). Red when the plan is too short, green when it isn't.
  - **Frequency is never touched** — the complaint is the duration, not how often the patient is seen.
  - **It only ever lengthens.** A plan already at or past 12 weeks is left alone.
  - **It asks first.** This edits a certification document, and specifically the plan the therapist just discussed with the patient, so it shows the before/after and waits — it is not a silent default.
  - Why 12 weeks and not 90 days: 90 days is 12.86 weeks. 12 weeks (84 days) is the longest whole number of weeks that stays inside a 90-day certification; 13 would overshoot it. If the duration units are set to days or months the button uses 90 or 3 instead. It never changes the units itself.
- Its own switch in Extension Settings.

## 15.22.0 — 2026-08-26

Billing-critical fixes: the two mistakes that lead to $0 reimbursement now have their own fixer and their own pre-sign warning.

- **Non-reimbursed billing codes → the right PT code.** Interventions the scribe filed under **98960** (Education & Training for Patient Self-Management, which PT is not paid for) are now moved out by **Fix Procedures**. The destination follows the normal rules when they have an opinion (a squat mis-filed under 98960 still lands under 97530); otherwise it goes to **97535 Self-Care/Home Management Training**. "Leave alone" rules (Bridges, TKE) are deliberately overridden here — leaving an item under a non-reimbursed code bills at $0, so it always has to move. The code family is a small open list, ready for more codes as the clinic identifies them.
- **New "Fix Diagnosis" button** in the Diagnosis Codes section header. Rewrites the ICD-10 7th character from **S (sequela) to D (subsequent encounter)** — e.g. `S52.301S` → `S52.301D`. Same review-before-you-run dialog as Fix Procedures. Per code it adds the corrected diagnosis, **verifies the new one is really on the note, and only then removes the old one**; if the corrected code can't be found, the original is left untouched and the row is reported as skipped. Deletion always goes through the individual code's X — never the field-level "Clear" X, which would wipe every diagnosis at once.
- **Warnings above the signature block.** At the bottom of the note, just above Provider(s)/Sign, up to two warning buttons appear: one when a non-reimbursed code still has "Done" interventions under it, one when a diagnosis is still marked S. Clicking a warning jumps to the section that fixes it and flashes it. They exist only while the problem exists and disappear as soon as it's fixed.
- **Button status colours.** The fixer buttons are **red when clicking them would change something and green when that part of the note is already clean**, with a tooltip saying what's pending. Fix Private Pay changed from purple to the same red/green language. This costs no polling: one shared MutationObserver with a trailing debounce recomputes only after the page goes quiet, skips hidden tabs and non-note pages, and reads only the flowsheet cards and diagnosis chips.
- Both new features have their own switches in Extension Settings.

## 15.21.2 — 2026-08-11

- Calendar "Extension Settings" button now inserts *before* the `tr-hidden lg:tr-block` wrapper that holds "Clear All", instead of inside it — so it stays visible at smaller widths (the wrapper hides below the lg breakpoint).

## 15.21.1 — 2026-08-11

- Settings entry point is now an inline green **"Extension Settings"** button (styled like the other helper buttons) instead of a floating gear. It sits just left of "Clear All" on the calendar and just left of the Recently Viewed control on a chart note, so it flows with the page on resize. Still decoupled from the features (anchored to native controls), so it's reachable even if a feature breaks.

## 15.21.0 — 2026-08-11

- **Feature toggles for robustness.** A small ⚙ gear (top-right, on every Athelas page) opens a settings panel where each major feature can be turned off — Fix Procedures, Fix Private Pay, the survey quick-add panel, the survey status/goal button, jump-to-Flowsheet, compact layout, and the calendar Open Note button — plus a master switch to disable everything at once. If a site update breaks a feature, you can switch just that one off instead of the whole extension. Toggles save to the page's localStorage (no permission, no data collected), work identically in the userscript and the extension, and apply immediately (no reload). The gear stays reachable even if a feature is off or broken.

## 15.20.3 — 2026-08-11

- Shelved the calendar auto Day→Week view switch (misbehaving; disabled per request). The rest of the calendar helpers stay: the Open Note button on checked-in appointments and the off-screen popup clamp. The switch code is still present and can be re-enabled; `__athelasCalendarWeek()` triggers it manually.

## 15.20.2 — 2026-08-11

- Survey status button back to the **bottom of the survey (its original spot), right-aligned** via align-self:flex-end — not the header row. In the rework it had been put in the header and pushed right with margin-left:auto, but that header row is shrink-wrapped so it only moved next to the name. Also made it bigger.
- Goal dialog is wider (860px) and taller (88vh) and the description bubble no longer has its own scrollbar — the full text fits in the larger dialog.

## 15.20.1 — 2026-08-11

Corrections to 15.20.0:

- **Restored the "Create <survey> goal" button** above the scores — it should not have been removed. Both it and the header status button create the goal; the status button additionally collapses the survey.
- **Goal dialog description:** now shows the full survey description (from reference_surveys.txt), moved to the bottom (below the fields) in the same bubble.
- **Survey panel right-alignment fixed for real:** the Functional Outcomes section is a flex column with align-items:flex-start, so the panel wasn't stretching and justify-content did nothing. Using align-self:flex-end, the panel now sits on the right, above the input.

## 15.20.0 — 2026-08-11

Survey status button + goal dialog rework:

- The bottom "collapse survey" button and the separate blue "Create goal" button are replaced by one **status button in each survey's header** (right-aligned, bigger, stays visible when collapsed). It tracks completion: **red "Survey incomplete"** until the survey is scored, then **green "Survey Complete! Create Goal?"**. Clicking collapses the survey and jumps to its top; when complete it also opens the goal dialog.
- **Goal dialog:** dropped the per-field checkboxes (both states are always wanted). The score number in the Initial and Target sentences is now an **editable text box** (e.g. edit the 56 in "DHI score of 56/100", or the 34 in the target), and the edited value is used when the goal is created.
- The dialog now shows a **description of the survey** (what the score means, from reference/reference_surveys.txt) as a reminder.

## 15.19.4 — 2026-08-11

- Survey quick-add panel: put it back to its own row at the top of the Functional Outcomes section (right-aligned so it sits above the "Add a functional outcome form" input), instead of inside the header row where it was shifting the input box (15.18.2).

## 15.19.3 — 2026-08-11

- Hide the appointment-tooltip arrow when the popup is clamped back on-screen. After a nudge the arrow points away from the cell and its hit area was blocking interaction; it's now removed on clamp. Normally-placed tooltips keep their arrow.

## 15.19.2 — 2026-08-11

- Keep the appointment hover popup on-screen. It's a MUI Tooltip positioned by an inline transform that sometimes lands partly off the top/edge; a clamp now nudges its transform so the popup sits fully in the viewport (idempotent — once in view it stops adjusting). The tooltip's little arrow may point slightly off after a big shift, but the content is fully visible.

## 15.19.1 — 2026-08-11

Calendar fixes from live testing:

- **Day → Week now works.** The view is a MUI Select that opens on mousedown, not click, so the old native-click never opened the option list. It now opens with mousedown and picks Week. Also switches once per calendar entry instead of re-firing on every date change.
- **Open Note button reworked.** It's now a big blue "Open Note" button placed just after the cell's "Checked In" label (lower-left), instead of a tiny chip in the top-right that overlapped the status icons. Check-in is detected by the "Checked In" text (reliable), so the button only shows for checked-in patients and appears reactively when someone is checked in. The chart-note URL (which only exists in the hover popup) is harvested and cached as you hover cells, so clicking opens the note reliably from the live popup or the cache.

Known/deferred: the native hover popup sometimes renders off-screen — that's the app's own positioning and needs its popup DOM to fix safely; deferred pending a capture.

## 15.19.0 — 2026-08-11

New Calendar (/ehr/calendar) helpers:

- Auto-switch the calendar from Day to Week view once on load (leaves it alone if you're already on Week/Month or switch back to Day yourself).
- A persistent "Note" button on each checked-in appointment cell, so therapists don't have to hover and find "Open Note". It only shows on checked-in patients (keyed on the cell's check_circle icon) and appears reactively whether the patient was already checked in or gets checked in later. Because the chart-note link only exists in the native hover menu, the button reveals that menu on click and follows its "Open Note" link.

Note: the hover-reveal and the small on-cell button placement are best-effort and pending live verification. DevTools hooks: `__athelasCalendarWeek()`, `__athelasOpenNoteCells()`.

## 15.18.2 — 2026-08-10

- Moved the survey quick-add panel to the right side of the Functional Outcomes header, next to the "Add a functional outcome form" input where therapists enter surveys (was full-width above the heading).

## 15.18.1 — 2026-08-10

- Reverted the two display changes from 15.18.0 that came from the target-mapping's notes (gathered a week earlier, so its display conventions are stale). Kept the app's established formats: DHI stays "DHI score of X/100" (not "total score"); Modified Oswestry stays percent-only ("X% disability", not raw+percent). The target-state values are unchanged — only the wording follows the app approach now (e.g. DHI → "DHI score of 34/100"; Oswestry → "20% disability").

## 15.18.0 — 2026-08-10

- **Goal target states are now real** (no more stub). Each survey looks up its score in the therapist's target table and writes a family-aware target sentence, e.g. LEFS 34/80 → "Patient will have a LEFS score of >60/80 (>75% of full function) for improved QOL."; DHI 60 → target 34/100; Oswestry/NDI raw 23/21 → 10/50 (20% disability); QuickDASH 22.7 → <10/100. KOS-ADLS converts the displayed % to raw /70 for the lookup (per therapist), so 62.9% → target >86%.
- Initial-state tweaks to match the mapping's display notes: DHI now reads "DHI total score of X/100"; Modified Oswestry now shows both raw and percent (X/50 (Y% disability)), since the app exposes its raw score.

## 15.17.2 — 2026-08-10

More initial-eval fixes from live testing:

- **Progress toasts never closed and couldn't be dismissed.** The goal flow called `prog.arm()`, which doesn't exist (the API is `done()`), so the "Creating…" toast stuck. Toasts are now click-to-dismiss, auto-close on completion, and have a 20s safety cap so nothing lingers.
- **Only the first goal could be created; the rest failed with "no Create Goal button."** Once a goal exists, its own name/initial/target fields stay in the DOM. The flow now targets the *empty* Goal Title field (so an existing goal is never overwritten), scopes all form-filling to the open form, and matches the open button by "create/add/new goal" instead of an exact string. (Best-effort — see note; send the multi-goal capture to finalize.)
- **Collapse control now only shows on an expanded survey** (removed once collapsed), the jump waits ~220ms after collapsing so the two actions don't blur together, and it lands the survey's top near the top of the page instead of the upper-middle.

## 15.17.1 — 2026-08-10

Fixes from first live test of the initial-eval features:

- **Everything happened twice** (survey added twice; goal states added twice). Root cause was the shared `simulateClick`, which fired a native `el.click()` *and* a synthetic MouseEvent — two activations. It now does one (native; synthetic only as a fallback). This was the "general problem" and also removes a latent double-click across the older features.
- **Goal added "Current State" instead of "Target State."** The goal form has four add-chips (Initial State, Current State, Target State, Status); `findAddChip` matched a shared container and grabbed the first chip. It now matches a chip by its own exact text.
- **POC end date not found.** It's a `<span>` value next to the "Plan of Care End Date:" label (not one text node), so the target date came back null. `pocEndDate` now reads the label's sibling span, with whole-page and input-value fallbacks.
- **Collapse control moved to the bottom** of the survey it collapses (the top can already be collapsed from the header).

## 15.17.0 — 2026-08-10

New initial-eval workflow features (present only on Initial/Eval notes; default present if the note type can't be read):

- **Functional-Outcomes survey quick-add** — a floating 6-button panel above the Functional Outcomes heading (DHI, Modified Oswestry, NDI, LEFS, QuickDASH, KOS-ADLS). Each button drives the hover Autocomplete to add the survey. QoL: the "Add a functional outcome form" box is forced always-visible (no longer vanishes on mouse-move); added surveys auto-expand (best-effort); faint separators between question/answer rows; a "collapse + jump to top" control once a survey is scored.
- **Goal from outcome score** — a button just above each completed survey's scores creates a goal the way therapists do (Plan → Goals → Create Goal; fills title, target date = POC end date, initial state, target state), behind the same per-change review dialog as Fix Procedures. Initial-state labels are family-aware and clinically correct: disability scales (DHI, Oswestry, NDI, QuickDASH) read as "% disability/handicap"; function scales (LEFS, KOS-ADLS) read as "% of full function", not disability. Target state is a family-aware stub until the real initial→target mapping is delivered.
- New canonical, unit-tested engine `surveys/survey-scoring.js` (mirrored by the userscript `Surveys` module; `tests/surveys-sync.test.js` guards drift).

Note: the DOM-driving parts (survey add, goal-form filling incl. the segmented date field, expand/collapse) are best-effort and pending live verification. DevTools hooks: `__athelasAddSurvey(key)`, `__athelasReadScores(key)`, `__athelasCreateGoal(key)`, `__athelasPocEndDate()`.

## 15.16.0 — 2026-08-08

- Justifications are now **append-only** for every rule, including MET (therapists' request). MET/Rib used to **replace** (overwrite) the Intervention details; they now append their canonical text and keep whatever the scribe wrote. Appended text is joined to the existing text with a **single newline**. In-place MET items are still standardized (the canonical MET text is added if missing), just via append instead of overwrite, and it's idempotent — re-running never duplicates. The per-change review dialog shows the existing text in grey and only the appended text in green.
- Robustness: the "did it stick" read-back now compares whitespace-insensitively, since a newline may render as a paragraph/soft break in the rich-text field (whose textContent wouldn't contain the newline).

## 15.15.0 — 2026-08-08

- Intersecting procedures: the **justification now follows the winning category**, not just the CPT code. A name matching two rules takes both its code and its justification from the same winning rule. Concretely, an "anterior step → single leg balance" (which files under 97530 as a step) now appends the step justification "Improve stair climbing ability" instead of moving with no justification. Lunge-into-balance and the other balance compounds were already correct (97112 + glute-med text); this closes the one remaining case that resolved on category alone. Every change is still shown in the review dialog before it's written.
- Docs: `matching/analysis/matching-duplicates.md` now states the "justification also wins" principle; added regression tests for it.

## 15.14.1 — 2026-07-31

- App icon: the knee-chip icon is now the extension icon at all sizes (16/32/48/128, built to Chrome Web Store spec — 96px artwork + 16px padding on the 128). The userscript header gained an `@icon` pointing at the raw GitHub icon128.png, so Tampermonkey shows it too. No behavior change.
- Housekeeping: userscript moved into its own `userscript/` dir; build guard (`GM_HEADER_LINES`) and regenerate command updated for the extra header line.

## 15.14.0 — 2026-07-28

- Fix Procedures now only operates on interventions marked **"Done"** (per therapist request), matching Fix Private Pay. Un-checked items are left where they are, even if misplaced.

## 15.13.0 — 2026-07-28

- Fix Private Pay now applies the **same** rename + justification as Fix Procedures when it moves a Done item down — only the destination differs (private pay, for billing). So a balance item still gets its glute-med justification appended, MET is renamed/replaced, Rib becomes "MET - Rib", etc.; excluded/unmatched items just move. The private-pay review dialog now shows the Movement and Justification columns too, with per-row checkboxes.
- Refactor: the rename/justification machinery is extracted into a shared `Fixer` used by both movers (no behavior change to Fix Procedures).

## 15.12.4 — 2026-07-28

- Confirmation dialog: append-mode justifications now show a true diff — the existing text stays grey (nothing is removed on an append) and only the appended sentence is green — instead of repeating the whole note struck-through-red then green. MET's genuine replace still shows old (red strikethrough) → new (green).

## 15.12.3 — 2026-07-28

- Drag: fully remove the flicker. dnd-kit's live drag preview reports the item one slot high when aiming at the very bottom (`idx 19/21` while dragging), so the old "is it exactly last?" check never matched mid-drag and the loop re-jumped ~3 times before giving up — even though the drop itself landed correctly. Now it accepts last-or-second-to-last as landed (which resolves to the bottom on release), so it drops after a single move.
- Confirmation dialog: the Movement column is now colored red (start section, struck through) → green (end section), matching the Justification column.

## 15.12.2 — 2026-07-28

- Drag: eliminate the residual post-drop flicker. The jump loop now sends a single decisive pointer-move into the bottom slot and then *polls* for the landing instead of sending more moves (each move made dnd-kit re-sort, which was the flicker). Drops the moment it's confirmed last.
- Confirmation dialog: split into a dedicated **Procedure** column; the Movement column now shows "start section → end section". Where a change isn't applicable, the checkbox is replaced by a greyed-out ✕ so it's clear it can't be selected.

## 15.12.0 — 2026-07-28

- **Faster, more robust drag ("jump" drag).** Rewrote the mover: instead of riding dnd-kit's slow auto-scroll and creeping the cursor toward the target (which timed out on far targets, was slow, and "vibrated" between the last two slots at the end), it now programmatically scrolls the target's drop point on-screen and moves the pointer straight to a spot just below the last item, releasing the instant the item is confirmed last. Cost is independent of distance and of zoom/resolution (all geometry from `getBoundingClientRect`). Applies to both Fix Procedures and Fix Private Pay; keyboard drag remains the fallback.
- **Confirmation dialog.** Clicking Fix Procedures now opens a review modal listing every pending change before anything moves, with two independent checkboxes per row (the move, and the justification/rename), a "Procedure → Section" movement column, and a red-old → green-new justification column. Only checked changes run. Fix Private Pay shows a moves-only review dialog.
- **Progress toast.** A small, non-interactive, auto-fading bubble in the lower-right shows what's moving (e.g. `Moving "Cranial Manual Therapy" → PPVISIT Visit-Private Pay`) while the mover runs.

## 15.11.0 — 2026-07-28

- Compact mode: dropped the two horizontal width-forces that caused the breakage, kept the (safe, valuable) vertical density. The section sub-nav rail returns to its native width — forcing it to 112px overflowed the item highlights/labels over the note. The far-left drawer goes to 200px (from the broken 150px, still narrower than the native 250px) with `overflow-x: hidden` so no horizontal scrollbar appears. Everything else keeps the 15.2.0 vertical compaction. No feature changes (Fix Procedures, Fix Private Pay, jump-to-Flowsheet, SPA injection all intact). See `redesign/COMPACT-MODE-POSTMORTEM.md`.

## 15.10.1 — 2026-07-28

- Section sub-nav rail (follow-up to 15.10.0): the item highlight box could still grow wider than the rail and get clipped mid-corner. Every inner box is now bounded to the rail (`max-width: 100%`), the item rows clip their own overflow, and the rail is widened 148px → 160px so the common labels fit without truncation.
- Far-left global nav drawer: it had gained a horizontal scrollbar because the narrowed 150px width was tighter than a couple of labels. Widened 150px → 165px and set the drawer content to `overflow-x: hidden` so no scrollbar appears (vertical scroll still works on a short viewport).

## 15.10.0 — 2026-07-28

- Fix jump-to-Flowsheet over-firing: after v15.9 made the script re-evaluate on every SPA URL change, clicking a section in the note's left nav (which changes the URL) made the page jump back down to the flowsheet. It now only auto-jumps when entering a *different* chart note (patient + appointment id changes), not on same-note section clicks.
- Fix the section sub-nav rail overflowing into the note: the compact rule narrowed the rail but didn't clip it, so item highlights and labels painted over the note content. The rail is now clipped (`overflow-x: clip`), the 20px item indent is reduced to 8px, long labels ellipsize, and the width is relaxed 112px → 148px so common labels fit.

## 15.9.0 — 2026-07-28

- **Single-page-app fix.** The script sometimes never ran on a chart note (Tampermonkey showed a red ✕ / "this script hasn't run yet"): Athelas is an SPA, so if a tab first loaded on a non-matching URL and then client-side-navigated to a patient note, the old two-URL `@match` never injected. Now `@match https://insights.athelas.com/*` (whole domain) and the script decides what to do from the current path, re-evaluating on every SPA navigation (History API hooks + `window.onurlchange` + popstate + a poll). CSS and jump-to-Flowsheet re-apply on navigation; the Fix Procedures / Fix Private Pay buttons self-heal via their existing observers. Non-matching pages (calendar, dashboard) just no-op instead of leaving the ✕.

## 15.8.1 — 2026-07-28

- Fix Procedures and Fix Private Pay now drop each moved intervention at the **bottom** of its target category (previously it landed wherever it first crossed in). The pointer drag aims below the last item and only settles once the moved item is confirmed to be the last entry; the keyboard fallback nudges down to the end after crossing in. Moved items keep their relative order.

## 15.7.0 — 2026-07-28

- **Fix Procedures** (Chart Note): the old "Fix MET" button is generalized. It now moves *every* intervention to its correct CPT code (97110 / 97112 / 97530) per the therapist's canonical rules — not just Muscle Energy Technique items — via a real dnd-kit drag. It renames Rib Mobilization to "MET - Rib", appends the canonical justification (replaces it for MET), and leaves excluded categories (Bridges, TKE) untouched. MET handling is preserved as one rule among many, including standardizing the justification of MET already filed under 97112.
- **Fix Private Pay** (Chart Note): new button above the "PPVISIT - Visit-Private Pay" section on private-pay charts. Drags every intervention check-marked "Done" from the CPT cards into the private-pay section.
- Matching rules consolidated into a single shared engine used by both the button and the read-only preview (previously duplicated); three-way table-sync test updated to match.
- Procedure-matching rules finalized against the therapist's judgment calls (balance broadened, First Rib excluded, single-leg-balance compounds, Shoulder Extension exclusions, Lunge Hip Flexion Stretch → 97110). Bridges set aside under review (left alone); see `redesign/BRIDGES-review.md`.

## 15.3.0 — 2026-07-22

- First Chrome-extension packaging (`athelas-compact-extension/`, Manifest V3, MAIN-world content script). Feature-identical to userscript v15.3.0.
- Added test suite (`npm test`): procedure-matching unit tests, three-way table-sync check, manifest/version-drift check.
- Added `AGENTS.md`, `DEPLOYMENT.md`.

## Earlier

Userscript history lives in git log and the `@version` header (v1 → v15.3.0, including the v11 and v14 site-rework migrations and removal of dead calendar support in v14.15).
