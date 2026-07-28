# Compact Mode v15 — Redesign Plan (CSS-only)

Goal: maximize usable flowsheet area on therapist laptops (~1536×~700 effective px).
Function over beauty. Design decisions settled with Ben:

- **CSS only. No JS layout manipulation** — no toggles, no injected UI, no hiding whole
  menus. Rationale: JS is more likely to break functionality, break on site updates, or
  hide a menu in a way a therapist can't figure out how to undo. Everything stays visible,
  just significantly condensed. (The existing JS features — jump-to-flowsheet and Fix MET —
  stay; the ban is on NEW JS that reshapes the layout.)
- **Global nav (250px Quasar drawer): shrink to ~150px**, labels ellipsized. Not hidden.
- **Section sub-nav (160px rail): shrink to ~112px**, keep visible.
- **Fonts: shrink LARGE fonts freely (encouraged); never shrink small fonts**
  (`Body.Small.*`, `Body.ExtraSmall`, `!tr-text-xs`) — explicit therapist request.

All selectors referenced here are verified in `DOM-FACTS.md`. Implementation is 3 phases =
3 Claude Code sessions (prompts in `prompts/`). Commit after each phase.

## Space budget (approx., 1536px-wide laptop)

| Region | Now | After | Reclaimed |
|---|---|---|---|
| Global drawer | 250px | ~150px, labels ellipsized | **~100px H** |
| Section sub-nav | 160px + 24px pad | ~112px | **~70px H** |
| Content side margins (`tr-mx-4`) | 32px | 0–8px | **~28px H** |
| Patient banner + tabs rows | ~90px | ~50px | **~40px V** |
| Breadcrumb row | ~40px | ~18px thin strip | **~22px V** |
| Title + info rows | ~80px | ~34px | **~45px V** |
| Section H1s (9×) | ~32px each | ~20px each | **~12px V per section** |
| Flowsheet card/item rows | ~34px | ~26px | **~2 more rows/screen** |

Net: ~200px more width for the flowsheet, ~110–140px more height above the fold.
Everything remains on screen and clickable — nothing to "get back."

## Phase 1 — Horizontal space (CSS only, low risk)

1. Shrink drawer: `aside.q-drawer` has INLINE `width: 250px` and `.q-page-container` has
   INLINE `padding-left: 250px` — override both to 150px with `!important` (beats inline,
   DOM-FACTS lesson #2). Also constrain `.q-drawer__content` width. Ellipsize item labels
   (`overflow: hidden; text-overflow: ellipsis; white-space: nowrap` on q-item label spans);
   trim q-item horizontal padding. Do NOT shrink label font (small).
   The existing v10 drawer rules (q-item heights 28/24px) stay — they still match.
2. Sub-nav rail: override the `tr-w/min-w/max-w-[160px]` trio to 112px; ellipsize labels;
   keep existing v10 rail-compaction rules; no font changes (ExtraSmall).
3. Content scroller `tr-mx-4` → `margin-left/right: 0`; sticky-header rows `tr-px-6` →
   `padding-inline: 8px` (scoped to the sticky header).

Risks: drawer labels clipping (acceptable — icons remain, ellipsis signals more text);
Quasar re-applying inline styles on resize (`!important` still wins — verify by resizing).

## Phase 2 — Top bars (CSS, medium risk)

1. Breadcrumb strip (sticky header row 1): keep it, but thin — row `tr-py-2` → 1px,
   breadcrumb font is Body.Normal (medium size, may drop to 12px? NO — treat as small-ish;
   leave font, trim padding only).
2. Patient banner (name + MRN + Book Appointment): vertical padding → ~2px.
3. Tabs (`.MuiTabs-root` both patient-level and the sticky z-20 tabs inside the note):
   `min-height: 26px !important` on `.MuiTabs-root` and `.MuiTab-root`; `.MuiTab-root`
   padding `2px 10px`. Preserve the z-20 element's stickiness and negative-margin layout.
4. Title row: `h4.MuiTypography-Heading\.H4` → ~15px (LARGE font, allowed); row `tr-pt-3` → 2px.
   Compact the two selects via their WRAPPER row only — never MuiInputBase padding (lesson #1).
5. Info strip: tighten gaps; Small text untouched; leave the in-product "Expand" toggle alone.
6. Measure the new sticky-header height and update `HEADER_OFFSET` in
   `featureScrollToFlowsheet` (currently 64) to match (+ ~6px). This is a constant tweak in
   an existing module, not new layout JS.

## Phase 3 — Note content + flowsheet density (CSS, medium risk)

1. Section H1s: `h1.MuiTypography-Heading\.H1` → font-size ~18px, line-height 1.2.
2. Flowsheet items: `li[aria-label="Intervention"]` → `padding: 1px 0 1px 4px`; drag handle
   keeps ≥20px hit area (Fix MET drags via it).
3. Procedure-card header rows + blue summary bar: trim container paddings/gaps only;
   summary text is Small — font untouched.
4. Row editors (tiptap): wrapper margins only; if touching the editor, scope to
   `[data-section="flowsheet"] .tiptap.ProseMirror`, line-height/margins only.
   Never MuiInputBase/OutlinedInput padding (the v14 Mins-field breakage).
5. Second sticky (z-20 tabs inside note): compacted in Phase 2; verify it survived Phase 3.

## Verification checklist (run after every phase)

- Type into: Mins field, Intervention name, a tiptap notes field, the procedure autocomplete.
- Drag an intervention row (pointer) + Fix MET button end-to-end.
- Jump-to-flowsheet lands correctly (HEADER_OFFSET).
- All nav destinations still clickable: every drawer item, every sub-nav section link,
  every tab — nothing hidden, nothing overlapping.
- Open the CPT add dialog, row "⋮" menus, @-mention popover — no clipping.
- Resize the window: no horizontal scrollbar; drawer stays 150px; sticky headers stick.
- Check the Appointments page still renders sanely (chart-note rules must stay scoped).

## Tooling notes

- **Claude Code** implements (prompts in `prompts/`; model recs in each header):
  Sonnet 5 for all three phases; escalate a failing step to Opus 4.8 only if Sonnet loops.
- **Claude in Chrome extension**: verification only (`prompts/troubleshooting-with-chrome.md`) —
  live measurements, console logs (`[athelas:*]`), typing tests, screenshots.
- The decoded DOM files (`dom-*.html`) here are greppable ground truth — grep them, don't guess.
- **Never put a backtick inside the cssChartNote template literal** (comments included);
  one stray backtick silently kills the whole script. `node --check` after every edit.
