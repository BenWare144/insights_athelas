// Source-level guards for three findings from the Codex review of PR #1 (2026-10-13),
// fixed in 15.25.7. Each can only be exercised for real on the live site.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'userscript', 'athelas-insights-helper.user.js'), 'utf8');
function between(from, to) {
    const a = src.indexOf(from);
    assert.ok(a >= 0, `marker not found: ${from}`);
    const b = src.indexOf(to, a);
    assert.ok(b > a, `end marker not found: ${to}`);
    return src.slice(a, b);
}

test('Fix Plan of Care stops before the derived fields when the duration does not stick', () => {
    const body = between('async function applyTarget(p) {', '// Put every field back exactly as we found it.');
    const check = body.indexOf("numOf(field('duration')) !== p.target");
    const bail = body.indexOf("reason: 'duration-did-not-take'");
    const endDate = body.indexOf("field('end_date')");
    assert.ok(check > 0 && bail > check, 'must check the duration and bail out');
    assert.ok(endDate > bail, 'end date / visit count must only be written after the duration is confirmed');
});

test('the status bus also hears form edits (checkbox ticks, typing)', () => {
    const bus = between('const athStatusBus = (function () {', '})();');
    assert.match(bus, /addEventListener\('input'/, 'input events must schedule a refresh');
    assert.match(bus, /addEventListener\('change'/, 'change events (Done checkboxes) must schedule a refresh');
    assert.doesNotMatch(bus, /setInterval/, 'still no polling');
});

test('Fix Procedures keeps each reviewed fix tied to its own item', () => {
    const flow = between('function listFixes() {', 'function findFlowsheetHeaderRow()');
    assert.match(flow, /fix\.ordinal = /, 'fixes record which same-named item they came from');
    assert.match(flow, /function findItemForFix\(code, f\)/);
    assert.match(flow, /f\.decision = decisions\[i\]/, 'review decisions are paired by position, not by name');
    assert.doesNotMatch(flow, /byName\[f\.name\]/, 'a name-keyed lookup collapses duplicates');
    const perform = between('async function performFix() {', 'performFix END');
    assert.doesNotMatch(perform, /findItemInCardByName\(f\.from, f\.name\)/, 'the source item is found with findItemForFix');
});
