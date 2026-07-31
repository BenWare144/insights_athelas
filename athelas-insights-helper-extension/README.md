# Athelas Insights Helper — Chrome extension

Chrome-extension packaging of `../userscript/athelas-insights-helper.user.js`. Same features, same code: the one-click **Fix Procedures** and **Fix Private Pay** helpers (with a per-change review dialog), jump-to-Flowsheet on load, and a minor compact-layout pass in the background.

## Why the odd manifest settings

- **`"world": "MAIN"`** — the one-click fixers read `__reactFiber$…` keys off DOM nodes to reach the page's Tiptap editor instances. Those keys are invisible from the default isolated world, so the script runs in the page's own world, exactly like Tampermonkey did. Side benefit: the debug helpers (`window.__athelasFixProcedures`, `__athelasFixPrivatePay`, `__athelasScanProcedures`, …) work from the normal DevTools console.
- **No `GM_addStyle` shim** — the script already falls back to `<style>` injection when `GM_addStyle` is undefined (see `applyCompactCss()`).
- **No permissions requested** — no storage, no background worker, no network. Content script only, on two `insights.athelas.com` URL patterns. Nothing is collected or transmitted.

## content.js is generated — don't hand-edit it

The userscript is the source of truth. To regenerate after changing it:

```bash
# from the repo root — keeps the 8-line banner, swaps in the fresh body
{ head -n 8 athelas-insights-helper-extension/content.js; tail -n +13 userscript/athelas-insights-helper.user.js; } > /tmp/c.js \
  && mv /tmp/c.js athelas-insights-helper-extension/content.js
```

Then bump `version` in `manifest.json` to match the userscript `@version` (the test suite enforces this) and update the version in the banner.

## Local install / testing

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → pick this folder.
2. Open an Appointments page and a Chart Note; check the console for `[athelas:…]` logs.
3. **Disable the Tampermonkey userscript first** on any machine that has it — both active at once means doubled CSS and duplicated helper buttons.

## Releasing

See `../DEPLOYMENT.md` for the full Web Store + force-install guide. Short version: bump versions, run `npm test`, zip this folder's *contents* (manifest at zip root), upload in the developer dashboard.
