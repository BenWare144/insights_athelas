# AGENTS.md — Athelas Insights Helper

Guidance for AI agents (and humans) working in this repo. Read this before touching code.

## What this is

A **chart-note workflow-automation helper** for **Athelas Insights** (insights.athelas.com), a physical-therapy EHR, built for a working PT ("the therapist"). The **primary feature is the one-click fixers**: **Fix Procedures** (moves each "Done" intervention to its correct CPT code — 97110 / 97112 / 97530, incl. MET → 97112 — and appends the standard justification, all after a per-change review dialog) and **Fix Private Pay** (collects "Done" interventions into the private-pay section with the same fix-ups). Secondary: jump-to-Flowsheet on load. A compact-layout CSS pass is a **minor background convenience only** — it is *not* the identity of this app. Do **not** describe the app as "compact mode"; that framing is a historical artifact that has repeatedly leaked into user-facing text and must stay out of it.

Shipped two ways, same code:

| Artifact | File | Status |
|---|---|---|
| Tampermonkey userscript | `athelas-insights-helper.user.js` | **Source of truth.** Currently installed on the therapist's machine. |
| Chrome extension (MV3) | `athelas-insights-helper-extension/` | Generated from the userscript. Target for clinic-wide deployment. |

## Dual-artifact rule (important)

`athelas-insights-helper-extension/content.js` is the userscript body minus the GM header, regenerated with the command in `athelas-insights-helper-extension/README.md`. **Never edit content.js directly.** Edit the userscript, regenerate, bump `@version` and `manifest.json` `version` together. `npm test` fails if they drift.

The extension runs the script in the **MAIN world** — required, because the one-click fixers reach Tiptap editors via `__reactFiber$` DOM expandos, which are invisible from the isolated world. Don't "fix" this by removing `"world": "MAIN"`.

## Hard constraints (therapist-imposed, non-negotiable)

1. **No font-size shrinking** to achieve compactness. Density comes from margins/padding/line-height only.
2. **Never pad/restyle `.MuiInputBase` internals** — it broke input click targets in earlier versions.
3. **No css-hash selectors** (e.g. `.css-1abc2d3`) — MUI regenerates them every deploy. Use stable hooks: `data-section` attributes, `aria-label`s, semantic class names like `.tiptap.ProseMirror`, MUI root classes.

## Repo map

- `athelas-insights-helper.user.js` — the script. Modules are independent, booted at the bottom of the IIFE. Verbose `[athelas:tag]` console logging throughout; keep that style.
- `athelas-insights-helper-extension/` — MV3 packaging (see its README).
- `redesign/` — v15 planning workspace: `PLAN.md`, `DOM-FACTS.md` (verified DOM structure — check here before inventing selectors), `procedure-matching.js` (canonical matching table + the only module with exports), `procedure-matching-QUESTIONS.md` (open therapist questions — entries marked draft there are **not final**).
- `captures/` — all real-page captures (`*.mhtml`), console logs (`*.log`), and chart-note DOM dumps (`dom-*.html`). These contain **real patient data (PHI)** and are git-ignored twice over (see `.gitignore`). The closest thing to fixtures; open a `.mhtml` in Chrome to inspect DOM offline. Never let their contents leave the repo.
- `athelas-insights-helper.archive.js` — modules killed by the v14 site rework. Reference only.
- `tests/` + `package.json` — `npm test` (Node ≥ 20, zero deps).
- `DEPLOYMENT.md` — Web Store publishing + IT force-install runbook.

## Procedure-matching table sync

The matching table exists in **three places** and must stay behaviorally identical: `redesign/procedure-matching.js` (canonical, exported, tested), the shared `Proc` engine near the top of the userscript, and therefore in the generated `content.js`. `tests/table-sync.test.js` compares them; if you tune the table, change the canonical file first, then mirror into the userscript's `Proc` engine.

## Workflow expectations

- Run `npm test` before calling anything done.
- Real verification requires the live site or an `.mhtml` fixture; when you can't verify DOM behavior, say so explicitly.
- The site changes under us (see git history: v11 and v14 reworks). When a selector fails, check the newest `.mhtml` captures and `redesign/DOM-FACTS.md` before rewriting logic.
- PHI caution: everything under `captures/` (`.mhtml`, `.log`, `dom-*.html`) contains real patient names. Keep new captures in `captures/` (git-ignored twice). Never copy their contents into commit messages, docs, or anything leaving this repo.

## Versioning

Semver-ish: site-rework survival = minor bump, behavior changes = minor, CSS/selector tweaks = patch. Update the `@description` header if features change, and `CHANGELOG.md` for anything a deployed clinic would notice.
