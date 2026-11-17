// Guards for the Nov 2026 site move (insights.athelas.com -> air.athelas.com), fixed in 15.25.8.
// The helper stopped loading entirely because its only @match named the old host.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'userscript', 'athelas-insights-helper.user.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'athelas-insights-helper-extension', 'manifest.json'), 'utf8'));

const header = src.slice(0, src.indexOf('// ==/UserScript=='));
const body = src.slice(src.indexOf('// ==/UserScript=='));
const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');   // comments may name the hosts; code may not

function between(from, to) {
    const a = src.indexOf(from);
    assert.ok(a >= 0, `marker not found: ${from}`);
    const b = src.indexOf(to, a);
    assert.ok(b > a, `end marker not found: ${to}`);
    return src.slice(a, b);
}

test('the helper loads on the current host and on the old one', () => {
    const matches = [...header.matchAll(/^\/\/ @match\s+(.+)$/gm)].map((m) => m[1].trim());
    assert.ok(matches.includes('https://air.athelas.com/*'), 'air.athelas.com is where the app lives now');
    assert.ok(matches.includes('https://insights.athelas.com/*'), 'the old host only redirects today, but a rollback must not break the helper again');
    assert.deepEqual([...manifest.content_scripts[0].matches].sort(), [...matches].sort());
    for (const m of matches) assert.match(m, /^https:\/\/[a-z]+\.athelas\.com\/\*$/, 'one named host per pattern - no wildcard subdomain');
});

test('@namespace is unchanged, so Tampermonkey updates the installed script instead of adding a second one', () => {
    assert.match(header, /^\/\/ @namespace\s+https:\/\/insights\.athelas\.com\/$/m);
});

test('no code depends on the hostname', () => {
    assert.doesNotMatch(code, /athelas\.com/, 'routes are matched by pathname only; a host in code is the next breakage');
    assert.doesNotMatch(code, /location\.(host|hostname|origin)\b/);
});

test('the scribe side panel is not mistaken for the note', () => {
    assert.match(src, /function athInAside\(el\) \{[^}]*\[data-slot="app-shell-aside"\]/, 'one shared test for "inside the side panel"');
    const measure = between('function compactMeasure() {', 'async function compactSelfCheck(log)');
    assert.match(measure, /if \(athInAside\(e\)\) continue;/, 'the compact self-check measures the note, not the panel beside it');
    const goals = between('const goalsSection = ', '\n');
    assert.match(goals, /querySelectorAll\('\[data-section="goals"\]'\)/);
    assert.match(goals, /!athInAside\(e\)/, 'the side panel has a goals block of its own');
});
