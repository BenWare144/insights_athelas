# Chrome Web Store listing — copy/paste sheet

Everything below is ready to paste into the Web Store dashboard fields. Adjust to taste.

---

## Item name (max 75 chars)
Athelas Insights Helper — Chart-Note Tools

## Summary / short description (max 132 chars — shows under the title)
One-click helpers for Athelas Insights. For authorized clinic use. Collects no data.

## Category
Productivity  (sub-category: Workflow & Planning)

## Language
English (United States)

---

## Detailed description (the big field)

Athelas Insights Helper streamlines documentation for physical-therapy clinicians working in Athelas Insights (insights.athelas.com). It runs only on Athelas Insights pages and makes no changes anywhere else.

Features:
• One click "Fix Procedures" button — reviews the interventions marked "Done" against the clinic's procedure rules and, with one click, moves any that are filed under the wrong CPT code to the correct one and appends the standard justification. Every change is shown in a confirmation dialog first, with a checkbox per change, so nothing happens without the clinician's approval.
• One click "Fix Private Pay" button — for self-pay visits, collects the interventions marked "Done" into the private-pay section, applying the same justifications, again after a review dialog.
• Jump to Flowsheet — on opening a chart note, scrolls straight to the Interventions flowsheet where clinicians do most of their work.
• Compact layout — tightens spacing on the Appointments and Chart Note pages so more of the flowsheet fits on screen, with no loss of information.

The extension is a display and workflow aid only. It does not collect, store, or transmit any data — all processing happens locally in the browser, and it requests no permissions. Intended for authorized clinic staff.

---

## Privacy tab answers

- Single purpose: "Adjusts spacing/layout and adds chart-note shortcuts on insights.athelas.com for authorized clinic users."

- Data usage — check NOTHING. The extension collects no user data. Certify the disclosures.
  - Also confirm: not sold to third parties; not used for purposes unrelated to the single purpose; not used to determine creditworthiness / lending.

- Host permission justification (REQUIRED — triggered by the content_scripts match pattern https://insights.athelas.com/*): "This extension runs only on Athelas Insights (insights.athelas.com), the physical-therapy EHR that clinic staff use for charting. The single host match pattern https://insights.athelas.com/* is required so the content script can load on the Appointments and Chart Note pages and provide its only functions: one-click chart-note helpers (Fix Procedures and Fix Private Pay, each gated behind a per-change review dialog), a jump-to-Flowsheet scroll on note open, and minor layout tightening. It matches all paths under that host because chart notes and appointment views are served under many different URL paths within the app. The extension requests no other host access and no API permissions. All processing happens locally in the browser; it collects, stores, and transmits no data. The host access is used solely to fulfill the extension's single purpose for authorized clinic staff."

- Are you using remote code? → No, I am not using remote code. (All JS is bundled in content.js; no external <script> src, no CDN, no eval. The Justification field under this question stays blank — it only applies if you answer Yes.)

- API permission justification: none required — the manifest declares no "permissions" (no storage, tabs, scripting, etc.). Only the host match pattern above needs justifying.

- Privacy policy URL: <paste the hosted URL of privacy-policy.html>

---

## Distribution
Visibility: **Unlisted**  (installable by link/ID, hidden from search, auto-updates)

---

## Notes
- The publisher/developer name shown on the listing comes from your Web Store account (Lake Region Consulting) — it is separate from the item name above.
- The 32-char extension ID is assigned on first publish and never changes; that ID is what clinic IT uses to force-install (see DEPLOYMENT.md, Part D).
