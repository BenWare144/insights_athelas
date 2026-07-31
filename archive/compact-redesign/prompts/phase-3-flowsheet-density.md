<!-- Run with: Claude Code, model SONNET 5 with extended thinking enabled. This phase touches the area therapists actually work in — the input-safety constraints matter most here. -->

Read `redesign/PLAN.md` and `redesign/DOM-FACTS.md`. Phases 1–2 merged.

**This project is CSS-only: no new JavaScript, no injected elements, no toggles, nothing
hidden. Shrink, never hide.**

You are implementing **Phase 3**: density inside the note content, especially
`[data-section="flowsheet"]`, in `athelas-appointments-compact.user.js`
(`/* v15 Phase 3 */` block inside `cssChartNote`). Bump @version to 15.2.0.

1. Section headings: `h1.MuiTypography-root` with variant `MuiTypography-Heading\.H1`
   ("Subjective", "Interventions", …) → `font-size: 18px; line-height: 1.2; margin: 0`.
   These are LARGE fonts — shrinking is encouraged.
2. Flowsheet intervention rows: `li[aria-label="Intervention"]` → `padding: 1px 0 1px 4px`.
   The drag handle `div[aria-label="Drag to reorder"]` must keep ≥20px hit area — the
   Fix MET module (MODULE 9) drags via these handles.
3. Procedure-card header rows (the row with `input[aria-label="replace procedure"]`, Mod,
   mins, units, therapist, HEP/Done): trim container/wrapper paddings and gaps only.
4. Blue summary bar ("Treatment Time / Timed / Untimed / Total Units / Time in Clinic"):
   compact container padding to ~4px. Its text is `Body.Small.*` — DO NOT change font-size.
5. Notes/justification editors (tiptap ProseMirror) inside rows: you may reduce wrapper
   margins. If you touch the editor itself, scope to
   `[data-section="flowsheet"] .tiptap.ProseMirror` with line-height/margins only — no
   padding overrides on MUI input roots anywhere (v14 broke the Mins field this way;
   see the disabled block comment near the top of cssChartNote).
6. Checkboxes/icon buttons in rows: existing global rules already compact these; only add
   flowsheet-scoped tweaks if a specific control is still the row-height driver. State in
   your summary which element sets each row's final height.

Hard constraints:
- **NEVER put a backtick (`) anywhere inside the cssChartNote string — including comments.**
  It is a JS template literal; a stray backtick terminates it and silently kills the entire
  script (this exact bug broke a previous attempt). After editing, run
  `node --check athelas-appointments-compact.user.js` BEFORE reporting done.
Other constraints: no `.MuiInputBase-root`/.MuiOutlinedInput-root` padding/min-height rules;
no small-font shrinking (`Body.Small.*`, `Body.ExtraSmall`, `!tr-text-xs`); no css-hash
selectors; don't hide or narrow drag handles; chart-note scope only.

Verify every selector against both `redesign/dom-*.html` captures; confirm
`li[aria-label="Intervention"]` rules don't collide with the dnd-kit drag preview (grep for
`DndDescribedBy` context). `node --check` at the end. List expected px savings per rule.
