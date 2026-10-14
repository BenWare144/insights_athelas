# Chrome Web Store listing — copy/paste sheet

Everything below is ready to paste into the Web Store dashboard fields. Adjust to taste.

**Current release: v15.25.6** — zip at `deploy/athelas-insights-helper-v15.25.6.zip` (contents of `athelas-insights-helper-extension/`, `manifest.json` at the zip root).

> ⚠ **Before submitting, read "Local storage — read this before you certify the privacy disclosures" near the bottom.** Since v15.24 the extension stores chart-note identifiers in the browser's local storage, and since v15.25.5 it reads one optional developer flag; the currently-hosted privacy policy describes neither. `deploy/privacy-policy.html` has been updated to match; **the hosted copy must be re-uploaded before you submit**, or the listing and the policy will disagree.

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

_Paste everything between the rules below. Keep it under 3,000 characters — currently 2,966._

Athelas Insights Helper streamlines documentation for physical-therapy clinicians working in Athelas Insights (insights.athelas.com). It runs only on Athelas Insights pages. Every change it makes is shown for approval first, and any feature can be switched off.

Features:
• Fix Procedures — moves interventions marked "Done" that are filed under the wrong billing code to the correct one and appends the standard justification, including any filed under a code the clinic is not reimbursed for. Every change is listed in a confirmation dialog, with a checkbox each.
• Fix Diagnosis — on a follow-up visit, corrects a diagnosis code still carrying the initial-injury episode indicator, a common cause of held claims. The corrected code is added and confirmed present before the old one is removed.
• Fix Plan of Care — on an evaluation, sets the plan duration to the clinic's full certification window so it does not expire early. Applied with an Undo the first time a note opens, or on click. It only ever lengthens a plan and never changes visit frequency.
• Pre-signature warnings — above the signature block, a warning appears for a documentation problem that gets a claim held or paid at zero, and jumps to the section that fixes it.
• Status colours — each helper button is red when clicking it would change something, green when that part of the note is already correct.
• Fix Private Pay — for self-pay visits, collects the interventions marked "Done" into the private-pay section, after a review dialog.
• Outcome surveys — on an initial evaluation, one click adds the clinic's most-used self-report surveys; once one is scored, another drafts a matching goal (title, target date, initial and target states) in an editable dialog, and saves it only if every field was filled.
• Calendar — an "Open Note" button on each checked-in appointment, and the appointment hover popup kept on-screen.
• Jump to Flowsheet on opening a note, a compact layout that switches itself off if it ever stops fitting the page, and a settings panel to turn any feature on or off.

The extension is a display and workflow aid only. It makes no network requests, contacts no servers, and requests no browser permissions — all processing happens locally. It remembers your feature settings, your professional credential, and which notes it has already offered its plan-of-care default on, in your browser's own local storage; none of it is ever transmitted. Intended for authorized clinic staff.

Recent updates:
• v15.25.6 — Survey buttons stay in view in Athelas's new grouped note layout.
• v15.25.5 — Diagnostic messages no longer include chart values.
• v15.25.4 — Fix Procedures can again add a missing billing-code card, and says so if it cannot.
• v15.25.3 — Layout fixed for Athelas's new sidebar.
• v15.25.2 — Goal drafting works with Athelas's updated goal form.
• v15.25 — A task documented as simulating a functional activity is filed under the matching activity code.

---

## Privacy tab answers

- Single purpose: "Adds chart-note and calendar workflow shortcuts — correcting mis-filed billing and diagnosis codes, plan-of-care duration, and outcome-survey entry, each behind a review dialog — plus minor layout adjustments, on insights.athelas.com for authorized clinic users."

- Data usage — check NOTHING. The extension collects no user data: nothing is transmitted off the device, which is what the Web Store's "collect" means. (It does keep a few values in the browser's own local storage — see the local-storage section below. That is not collection, but make sure the hosted privacy policy describes it.)
  - Also confirm: not sold to third parties; not used for purposes unrelated to the single purpose; not used to determine creditworthiness / lending.

- Host permission justification (REQUIRED — triggered by the content_scripts match pattern `https://insights.athelas.com/*`). **Max 1,000 characters; the text below is 998 — check the count if you edit it.** Paste everything inside the quotes: "This extension runs only on Athelas Insights (insights.athelas.com), the physical-therapy EHR clinic staff use for charting. The single match pattern https://insights.athelas.com/* is required so the content script can load on the Appointments and Chart Note pages and provide its only functions: one-click helpers that correct mis-filed billing codes, a diagnosis code's episode-of-care character, and an evaluation's plan-of-care duration, each behind a review dialog; warnings above the signature block while a claim-blocking documentation problem remains; adding outcome surveys and drafting goals from their scores; an Open Note shortcut on checked-in appointments; a jump-to-Flowsheet scroll; and minor layout tightening. It matches all paths under that host because chart notes and appointments are served under many different paths in the app. No other host access and no API permissions are requested. All processing is local; the extension makes no network requests and transmits no data."

- Are you using remote code? → No, I am not using remote code. (All JS is bundled in content.js; no external <script> src, no CDN, no eval. The Justification field under this question stays blank — it only applies if you answer Yes.)

- API permission justification: none required — the manifest declares no "permissions" (no storage, tabs, scripting, etc.). Only the host match pattern above needs justifying.

- Privacy policy URL: <paste the hosted URL of privacy-policy.html — **re-upload the updated file first**>

---

## Distribution
Visibility: **Unlisted**  (installable by link/ID, hidden from search, auto-updates)

---

## Local storage — read this before you certify the privacy disclosures

The extension runs in the MAIN world, so it cannot use `chrome.storage`; it uses the page's own `localStorage` instead. Four keys, all origin-scoped to insights.athelas.com, none ever transmitted:

| Key | Contents | Notes |
|---|---|---|
| `athelas-helper:features` | feature on/off flags | booleans only |
| `athelas-helper:me` | the signed-in clinician's credential + discipline (e.g. "DPT" / "PT") | no name |
| `athelas-helper:poc-seen` | up to 400 `patientId/appointmentId` pairs | **chart-note identifiers** — added in v15.24 so the plan-of-care default fires once per note |
| `athelas-helper:log-values` | `"1"` or absent | **read only** — the extension never writes it. Set by hand (DevTools) to make the console logs include real field values for debugging; off by default since v15.25.5, when the logs stopped showing chart values |

**Why this matters for the listing:** the Web Store's "data collection" disclosure is about transmitting data *off the device*, and nothing here is transmitted — so checking nothing on the Data Usage tab is still correct. But the previously hosted privacy policy said the extension "does not collect, **store**, transmit, or share any data" and "stores nothing outside the current page", and the third key above makes that inaccurate. `deploy/privacy-policy.html` has been corrected; **re-host it before submitting** so the listing and the policy agree.

**Worth doing before a wider rollout:** `athelas-helper:poc-seen` is the only place the extension persists anything patient-linked. Storing a one-way hash of the note key instead of the raw ids would keep the once-per-note behaviour exactly as it is while persisting nothing patient-identifiable at all — a small change, and an easy question to answer if the clinic's compliance director asks what the extension keeps on a shared machine.

---

## Notes
- The publisher/developer name shown on the listing comes from your Web Store account (Lake Region Consulting) — it is separate from the item name above.
- **Item / extension ID: `lnacagncbpglinobghcdeadaodonpjdf`** — assigned on first publish, never changes; this is what clinic IT uses to force-install (see DEPLOYMENT.md, Part D).
- **Do NOT list codes or acronyms in the description.** The 2026-08-11 submission was rejected for "Keyword Spam" over a list of survey acronyms (DHI, LEFS, QuickDASH, …) — see `deploy/store-review/2026-08-11-rejection-keyword-spam.eml`. The same caution now applies to billing and diagnosis codes: describe them generically ("the wrong billing code", "the episode-of-care character") rather than enumerating 97110 / 97112 / 97530 / 97535 / 98960 or ICD-10 examples. The description above is written that way on purpose — keep it that way when you edit it.
- The screenshot on file (`deploy/store-screenshot-1280x800.png`) still shows the Fix Procedures review dialog. It is accurate but predates the diagnosis / plan-of-care / warning features; a refreshed one is optional, not required, for this update.
