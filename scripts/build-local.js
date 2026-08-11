// Generate a machine-local Tampermonkey build with a file:// auto-update URL, so
// updates can be pulled on this machine via Tampermonkey's "Check for userscript
// updates" — no GitHub push needed. Output is git-ignored (machine-specific path).
//
// One-time: install userscript/athelas-insights-helper.local.user.js into
// Tampermonkey, and enable "Allow access to file URLs" for the Tampermonkey
// extension (chrome://extensions → Tampermonkey → Details).
// Each update: bump the version as usual, run `npm run build:local`, then in
// Tampermonkey click "Check for userscript updates" (or wait for the auto-check).
//
// Run: npm run build:local
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'userscript', 'athelas-insights-helper.user.js');
const OUT = path.join(__dirname, '..', 'userscript', 'athelas-insights-helper.local.user.js');
// Windows file:// URL to OUT. Change this if the repo folder moves.
const URL = 'file:///C:/Users/Ben/Downloads/mom_ahk_script/insights_athelas/userscript/athelas-insights-helper.local.user.js';

let s = fs.readFileSync(SRC, 'utf8');
if (/@updateURL/.test(s)) { console.error('source userscript unexpectedly has @updateURL — aborting'); process.exit(1); }
s = s.replace(/(^\/\/ @version .*\n)/m, `$1// @updateURL    ${URL}\n// @downloadURL  ${URL}\n`);
fs.writeFileSync(OUT, s);
console.log('wrote', path.relative(process.cwd(), OUT), '(git-ignored; install once, then "Check for userscript updates")');
