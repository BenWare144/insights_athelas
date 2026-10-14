// Source-level guards on how Fix Procedures finds the controls it clicks to add a
// CPT card (userscript MODULE 9, ensureCard). These can only be exercised for real
// on the live site; the guards pin the lesson from DECISIONS.md "Never anchor on an
// attribute Athelas did not put there".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const userscript = fs.readFileSync(path.join(__dirname, '..', 'userscript', 'athelas-insights-helper.user.js'), 'utf8');

function between(from, to) {
    const a = userscript.indexOf(from);
    assert.ok(a >= 0, `marker not found: ${from}`);
    const b = userscript.indexOf(to, a);
    assert.ok(b > a, `end marker not found: ${to}`);
    return userscript.slice(a, b);
}
const code = (s) => s.replace(/^\s*\/\/.*$/gm, '');

test('ensureCard never depends on jf-ext-button-ct alone', () => {
    // That attribute mirrored each button's text until late July 2026 and has been on
    // no button since. Wherever it is used, a label-based fallback must follow.
    const body = code(between('async function ensureCard(', '// ---- full flow'));
    const uses = [...body.matchAll(/querySelector\('button\[jf-ext-button-ct[^']*'\)(\s*\|\|)?/g)];
    assert.ok(uses.length >= 2, 'expected the +CPT button and the "Add N CPT code" button lookups');
    for (const u of uses) assert.ok(u[1], 'a jf-ext-button-ct lookup with no fallback: ' + u[0]);
    assert.match(body, /athLabelText\(b\)\.toUpperCase\(\) === 'CPT'/, 'the +CPT button must be findable by its label');
    assert.match(body, /cpt codes\?\\b\/i\.test\(athLabelText\(b\)\)/, 'the "Add N CPT code" button must be findable by its label');
});

test('ensureCard reads button labels with athLabelText, not raw textContent', () => {
    // The "add" icon renders its name as text, so the +CPT button's textContent is
    // "addCPT". An exact textContent comparison can never match it.
    const body = code(between('async function ensureCard(', '// ---- full flow'));
    assert.doesNotMatch(body, /textContent[^;\n]*===\s*'CPT'/, 'compare the label (athLabelText), not textContent');
});

test('nothing else in the helper selects on jf-ext-button-ct', () => {
    const outside = code(userscript.replace(between('async function ensureCard(', '// ---- full flow'), ''));
    assert.doesNotMatch(outside, /\[jf-ext-button-ct/, 'jf-ext-button-ct is not an Athelas attribute; anchor on labels or data-section instead');
});
