# Compact Mode — post-mortem (2026-07-28)

A record of the compact-mode work on the Athelas chart-note UI: what it tried to
do, what broke, why, and where it landed. Written so a future attempt doesn't
repeat the same mistakes.

## What compact mode is for

Therapists work almost entirely in Interventions → Flowsheet on small laptops.
The goal was to reclaim screen space (mostly vertical) so more of the flowsheet
is visible without scrolling. It is **CSS-only** by hard constraint — no JS
layout manipulation, no font-size shrinking, no touching `.MuiInputBase`
internals, no `css-hash` selectors (MUI regenerates those each deploy). Density
comes from margins, padding, line-height, and element heights only.

## Timeline

- **14.15.0** — pre-redesign. Essentially native layout. No overflow, but "way
  too uncompact" per Ben.
- **v15.0–15.2 (redesign)** — the aggressive compaction landed, including two
  *horizontal* width-forces: the section sub-nav rail `160px → 112px` and the
  far-left Quasar drawer `250px → 150px`. This is where the trouble started, but
  it stayed hidden (see below).
- **15.2.0** — "last working version" in Ben's memory. In reality its CSS already
  contained the 112px sub-nav force and the 150px drawer — the exact rules that
  overflow. It only *looked* fine because the compact CSS frequently never
  injected (see next point).
- **15.9.0** — fixed a single-page-app injection bug: before this, if a tab first
  loaded on a non-matching URL and then client-side-navigated to a chart note,
  the script (and its CSS) never ran. Fixing injection made the compact CSS apply
  **consistently** for the first time — which is what exposed the latent overflow
  everywhere.
- **15.10.0 / 15.10.1** — attempts to fix the exposed overflow (112 → 148 → 160px,
  `overflow-x: clip`, `max-width` containment, reduced indent, ellipsis; drawer
  150 → 165px + `overflow-x: hidden`). These did not fully resolve it and cost
  several rounds.
- **15.11.0 (resolution)** — middle ground. Keep all the vertical density; drop
  the two horizontal width-forces. Sub-nav returns to its **native width**; the
  drawer is set to **200px** (down from native 250, up from the broken 150) with
  `overflow-x: hidden` as a safety net.

## What actually broke

1. **Sub-nav rail forced to a fixed width (112px).** The section nav items are
   flex rows: `[label span][empty spacer with margin-right:auto]`, label padded
   `tr-pl-5` (20px). The longest labels ("Functional Outcomes" etc.) plus padding
   need ~145px. At 112px the item highlight boxes and labels overflowed the rail
   and painted over the note content. Clipping the rail (`overflow-x: clip`) only
   moved the problem to "cut off mid-corner," and the standard flex-ellipsis
   recipe didn't reliably engage inside MUI/emotion's structure, so labels either
   overflowed or truncated awkwardly.
2. **Drawer forced to 150px.** Labels like "Daily Operations" are wider than
   150px, so Quasar's `q-drawer__content.scroll` showed a **horizontal
   scrollbar**.
3. **Latency via the injection bug.** Both of the above were present since ~15.0
   but invisible while the SPA injection bug kept the CSS from applying. The
   15.9.0 injection fix (which Ben wanted, for the buttons + auto-scroll) turned
   the latent bugs into visible, consistent breakage. This is why "15.2.0 worked"
   and "current is broken" were both true at once.

## Root causes / lessons

- **Vertical compaction is safe; horizontal width-forcing is not.** Padding,
  margin, line-height, and height reductions never caused overflow. Forcing a
  container *narrower than its intrinsic content* on a third-party SPA did — every
  time. If space must be reclaimed horizontally, do it where there's slack
  (native drawer 250→200 is fine) and never below the content's natural width.
- **No live authenticated browser during the CSS work.** All measurements were
  eyeballed from `.mhtml` snapshots, so the "fix" widths (148, 160, 165) were
  guesses that kept missing. Future CSS tuning on this app should use Claude in
  Chrome to measure real rendered widths before choosing pixel values.
- **Emotion `css-hash` + Tailwind arbitrary-value classes (`tr-w-[160px]`) are
  brittle to override.** You can't cleanly control the inner box model (flex
  children, `margin-right:auto` spacers, MUI display defaults) from the outside,
  which is why ellipsis/containment attempts were unreliable.
- **The savings didn't justify the risk.** 112 vs 148 vs 160 vs native 200 is a
  few dozen pixels on one rail — not worth repeated breakage. Prefer the safe,
  high-value vertical compaction and leave fragile rails alone.

## Where it landed (15.11.0)

- Sub-nav: **native width**, but keeps the v10 padding/height compaction (still
  dense vertically, no overflow).
- Drawer: **200px** + `overflow-x: hidden` (reclaims some space, fits labels, no
  scrollbar).
- Everything else (patient banner, tabs, sticky header, section rows, input
  paddings) keeps the 15.2.0 vertical compaction.
- All non-CSS features are unaffected: Fix Procedures, Fix Private Pay,
  jump-to-Flowsheet, and the SPA injection all remain.

## If revisiting

Use a live browser to measure. Keep vertical compaction. For any horizontal
change, verify the longest real label fits at the chosen width before shipping,
and never force a rail below its content's natural width. Consider that the
marginal horizontal savings may not be worth the maintenance cost at all.
