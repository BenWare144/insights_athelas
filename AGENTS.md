# AGENTS.md — Athelas Insights Helper

Guidance for AI agents (and humans) working in this repo. Read this first, then `HANDOFF.md` (current state + what's next) and `DECISIONS.md` (why things are the way they are, and problems already solved — don't re-solve them).

## What this is

A **chart-note workflow-automation helper** for **Athelas Insights** (insights.athelas.com), a physical-therapy EHR. Built originally for one working PT (Cheri Ware / "the therapist"); now being evaluated by Choice Therapy for wider rollout. It runs only on `insights.athelas.com` and collects/transmits no data.

Feature areas (all live):

- **Fix Procedures** — moves each "Done" intervention to its correct CPT code (97110 / 97112 / 97530, incl. MET → 97112), renames Rib → "MET - Rib", and appends the standard justification — all behind a per-change review dialog. Also moves items off **non-reimbursed codes** (98960 → 97535 by default, or wherever the name rule says), which is the one case where "leave alone" rules are overridden.
- **Fix Diagnosis** — rewrites the ICD-10 7th character S (sequela) → D (subsequent encounter) on the Diagnosis Codes section, add-verify-then-remove, behind the same style of review dialog.
- **Pre-sign warnings** — up to two warning buttons above the Provider(s)/Sign block, one per $0-reimbursement problem (non-reimbursed code, sequela diagnosis); they appear only while the problem exists and jump to the section that fixes it.
- **Fix Private Pay** — collects "Done" interventions into the private-pay section with the same fix-ups.
- **Functional-outcome surveys (initial-eval notes)** — a quick-add panel for the clinic's self-report surveys, a per-survey completion/collapse status button, and **goal-from-score** (drafts a goal from a completed survey, behind an editable review dialog).
- **Calendar** — an "Open Note" button on checked-in appointments + a fix that keeps the appointment hover popup on-screen. (Auto Day→Week view is written but **shelved** — misbehaves; see DECISIONS.md.)
- **Jump to Flowsheet** on note open; **compact layout** CSS (a minor background convenience — do NOT call the app "compact mode"; that framing is a historical artifact).
- **Extension Settings** — an in-page panel to toggle each major feature on/off (plus a master switch), for robustness when the site changes.

Shipped two ways, same code:

| Artifact | File | Status |
|---|---|---|
| Tampermonkey userscript | `userscript/athelas-insights-helper.user.js` | **Source of truth.** Installed on the therapist's machine (auto-updates locally — see below). |
| Chrome extension (MV3) | `athelas-insights-helper-extension/` | Generated from the userscript. Web Store item ID `lnacagncbpglinobghcdeadaodonpjdf` (unlisted → clinic force-install). Last submission was rejected for keyword spam and fixed; see DECISIONS.md / HANDOFF.md. |

## Dual-artifact rule (important)

`athelas-insights-helper-extension/content.js` is the userscript body minus the GM header, regenerated with the command in `athelas-insights-helper-extension/README.md` (currently `tail -n +13`, because the header is 12 lines incl. `@icon`). **Never edit content.js directly.** Edit the userscript, regenerate, and bump the version in all three of `@version` (userscript header), `manifest.json`, and `package.json` together. `npm test` fails if any drift. If the userscript header line count changes, update `GM_HEADER_LINES` in `tests/packaging.test.js` and the README `tail` offset together.

The extension runs the script in the **MAIN world** — required, because the fixers reach Tiptap editors via `__reactFiber$` DOM expandos, invisible from the isolated world. Do NOT remove `"world": "MAIN"`. Consequence: `chrome.*` APIs (incl. `chrome.storage`) are unreachable — that's why feature toggles use page `localStorage`, not `chrome.storage`.

## Hard constraints (therapist-imposed, non-negotiable)

1. **No font-size shrinking** for compactness — density comes from margins/padding/line-height only.
2. **Never pad/restyle `.MuiInputBase` internals** — it broke input click targets before.
3. **No css-hash selectors** (e.g. `.css-1abc2d3`) — MUI regenerates them each deploy. Use stable hooks: `data-section` attributes, `aria-label`s, semantic classes (`.tiptap.ProseMirror`), MUI root classes. Note `_r_*` ids are dynamic React `useId` values — also unstable; anchor on labels/aria instead.

## Repo map

- `userscript/athelas-insights-helper.user.js` — the script (source of truth). One big IIFE; independent modules booted at the bottom. Verbose `[athelas:tag]` console logging throughout; keep that style. `userscript/*.local.user.js` is a git-ignored local build (see Local dev).
- `athelas-insights-helper-extension/` — MV3 packaging (manifest, generated `content.js`, icons, README with the regenerate command).
- `matching/` — **canonical procedure-matching engine** `procedure-matching.js` (the only exported/tested copy; source of truth for the userscript's `Proc` engine — includes the `NON_REIMBURSED` / `CODE_NAMES` tables) and **canonical ICD-10 helpers** `diagnosis-codes.js` (source of truth for the 7th-character S→D logic mirrored in the userscript's `Dx`) + `procedure-matching.test.js`, decision docs (`procedure-audit.md`, `procedure-matching-QUESTIONS.md`, `BRIDGES-review.md`), and the research trail in `analysis/`.
- `surveys/` — **canonical survey-scoring engine** `survey-scoring.js` (6 surveys, score parsing, family-aware initial-state labels, goal strings, target-state mapping) + `survey-scoring.test.js`. Mirrored by the userscript's `Surveys` module; `tests/surveys-sync.test.js` guards drift. Survey descriptions live only in the userscript (`Surveys.DESCRIPTIONS`).
- `reference/` — source data behind the rules: `Stuff for EMR.xlsx`, exercise-name lists, `reference_surveys.txt` (survey descriptions + scoring). Exercise/survey names only, **not PHI**.
- `scripts/build-local.js` — `npm run build:local`; generates the git-ignored local Tampermonkey build with a `file://` auto-update URL.
- `deploy/` — Web Store assets: `store-listing.md` (copy/paste sheet — item ID + a "don't list survey acronyms" note live here), `privacy-policy.html`, screenshot, the built `.zip` (git-ignored), `store-review/` (rejection emails).
- `tests/` + `package.json` — `npm test` (Node ≥ 20, zero deps): version/body sync, matching table, survey scoring + sync.
- `archive/` — historical/dead code kept so nothing is lost (retired compact-mode redesign + postmortem, a parked feature-toggle idea, the original v1 prompt).
- `captures/` — real-page captures (`*.mhtml`), console logs (`*.log`), DOM dumps (`dom-*.html`). **Real patient data (PHI)** — git-ignored twice. The closest thing to fixtures; open a `.mhtml` in Chrome (or decode via `quopri` in Python) to inspect DOM offline. Never let their contents leave the repo.
- `AGENTS.md` / `HANDOFF.md` / `DECISIONS.md` / `CHANGELOG.md` / `DEPLOYMENT.md` — docs (this file, current-state handoff, decision log + gotchas, per-version log, publishing/force-install runbook).

## Userscript module layout (near-top → bottom of the IIFE)

Shared: `pageType`/`onUrlChange` (SPA nav), `Features` (toggles), logging, `waitFor`/`sleep`/`simulateClick`/`setReactValue`, highlight helpers, `Proc` (procedure matcher), `Dx` (diagnosis codes), toast + `athConfirmMoves` + `athConfirmDiagnosis` + `athConfirmGoal` dialogs, `Fixer`, `Surveys`, `athInjectStyle`/`athObserveBody`, `athStatusBus`/`athPaintButton`/`athBindHover` (button status colours), `athProviderInfo`/`athDiscipline`. Modules: 1 compact CSS, 2 jump-to-Flowsheet, 9 Fix Procedures, 10 read-only match preview, 11 Fix Private Pay, 12 survey quick-add panel, 13 survey status button + goal-from-score, 14 calendar, 15 Fix Diagnosis, 16 pre-sign critical warnings, plus `featureSettingsPanel`. Each observer-driven injector is gated by `Features.enabled(id)` at its top (adds when on, removes its elements when off).

**Button status colours:** red = clicking would change something, green = clean, grey = busy. Subscribe a `refreshStatus()` to `athStatusBus.add()` and paint with `athPaintButton(btn, state)`; never add a polling timer (see DECISIONS.md).

## The matching engine (Fix Procedures) — three-way sync

The rule table exists in three places and must stay behaviorally identical: `matching/procedure-matching.js` (canonical, exported, tested), the `Proc` engine near the top of the userscript, and therefore `content.js`. `tests/table-sync.test.js` compares them. **Change the canonical file first, then mirror into the userscript's `Proc`.** Precedence = first matching rule wins; the winning rule supplies BOTH the CPT code AND the justification (they never split). Justifications are **append-only** (join with `\n`; no overwrite).

## Feature toggles

`Features` (userscript, near top) + `featureSettingsPanel()`. State persists in page `localStorage['athelas-helper:features']` (no permission, no data; identical in userscript + extension). UI = an inline green "Extension Settings" button placed next to a native control (`[aria-label="Clear All Filters"]` on calendar, `[aria-label="Recently Viewed Notes"]` on a chart note) — decoupled from features so it's reachable even if one breaks. Add a toggle by adding to `Features.LIST` and gating the injector with `Features.enabled(id)`.

## Build & release workflow

1. Edit `userscript/athelas-insights-helper.user.js` (and, for matching/survey logic, the canonical `matching/` or `surveys/` file first).
2. Bump the version in `@version`, `manifest.json`, `package.json`, and the `content.js` banner — all four to the same number.
3. Regenerate `content.js` (command in the extension README).
4. `npm test` (must be green) and `node --check` both userscript and content.js.
5. `npm run build:local` (refresh the local Tampermonkey build) and rebuild the store zip: `cd athelas-insights-helper-extension && zip -rq ../deploy/athelas-insights-helper-vX.Y.Z.zip . -x '*.DS_Store'`.
6. Update `CHANGELOG.md`.

## Commit & push policy

- Commit locally after each self-contained change, with a descriptive multi-line message. Author is `BenWare144 <bwarex@gmail.com>`.
- **Do NOT push** — the human (Ben) pushes. Leave commits local unless explicitly asked; the sandbox has no GitHub credentials anyway.
- Never commit PHI: `captures/` and `*.log`/`*.mhtml`/`*.zip` are git-ignored (belt-and-suspenders). The `.gitignore` is an ignore-everything whitelist — new top-level dirs must be explicitly whitelisted to be tracked.
- Filesystem quirk: the mount blocks `rm`/unlink (`mv`/rename works). To delete, use the delete-permission tool; NEVER rename junk into `.git/refs/**` (it broke a push once).

## Workflow expectations

- Run `npm test` before calling anything done; include a verification step.
- Real DOM behavior can only be verified on the live site or against an `.mhtml` capture — when you can't verify, say so. Many features are "best-effort pending live verification"; the human tests and sends back logs/captures.
- The site changes under us. When a selector fails, check the newest `.mhtml` captures and the DOM facts in `DECISIONS.md` before rewriting.
- Markdown/text files: one line per paragraph/bullet — never hard-wrap mid-sentence (a standing user preference).

## Versioning

Semver-ish: new feature = minor; behavior change = minor; CSS/selector/bugfix = patch. Keep the four version spots in sync and log anything a deployed clinic would notice in `CHANGELOG.md`.
