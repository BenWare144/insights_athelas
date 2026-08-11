# Changelog

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
