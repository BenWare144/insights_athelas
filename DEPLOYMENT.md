# Deployment: unlisted Chrome Web Store → IT force-install

The plan: publish the extension **unlisted** on the Chrome Web Store (invisible in search, installable by link, auto-updates), then the clinic's IT force-installs it by extension ID on every therapist machine. Machines get it silently; therapists can't uninstall or disable it; your updates roll out automatically within hours.

## Part A — Prepare the package (once per release)

1. Run `npm test` — all green.
2. Confirm `manifest.json` version matches the userscript `@version` (test 1 enforces this).
3. Zip the **contents** of `athelas-compact-extension/` so `manifest.json` sits at the zip root (not inside a subfolder):
   - Windows: open the folder, select all files → right-click → *Compress to ZIP file*.
4. Prepare listing assets (first release only):
   - At least one **screenshot, 1280×800 or 640×400** — a chart note with compact mode on (blur/crop any patient names before uploading).
   - A short description. Suggested: "Display tweaks for Athelas Insights: compact spacing on Appointments and Chart Note pages, plus one-click chart-note helpers. For authorized clinic use. Collects and transmits no data."
   - A **privacy policy URL** — required even for no-data extensions. A one-page statement ("This extension does not collect, store, or transmit any data. All processing happens locally in the browser.") hosted anywhere public works; a GitHub Pages page or public Gist is fine.

## Part B — Developer account (once ever)

1. Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) with a Google account you'll keep long-term (consider a dedicated one, e.g. `athelascompact@gmail.com` — the account owns the listing, and migrating later is painful).
2. Pay the **$5 one-time** registration fee.
3. In *Account* settings: verify your contact email (required before you can publish).

## Part C — Publish unlisted (first release)

1. Dashboard → **+ New item** → upload the zip.
2. **Store listing** tab: name, description, category (*Productivity* → *Workflow & Planning* fits), icon (auto-pulled from manifest), screenshot.
3. **Privacy** tab:
   - Single purpose: "Adjusts spacing/layout and adds chart-note shortcuts on insights.athelas.com for authorized clinic users."
   - Data usage: check **nothing** (no data collected). Certify the disclosures.
   - Privacy policy URL from Part A.
   - There are no permissions to justify — the extension requests none. This makes review fast and rejection unlikely.
4. **Distribution** tab: Visibility = **Unlisted**.
5. **Submit for review.** Typically hours to a few days for a permission-free extension. You'll get an email either way; rejections state a reason and you resubmit after fixing.
6. Once published, grab two things from the dashboard/store URL:
   - the **item link** (`https://chromewebstore.google.com/detail/…/<32-char-id>`) — anyone with it can install;
   - the **extension ID** (the 32-char string) — this is what IT needs. It never changes across updates.

## Part D — Clinic rollout (IT does this; send them this section)

How to force-install depends on how the clinic's machines are managed. All three paths use the same extension ID and pull from the Web Store, so auto-update works in every case.

**D1. Google Workspace / managed Chrome profiles** (therapists sign into Chrome with clinic accounts):

1. [admin.google.com](https://admin.google.com) → *Devices → Chrome → Apps & extensions → Users & browsers*.
2. Select the target OU → **+** → *Add Chrome app or extension by ID* → paste the extension ID (unlisted items must be added by ID; they won't appear in search).
3. Set installation policy to **Force install**. Done — applies at next policy sync (minutes).

**D2. Machines not domain-joined, no Workspace** (typical small practice): use **Chrome Enterprise Core** (browser cloud management — free):

1. IT creates a free account at admin.google.com, goes to *Chrome browser → Managed browsers*, and generates an **enrollment token**.
2. On each machine, drop the token into the registry (`HKLM\SOFTWARE\Policies\Google\Chrome\CloudManagementEnrollmentToken`) — one-time, scriptable.
3. Browsers appear in the console; force-install exactly as in D1.

This path exists because Chrome **ignores** `ExtensionInstallForcelist` set via local registry on machines that aren't AD-domain-joined or cloud-enrolled (anti-malware measure) — so plain registry edits alone won't work on standalone PCs.

**D3. Active Directory domain-joined machines**: classic GPO:

1. Install Google's Chrome ADMX templates.
2. Policy: *Google Chrome → Extensions → Configure the list of force-installed apps and extensions* → add:
   `<extension-id>;https://clients2.google.com/service/update2/crx`
3. `gpupdate` and restart Chrome.

Verification on any machine: `chrome://extensions` shows the extension with "Installed by your administrator"; `chrome://policy` shows `ExtensionInstallForcelist`.

**Before rollout:** anyone who piloted the Tampermonkey userscript must disable it (both running = doubled CSS and duplicate Fix-MET buttons).

## Part E — Shipping an update

1. Edit the userscript → regenerate `content.js` (command in `athelas-compact-extension/README.md`) → bump `@version`, `manifest.json`, `package.json` → `npm test` → update `CHANGELOG.md`.
2. Zip and upload as a new package on the existing dashboard item → submit.
3. After approval, Chrome updates deployed machines automatically (checks run every few hours; `chrome://extensions` → *Update* forces it). No IT action needed.

## Business/compliance notes (not legal advice)

- The extension collects and transmits nothing — keep it that way; it's the basis of the privacy disclosures and the clinic's easiest compliance answer. Any future feature that sends data anywhere (even analytics) changes the Web Store disclosures and likely triggers the clinic's HIPAA review.
- Get the clinic's (and ideally Athelas's) written OK before clinic-wide deployment; a paid arrangement should include ongoing maintenance, since Athelas UI changes will break selectors periodically (see git history).
