# Athelas Compact — Chrome extension

Chrome-extension packaging of `../athelas-appointments-compact.user.js`. Same features, same code: compact spacing on Appointments and Chart Note pages, jump-to-Flowsheet on load, and the Fix MET button.

## Why the odd manifest settings

- **`"world": "MAIN"`** — the Fix-MET module reads `__reactFiber$…` keys off DOM nodes to reach the page's Tiptap editor instances. Those keys are invisible from the default isolated world, so the script runs in the page's own world, exactly like Tampermonkey did. Side benefit: the debug helpers (`window.__athelasFixMET`, `__athelasScanProcedures`, …) work from the normal DevTools console.
- **No `GM_addStyle` shim** — the script already falls back to `<style>` injection when `GM_addStyle` is undefined (see `applyCompactCss()`).
- **No permissions requested** — no storage, no background worker, no network. Content script only, on two `insights.athelas.com` URL patterns. Nothing is collected or transmitted.

## content.js is generated — don't hand-edit it

The userscript is the source of truth. To regenerate after changing it:

```bash
# from the repo root — keeps the 8-line banner, swaps in the fresh body
{ head -n 8 athelas-compact-extension/content.js; tail -n +12 athelas-appointments-compact.user.js; } > /tmp/c.js \
  && mv /tmp/c.js athelas-compact-extension/content.js
```

Then bump `version` in `manifest.json` to match the userscript `@version` (the test suite enforces this) and update the version in the banner.

## Local install / testing

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → pick this folder.
2. Open an Appointments page and a Chart Note; check the console for `[athelas:…]` logs.
3. **Disable the Tampermonkey userscript first** on any machine that has it — both active at once means doubled CSS and duplicated Fix-MET buttons.

## Releasing

See `../DEPLOYMENT.md` for the full Web Store + force-install guide. Short version: bump versions, run `npm test`, zip this folder's *contents* (manifest at zip root), upload in the developer dashboard.
