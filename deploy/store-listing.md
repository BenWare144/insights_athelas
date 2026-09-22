# Chrome Web Store listing — copy/paste sheet

Everything below is ready to paste into the Web Store dashboard fields. Adjust to taste.

**Current release: v15.25.0** — zip at `deploy/athelas-insights-helper-v15.25.0.zip` (contents of `athelas-insights-helper-extension/`, `manifest.json` at the zip root).

> ⚠ **Before submitting, read "Local storage — read this before you certify the privacy disclosures" near the bottom.** Since the last submission the extension began storing chart-note identifiers in the browser's local storage, which the currently-hosted privacy policy does not describe. `deploy/privacy-policy.html` has been updated to match; **the hosted copy must be re-uploaded before you submit**, or the listing and the policy will disagree.

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

Every change it makes is shown to the clinician for approval before it happens, and any individual feature can be switched off.

Features:
• One click "Fix Procedures" button — reviews the interventions marked "Done" against the clinic's procedure rules and, with one click, moves any that are filed under the wrong billing code to the correct one and appends the standard justification. It also catches interventions filed under a code the clinic is not reimbursed for and moves them somewhere appropriate. Every change is shown in a confirmation dialog first, with a checkbox per change, so nothing happens without the clinician's approval.
• NEW — One click "Fix Diagnosis" button — on a follow-up visit, corrects a diagnosis code that still carries the initial-injury episode indicator so it reflects a subsequent encounter, a common cause of held claims. The corrected code is added and confirmed to be present before the old one is removed, so a note is never left without a diagnosis; if the corrected code cannot be found, the original is left untouched. Shown in a review dialog first.
• NEW — One click "Fix Plan of Care" button — on an evaluation, sets the plan duration to the clinic's full certification window, so a plan does not expire early because the note recorded only what the clinician told the patient they would start with. On a note's first open this is applied for the clinician with an Undo; otherwise it is a click. It only ever lengthens a plan, never shortens one, and never changes visit frequency.
• NEW — Pre-signature warnings — directly above the signature block, a warning appears for either of the two documentation problems that lead to a claim being held or paid at zero. Clicking one jumps to the section that fixes it. The warnings exist only while the problem does and disappear once it is resolved. They never change anything themselves.
• NEW — Button status colours — each helper button is red when clicking it would change something and green when that part of the note is already correct, so a clinician can see at a glance whether a note needs attention.
• One click "Fix Private Pay" button — for self-pay visits, collects the interventions marked "Done" into the private-pay section, applying the same justifications, again after a review dialog.
• Functional-outcome survey quick-add — on an initial evaluation, a one-click panel adds the clinic's most-used self-report outcome surveys to the Functional Outcomes section, replacing the fiddly hover-and-type step.
• Create goal from outcome score — once a survey is scored, one click drafts a matching goal — title, target date pulled from the Plan of Care end date, and the initial and target states filled from the score — shown in an editable review dialog (with a reminder of what the score means) before anything is entered.
• Calendar helpers — adds an "Open Note" button directly on each checked-in appointment so clinicians don't have to hover to find it, and keeps the appointment hover popup from opening off-screen.
• Jump to Flowsheet — on opening a chart note, scrolls straight to the Interventions flowsheet where clinicians do most of their work.
• Compact layout — tightens spacing on the Appointments and Chart Note pages so more of the flowsheet fits on screen, with no loss of information.
• Extension Settings — an in-page panel to turn any individual feature on or off, with a master switch, so a site change that affects one feature never forces disabling the rest.

The extension is a display and workflow aid only. It makes no network requests, contacts no servers, and requests no browser permissions — all processing happens locally in the browser. It remembers your feature settings, your professional credential, and which notes it has already offered its plan-of-care default on, using your browser's own local storage; none of this is ever transmitted anywhere. Intended for authorized clinic staff.

Recent updates:
• v15.25 — When the documentation says a task simulates or replicates a functional activity, the intervention is filed under the matching activity code.
• v15.24 — The plan-of-care duration fix now applies itself the first time an evaluation opens, with an Undo, instead of waiting to be clicked. Once per note only.
• v15.23 — New "Fix Plan of Care" button on evaluations: lengthens a too-short plan to the full certification window.
• v15.22 — New "Fix Diagnosis" button for the episode-of-care character on follow-up visits; warnings above the signature block for the two problems that cause claims to be held; helper buttons now show red/green status; interventions filed under a non-reimbursed code are moved out.
• v15.21 — Settings panel: turn any individual feature on or off (with a master switch).
• v15.20 — Each survey shows a completion status button (red until scored, green when complete) that collapses the survey and drafts the goal; the goal dialog now has editable score numbers and a description of what the score means.
• v15.19 — Calendar: adds an "Open Note" button on checked-in appointments and keeps the appointment popup on-screen.
• v15.18 — Functional-outcome survey quick-add panel and one-click "Create goal from outcome score" on initial evaluations, both behind a review dialog.

---

## Privacy tab answers

- Single purpose: "Adds chart-note and calendar workflow shortcuts — correcting mis-filed billing and diagnosis codes, plan-of-care duration, and outcome-survey entry, each behind a review dialog — plus minor layout adjustments, on insights.athelas.com for authorized clinic users."

- Data usage — check NOTHING. The extension collects no user data: nothing is transmitted off the device, which is what the Web Store's "collect" means. (It does keep a few values in the browser's own local storage — see the local-storage section below. That is not collection, but make sure the hosted privacy policy describes it.)
  - Also confirm: not sold to third parties; not used for purposes unrelated to the single purpose; not used to determine creditworthiness / lending.

- Host permission justification (REQUIRED — triggered by the content_scripts match pattern https://insights.athelas.com/*): "This extension runs only on Athelas Insights (insights.athelas.com), the physical-therapy EHR that clinic staff use for charting. The single host match pattern https://insights.athelas.com/* is required so the content script can load on the Appointments and Chart Note pages and provide its only functions: one-click chart-note helpers that correct mis-filed billing codes, a diagnosis code's episode-of-care character, and an evaluation's plan-of-care duration (each gated behind a per-change review dialog); warnings above the signature block when either of two claim-blocking documentation problems is still present; adding functional-outcome surveys and drafting goals from their scores on initial evaluations (also behind a review dialog); calendar helpers (an Open Note shortcut on checked-in appointments); a jump-to-Flowsheet scroll on note open; and minor layout tightening. It matches all paths under that host because chart notes and appointment views are served under many different URL paths within the app. The extension requests no other host access and no API permissions. All processing happens locally in the browser; it makes no network requests and transmits no data. The host access is used solely to fulfill the extension's single purpose for authorized clinic staff."

- Are you using remote code? → No, I am not using remote code. (All JS is bundled in content.js; no external <script> src, no CDN, no eval. The Justification field under this question stays blank — it only applies if you answer Yes.)

- API permission justification: none required — the manifest declares no "permissions" (no storage, tabs, scripting, etc.). Only the host match pattern above needs justifying.

- Privacy policy URL: <paste the hosted URL of privacy-policy.html — **re-upload the updated file first**>

---

## Distribution
Visibility: **Unlisted**  (installable by link/ID, hidden from search, auto-updates)

---

## Local storage — read this before you certify the privacy disclosures

The extension runs in the MAIN world, so it cannot use `chrome.storage`; it uses the page's own `localStorage` instead. Three keys, all origin-scoped to insights.athelas.com, none ever transmitted:

| Key | Contents | Notes |
|---|---|---|
| `athelas-helper:features` | feature on/off flags | booleans only |
| `athelas-helper:me` | the signed-in clinician's credential + discipline (e.g. "DPT" / "PT") | no name |
| `athelas-helper:poc-seen` | up to 400 `patientId/appointmentId` pairs | **chart-note identifiers** — added in v15.24 so the plan-of-care default fires once per note |

**Why this matters for the listing:** the Web Store's "data collection" disclosure is about transmitting data *off the device*, and nothing here is transmitted — so checking nothing on the Data Usage tab is still correct. But the previously hosted privacy policy said the extension "does not collect, **store**, transmit, or share any data" and "stores nothing outside the current page", and the third key above makes that inaccurate. `deploy/privacy-policy.html` has been corrected; **re-host it before submitting** so the listing and the policy agree.

**Worth doing before a wider rollout:** `athelas-helper:poc-seen` is the only place the extension persists anything patient-linked. Storing a one-way hash of the note key instead of the raw ids would keep the once-per-note behaviour exactly as it is while persisting nothing patient-identifiable at all — a small change, and an easy question to answer if the clinic's compliance director asks what the extension keeps on a shared machine.

---

## Notes
- The publisher/developer name shown on the listing comes from your Web Store account (Lake Region Consulting) — it is separate from the item name above.
- **Item / extension ID: `lnacagncbpglinobghcdeadaodonpjdf`** — assigned on first publish, never changes; this is what clinic IT uses to force-install (see DEPLOYMENT.md, Part D).
- **Do NOT list codes or acronyms in the description.** The 2026-08-11 submission was rejected for "Keyword Spam" over a list of survey acronyms (DHI, LEFS, QuickDASH, …) — see `deploy/store-review/2026-08-11-rejection-keyword-spam.eml`. The same caution now applies to billing and diagnosis codes: describe them generically ("the wrong billing code", "the episode-of-care character") rather than enumerating 97110 / 97112 / 97530 / 97535 / 98960 or ICD-10 examples. The description above is written that way on purpose — keep it that way when you edit it.
- The screenshot on file (`deploy/store-screenshot-1280x800.png`) still shows the Fix Procedures review dialog. It is accurate but predates the diagnosis / plan-of-care / warning features; a refreshed one is optional, not required, for this update.
