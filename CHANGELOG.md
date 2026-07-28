# Changelog

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
