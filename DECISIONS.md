# DECISIONS.md — decisions, DOM facts, and solved problems

Why the code is the way it is, and problems already solved. Read this before "fixing" something that looks odd — it's probably deliberate. Companion to `AGENTS.md`.

## Design decisions

- **Identity:** this is a *workflow-automation helper* (one-click fixers primary). Do NOT call it "compact mode" — that framing repeatedly leaked into user-facing text and was explicitly banned. Compact CSS is a minor background feature.
- **Dual artifact, MAIN world:** userscript is the source of truth; `content.js` is generated from it. The extension runs in the MAIN world (needed for React `__reactFiber$` access). Because MAIN world can't reach `chrome.*`, all persistence uses page `localStorage`.
- **Matching engine three-way sync:** canonical `matching/procedure-matching.js` → userscript `Proc` → `content.js`. First matching rule wins, and the winning rule supplies BOTH the CPT code and the justification (never split).
- **Justifications are append-only** (join existing + canonical with a single `\n`; never overwrite). MET/Rib used to "replace" — retired per therapists. Idempotent via an `includes()` dedup check.
- **Intersecting procedures:** justification follows the winning category. Concretely, "anterior step → single-leg balance" files under 97530 (step wins) and carries the step justification, not move-only.
- **Survey scoring — two families:** disability scales (DHI, Modified Oswestry, NDI, QuickDASH) are higher = worse ("% disability/handicap"); function scales (LEFS, KOS-ADLS) are higher = better ("% of full function"). **KOS target lookup converts the displayed % to raw /70 (×0.7)** then displays back as % (Ben's call; matches the 10-pt min-change).
- **Display formats follow the APP, not the delivered mapping's notes** (the mapping was a week stale): DHI stays "DHI score of X/100" (not "total score"); Modified Oswestry stays "% disability" only. Only the target *values* come from the mapping.
- **Feature toggles:** in-page settings panel + `localStorage` (rejected: Tampermonkey menu + extension popup — the MAIN-world `chrome.storage` gap makes the extension side costly and divergent; rejected: remote config — would break the no-data/no-network privacy claim). Settings button is decoupled from features (anchored to native controls) so it's reachable even if a feature breaks.
- **Local auto-update:** a git-ignored `*.local.user.js` build carries a `file://` `@updateURL`, so Ben pulls updates via Tampermonkey "Check for userscript updates" — no GitHub push. `npm run build:local` regenerates it.
- **Push policy:** commit locally; **Ben pushes**. The sandbox has no GitHub creds.
- **Web Store:** unlisted → IT force-install by ID; no permissions declared; `localStorage` needs no permission and isn't user-data collection, so the "no data" disclosures hold. Item ID `lnacagncbpglinobghcdeadaodonpjdf`.
- **Calendar auto Day→Week is SHELVED** (misbehaves). Code + `__athelasCalendarWeek()` hook remain; not called from the tick. Re-enable as a default-off toggle when fixed.

## Solved problems — don't re-solve these

- **Right-aligning an injected element ("move it to the right side").** THE recurring trap. The Functional-Outcomes section and each survey region are flex COLUMNS with `align-items: flex-start`, so a child does NOT stretch full-width and `justify-content: flex-end` has no effect. Use **`align-self: flex-end`** on the child. (Bit us on the survey quick-add panel AND the survey status button.) When the anchor lives inside a responsive-hidden wrapper (calendar "Clear All" is in a `tr-hidden lg:tr-block` div), insert BEFORE that wrapper so it stays visible at small widths.
- **MUI Select opens on `mousedown`, not `click`.** The calendar view (Day/Week/Month) select never opened its listbox from a native `.click()`. Dispatch `pointerdown` + `mousedown`, then click `[role="option"][data-value="week"]`.
- **`simulateClick` was double-firing.** It used to call native `.click()` AND dispatch a synthetic MouseEvent = two activations → "everything happened twice" (survey added twice, goal states added twice). Now: ONE activation (native; synthetic only if native is unavailable/throws).
- **Goal form add-chips.** The Create-Goal form has FOUR chips: Initial State, Current State, Target State, Status. Match a chip by its own exact text — matching a shared container returned the first (Current State) instead of Target State.
- **POC end date.** It's a sibling `<span>` after the "Plan of Care End Date:" label, not one text node. Read the label's following sibling. `#_r_f4_` is a dynamic React id — do not anchor on it.
- **Multiple goals.** Created goals leave their own editable `name`/`initial_value`/`end_goal_value` inputs in the DOM. Target the EMPTY Goal-Title input and scope all fills to the open form so you never overwrite an existing goal; match the "open" button by `create|add|new goal`.
- **Toasts.** The returned API is `toast.done(ms)` (auto-close) — there is no `.arm()`. Toasts are click-to-dismiss with a 20s safety cap.
- **Calendar Open Note URL.** The chart-note link (`/ehr/v2/patients/{pid}/appointments/{aid}`) exists ONLY in the native hover popup — the patient id is NOT on the cell. Harvest + cache the href as the user hovers (they hover to reach the button anyway); open from the live anchor or cache. Synthetic hover did NOT reliably open the popup.
- **Off-screen appointment popup.** It's a MUI Tooltip positioned by an inline `transform` on `.MuiTooltip-popper` (stable hook: `[aria-label="Appointment Tooltip"]`). Read/adjust the translate to clamp it into the viewport (idempotent), and hide the `.MuiTooltip-arrow` on clamp — its hit area was blocking clicks.
- **Survey add input** is CSS-hidden until hover (`md:tr-invisible`) — force it visible; the autocomplete options are `[role="listbox"] [role="option"]`, matched by exact text.
- **Keyword-spam rejection.** Listing the survey acronyms (DHI, LEFS, …) in the store description triggered a Web Store "Keyword Spam" rejection. Describe surveys generically.
- **FS delete quirk.** The mount blocks `rm`/unlink (`mv` works). Use the delete-permission tool to delete; NEVER rename junk into `.git/refs/**` (once produced a bad ref that broke `git push`).

## Key DOM anchors (stable hooks)

- Chart-note sections: `[data-section="functional_outcomes" | "goals" | "plan_of_care" | "flowsheet"]`; survey regions `[data-section="<survey display name>"]` (`id="collapsable-note"`, flex col); per-survey scores `[aria-label="Scores for <survey>"]` (exists only once scored).
- Survey region header: a `tr-items-center` row with `<button aria-expanded>` (ArrowDropDownIcon collapse toggle) + `<span role="heading">` (name); scores are a sibling wrapper.
- Note type: `input[aria-label="Clinical Note Type"]` value (e.g. "Initial Evaluation") → gates initial-eval features.
- Goal form inputs (plain MUI, fill via `setReactValue`): `name="name"` (title), `name="due_date"` (segmented MM/DD/YYYY, type digits "MMDDYYYY"), `name="initial_value"`, `name="end_goal_value"`.
- Calendar: cells `[data-calendar-event="true"]`; appt id from `[data-name-text="true"]` aria-label `"{Name}-{apptId}"` (no patient id on the cell); check-in = a `<span>`/`<div>` with text exactly "Checked In"; view select = MUI Select trigger text Day/Week/Month, options `[role="option"][data-value="week"]`; "Clear All" = `[aria-label="Clear All Filters"]` (in a `tr-hidden lg:tr-block` wrapper); recently-viewed = `[aria-label="Recently Viewed Notes"]`.

## Survey scoring quick reference

Lookup metrics: QuickDASH = displayed % (lower better); LEFS = raw /80 (higher better); Oswestry & NDI = raw /50 (lower better); DHI = total score /100 (lower better); KOS-ADLS = displayed % → raw /70 ×0.7 (higher better). Target tables + full descriptions are in `reference/reference_surveys.txt`; the engine is `surveys/survey-scoring.js` (tested).
