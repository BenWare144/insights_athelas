# Athelas Insights Chart Note — verified DOM facts (post-v14 rework)

Verified against 5 mhtml captures (Jul 2026), incl. open-dialog states. Decoded DOMs
in this folder: `dom-clare-progress-note.html` (progress note), `dom-melanie-daily-note.html`
(daily note). Grep these before trusting any selector not listed here.

## Layout skeleton

```
#q-app
├─ .q-drawer-container > aside.q-drawer.q-drawer--left     ← global nav, INLINE style="width: 250px; transform: translateX(0px)"
└─ .q-page-container                                       ← INLINE style="padding-left: 250px"
   └─ main … 
      ├─ [patient banner: name + (MRN/DOB) + icon buttons + Book Appointment]
      ├─ .MuiTabs-root                                     ← Demographics | Appointments | Attachments | Tasks | Orders
      ├─ .tr-sticky.tr-top-0.tr-z-10.tr-w-full.tr-border-b.tr-border-Shape-OnSurface-Outlines.tr-bg-Surface-Neutral-Lighter-Surface
      │  ├─ row 1: .tr-flex.tr-items-center.tr-justify-between.tr-gap-2.tr-border-b….tr-px-6.tr-py-2
      │  │         └─ nav.MuiBreadcrumbs-root ("All Appointments > <patient>") + Import + View Change History
      │  ├─ row 2: .tr-flex.tr-flex-wrap.tr-items-center.tr-gap-4.tr-px-6.tr-pt-3
      │  │         └─ h4.MuiTypography-Heading\.H4 (visit title) + date + Appointment Type + Clinical Note Type selects
      │  └─ row 3: info strip (Plan of Care End Date / Pending Visits / Prior Auth / Insurance / …) + "Expand" toggle
      └─ .tr-flex.tr-h-full.tr-max-w-full.tr-flex-row.tr-overflow-hidden
         ├─ .tr-w-\[160px\].tr-min-w-\[160px\].tr-max-w-\[160px\]   ← section sub-nav rail (SUBJECTIVE/OBJECTIVE/…)
         │    items: span.MuiTypography-Body\.ExtraSmall.!tr-text-xs  (SMALL FONT — do not shrink)
         │    rows:  .tr-min-h-7 [aria-label="<section name>"][role="link"]
         └─ .tr-mx-4.tr-h-full.tr-w-full.tr-overflow-x-auto.tr-overflow-y-scroll.tr-pb-4.…   ← note content scroller (16px side margins)
            └─ note sections: [data-section="…"], 22 present; flowsheet = [data-section="flowsheet"]
```

## Note content

- Section headings ("Subjective", "Objective", "Interventions", …):
  `h1.MuiTypography-root.MuiTypography-Heading\.H1` (9 per note — LARGE font, safe to shrink)
- Visit title: `h4.MuiTypography-Heading\.H4`
- There is a second sticky element inside note content: `.tr-sticky.tr-top-0.tr-z-20` with
  `.MuiTabs-root` and negative margins (`tr-mx-[-20px]`). Don't break its stickiness.

## Flowsheet (the part therapists live in)

- Scope: `[data-section="flowsheet"]`
- Blue summary bar: contains "Treatment Time:" spans, `MuiTypography-Body.Small.Medium` /
  `Body.Small.SemiBold` (SMALL fonts — do not shrink)
- Procedure card code input: `input[aria-label="replace procedure"]` (e.g. "97110 - Therapeutic Exercise")
- List region: `div[role="region"][aria-label="<name> interventions"]`
- List: `ul[aria-label="<name> intervention list"]` (absent when empty)
- Item: `li[aria-label="Intervention"]` with classes `tr-flex tr-items-center … tr-py-1 tr-pl-2 tr-border-b tr-border-l-2`
- Drag handle: `div[aria-label="Drag to reorder"][role="button"]` — dnd-kit keyboard+pointer sensors;
  `.tr-w-5` wide. Fix MET module (MODULE 9) drives these — do not hide or shrink below usability.
- Item name: `input[aria-label="Intervention name"]`
- The old `.MuiDataGrid-*` grid is GONE (replaced by these dnd-kit cards in v14 rework).

## Dead / absent after rework (do NOT target)

`.MuiDataGrid-*`, `header.MuiAppBar-root`, `.MuiToolbar-root`, `.MuiToggleButton-root`,
`.MuiListItem-root`, `.MuiRadio-root`, `MuiTypography-Body.Large.Regular`,
tr-utilities: `py-8/6/5/2.5/1.5`, `mb-8/7/6/2.5/1.5/1`, `mt-8/6/5/4/1.5/1`,
`gap-y-6/5/4/3`, `space-y-8/6/4/3/1`, `min-h-12/10/9/6`, `p-5`, `pt-6`, `pb-6/14/20`, `mb-10/20`, `pt-16`.

## Hard-won lessons (from v10–v14)

1. **MUI input padding overrides break editing.** Global `.MuiInputBase-root` /
   `.MuiOutlinedInput-root` padding rules broke the Mins field (display AND edit).
   Never apply blanket padding to MUI input roots; scope any input tweak to a specific
   aria-label and test typing into it.
2. **CSS `!important` beats inline styles** — use it to override the drawer's inline
   `width`/`transform` and `.q-page-container`'s inline `padding-left`.
3. **Row-height shrinking of virtualized components** caused dead-space bugs (DataGrid era).
   The dnd-kit list is NOT virtualized, so row compaction is safe there.
4. Hashed classes (`css-110ih45` etc.) are emotion-generated and unstable across deploys —
   never use them in selectors. Prefer aria-labels, data attributes, and tr-/q- utility combos.
5. Small-font typography variants therapists asked us NOT to shrink:
   `Body.Small.*`, `Body.ExtraSmall`, anything already `!tr-text-xs`.
