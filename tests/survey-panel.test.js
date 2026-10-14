// Source-level guard on the survey quick-add panel (userscript MODULE 12). Since the
// Oct 2026 site update, Functional Outcomes sits inside a collapsible "Objective" group;
// when that group is collapsed the panel must not vanish with it. See DECISIONS.md
// "Chart-note groups (Oct 2026)".
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

test('the quick-add panel follows a collapsed group into its header', () => {
    const body = between('function injectPanel()', '// (The old bottom "collapse survey" button');
    assert.match(body, /g\.collapsed\(\)[\s\S]*?g\.header\.appendChild/, 'when the group is collapsed the panel goes in the group header');
    assert.match(body, /fo\.insertBefore\((existing|panel), fo\.firstChild\)/, 'when it is open the panel lives at the top of Functional Outcomes');
});

test('a quick-add click opens the group before adding the survey', () => {
    const body = between('function injectPanel()', '// (The old bottom "collapse survey" button');
    const open = body.indexOf('await openFoGroup()');
    const add = body.indexOf('Surveys.addSurvey(');
    assert.ok(open > 0 && add > open, 'openFoGroup() must run before addSurvey(): a hidden input cannot be typed into');
});
