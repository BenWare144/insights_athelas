<!-- Run with: Claude Code, model SONNET 5. If the sticky-header work goes sideways (MUI Tabs min-heights, sticky offsets), retry the failing step with OPUS 4.8. -->

Read `redesign/PLAN.md` and `redesign/DOM-FACTS.md`. Phase 1 must already be merged.

**This project is CSS-only: no new JavaScript, no injected elements, no toggles, nothing
hidden. Shrink, never hide.** (The one exception below — updating the HEADER_OFFSET
constant — is a number change in an existing module, not new layout JS.)

You are implementing **Phase 2**: compact the bars above the note content in
`athelas-appointments-compact.user.js` (new `/* v15 Phase 2 */` block inside `cssChartNote`).
Bump @version to 15.1.0.

Targets (structure and exact classes in DOM-FACTS "Layout skeleton"):

1. Breadcrumb strip (sticky header row 1): keep the breadcrumbs visible; reduce the row's
   `tr-py-2` to 1px so the whole row becomes a thin strip. Fonts untouched.
2. Patient banner (name + MRN + Book Appointment): compact its vertical padding to ~2px.
   Locate its container by grepping the DOM captures around the `(MRN:` text — pick a
   stable utility-class combo, no hashes.
3. Tabs (`.MuiTabs-root`, both the patient-level tabs and the sticky z-20 tabs inside the
   note): `min-height: 26px !important` on `.MuiTabs-root` and `.MuiTab-root`, trim
   `.MuiTab-root` padding to `2px 10px`. Preserve the z-20 element's stickiness and its
   negative-margin layout.
4. Title row: `h4.MuiTypography-Heading\.H4` → `font-size: 15px; line-height: 1.2`
   (LARGE font — allowed). Row padding `tr-pt-3` → 2px, scoped to the sticky header.
5. Info strip (Plan of Care / Pending Visits / Prior Auth …): tighten row gaps; text is
   Small — do not touch font-size. Leave the in-product "Expand" toggle working.
6. Measure the resulting sticky-header height and update `HEADER_OFFSET` in
   `featureScrollToFlowsheet` (currently 64) to that height + ~6px. Add a comment noting
   Phase 2 changed it.

Hard constraints:
- **NEVER put a backtick (`) anywhere inside the cssChartNote string — including comments.**
  It is a JS template literal; a stray backtick terminates it and silently kills the entire
  script (this exact bug broke a previous attempt). After editing, run
  `node --check athelas-appointments-compact.user.js` BEFORE reporting done.
Other constraints: same as Phase 1 (no MuiInputBase/OutlinedInput padding rules — the two
selects in the title row are MUI inputs; compact their WRAPPER row only; no small-font
shrinking; no css-hash selectors; chart-note scope only).

Verify selectors against `redesign/dom-clare-progress-note.html` AND
`redesign/dom-melanie-daily-note.html` (daily vs progress notes differ). `node --check` at the end.
