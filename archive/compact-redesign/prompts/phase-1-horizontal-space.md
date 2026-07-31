<!-- Run with: Claude Code, model SONNET 5 (mechanical CSS work with exact selectors provided). -->

Read `redesign/PLAN.md` and `redesign/DOM-FACTS.md` first. You are implementing **Phase 1**
of the CSS-only compact-mode redesign in `athelas-appointments-compact.user.js`.

**This project is CSS-only: do not write any new JavaScript, do not inject any elements,
do not add toggles, and do not hide any menu or navigation element. Shrink, never hide.**

All new CSS goes inside the `cssChartNote` template string in MODULE 1 (`applyCompactCss`),
in a commented `/* v15 Phase 1 */` block. Bump @version to 15.0.0.

1. Shrink the global Quasar drawer from 250px to 150px. Both widths are INLINE styles, so
   `!important` is required (DOM-FACTS lesson #2):
   - `aside.q-drawer { width: 150px !important; }`
   - `.q-page-container { padding-left: 150px !important; }`
   Ellipsize drawer item labels (`overflow: hidden; text-overflow: ellipsis;
   white-space: nowrap`) and trim q-item horizontal padding so icons + truncated labels fit.
   Do NOT change label font-size (small). Do NOT hide the drawer or any item in it.
   The existing v10 drawer rules (q-item min-height 28px etc.) still apply — keep them.
2. Shrink the section sub-nav rail from 160px to 112px: override the
   `.tr-w-\[160px\].tr-min-w-\[160px\].tr-max-w-\[160px\]` trio's width/min-width/max-width.
   Ellipsize the item label spans. Keep the existing v10 rail-compaction rules.
   No font-size changes (ExtraSmall text must not shrink).
3. Kill the content side margins: the scroller
   `.tr-mx-4.tr-h-full.tr-w-full.tr-overflow-x-auto` → `margin-left/right: 0 !important`.
   Rows using `tr-px-6` inside the sticky header → `padding-left/right: 8px !important`
   (scope to the sticky header container, not globally).

Hard constraints:
- **NEVER put a backtick (`) anywhere inside the cssChartNote string — including comments.**
  It is a JS template literal; a stray backtick terminates it and silently kills the entire
  script (this exact bug broke a previous attempt). After editing, run
  `node --check athelas-appointments-compact.user.js` BEFORE reporting done.
- CSS only — zero new JS, zero injected DOM, zero `display: none` on navigation/menus.
- Never add padding/min-height rules on `.MuiInputBase-root` / `.MuiOutlinedInput-root`.
- Never shrink `Body.Small.*`, `Body.ExtraSmall`, or `!tr-text-xs` text.
- No emotion-hash selectors (`css-xxxxx`).
- Scope everything so the /v3/appointments page CSS block is untouched.

Verify by grepping `redesign/dom-clare-progress-note.html` for every selector you write
(each must match). Then run `node --check athelas-appointments-compact.user.js`.
Finish by listing the selectors you added and which DOM capture line numbers confirm them.
