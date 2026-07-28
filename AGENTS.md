# AGENTS.md — Athelas Compact

Guidance for AI agents (and humans) working in this repo. Read this before touching code.

## What this is

Enhancements for **Athelas Insights** (insights.athelas.com), a physical-therapy EHR, built for a working PT ("the therapist"). Two features families: compact spacing (CSS) for the Appointments and Chart Note pages, and Chart Note automation (jump-to-Flowsheet, one-click "Fix MET" that drags Muscle Energy Technique items to CPT 97112 and standardizes justifications).

Shipped two ways, same code:

| Artifact | File | Status |
|---|---|---|
| Tampermonkey userscript | `athelas-appointments-compact.user.js` | **Source of truth.** Currently installed on the therapist's machine. |
| Chrome extension (MV3) | `athelas-compact-extension/` | Generated from the userscript. Target for clinic-wide deployment. |

## Dual-artifact rule (important)

`athelas-compact-extension/content.js` is the userscript body minus the GM header, regenerated with the command in `athelas-compact-extension/README.md`. **Never edit content.js directly.** Edit the userscript, regenerate, bump `@version` and `manifest.json` `version` together. `npm test` fails if they drift.

The extension runs the script in the **MAIN world** — required, because Fix-MET reaches Tiptap editors via `__reactFiber$` DOM expandos, which are invisible from the isolated world. Don't "fix" this by removing `"world": "MAIN"`.

## Hard constraints (therapist-imposed, non-negotiable)

1. **No font-size shrinking** to achieve compactness. Density comes from margins/padding/line-height only.
2. **Never pad/restyle `.MuiInputBase` internals** — it broke input click targets in earlier versions.
3. **No css-hash selectors** (e.g. `.css-1abc2d3`) — MUI regenerates them every deploy. Use stable hooks: `data-section` attributes, `aria-label`s, semantic class names like `.tiptap.ProseMirror`, MUI root classes.

## Repo map

- `athelas-appointments-compact.user.js` — the script. Modules are independent, booted at the bottom of the IIFE. Verbose `[athelas:tag]` console logging throughout; keep that style.
- `athelas-compact-extension/` — MV3 packaging (see its README).
- `redesign/` — v15 planning workspace: `PLAN.md`, `DOM-FACTS.md` (verified DOM structure — check here before inventing selectors), `procedure-matching.js` (canonical matching table + the only module with exports), `procedure-matching-QUESTIONS.md` (open therapist questions — entries marked draft there are **not final**).
- `*.mhtml` — captured real pages: the closest thing to fixtures. Named for what they demonstrate (`…_large_spacing.mhtml` = bug repro, `…_with_mins_button.mhtml` = feature state). Open in Chrome to inspect DOM offline.
- `insights.athelas.com-*.log` — console logs from the therapist's sessions, used for remote debugging.
- `athelas-appointments-compact.archive.js` — modules killed by the v14 site rework. Reference only.
- `tests/` + `package.json` — `npm test` (Node ≥ 20, zero deps).
- `DEPLOYMENT.md` — Web Store publishing + IT force-install runbook.

## Procedure-matching table sync

The matching table exists in **three places** and must stay behaviorally identical: `redesign/procedure-matching.js` (canonical, exported, tested), inline in userscript MODULE 10, and therefore in the generated `content.js`. `tests/table-sync.test.js` compares them; if you tune the table, change the canonical file first, then mirror into MODULE 10.

## Workflow expectations

- Run `npm test` before calling anything done.
- Real verification requires the live site or an `.mhtml` fixture; when you can't verify DOM behavior, say so explicitly.
- The site changes under us (see git history: v11 and v14 reworks). When a selector fails, check the newest `.mhtml` captures and `redesign/DOM-FACTS.md` before rewriting logic.
- PHI caution: `.mhtml` files and logs contain real patient names. Never copy their contents into commit messages, docs, or anything leaving this repo. Do not add new PHI-bearing files to git (`.gitignore` defaults to ignore-everything for this reason).

## Versioning

Semver-ish: site-rework survival = minor bump, behavior changes = minor, CSS/selector tweaks = patch. Update the `@description` header if features change, and `CHANGELOG.md` for anything a deployed clinic would notice.
