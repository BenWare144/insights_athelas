// Source-level guards on the goal-from-score form driver (userscript MODULE 13).
// The form can only be exercised for real on the live site, so these pin the two
// properties that have already gone wrong once each - see DECISIONS.md
// "Goal form: title is a textarea" and "Goal form fills are dialog-scoped".
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

test('goal form fields are matched by name on <input> AND <textarea>', () => {
    // Athelas turned the Goal Title from an <input> into a multiline <textarea>;
    // an input-only selector then found nothing and the dialog was left empty.
    const def = between('const goalFieldSel =', '\n');
    assert.match(def, /input\[name="/, 'goalFieldSel must match <input name=…>');
    assert.match(def, /textarea\[name="/, 'goalFieldSel must match <textarea name=…>');
    const driver = between('function findAddChip(', 'async function runGoal(').replace(/^\s*\/\/.*$/gm, '');   // code only
    assert.doesNotMatch(driver, /['"`]input\[name="(name|due_date|initial_value|end_goal_value)"\]['"`]/,
        'look goal fields up through goalFieldSel(), not an input-only selector');
});

test('createGoal never looks a field up page-wide', () => {
    // Every existing goal card has its own initial_value / end_goal_value inputs,
    // so a document-level fallback would overwrite the first existing goal.
    const body = between('async function createGoal(', 'async function runGoal(');
    assert.doesNotMatch(body, /document\.querySelector/, 'scope every lookup to the open dialog (`form`)');
    assert.match(body, /const form = goalDialogOf\(title\);/, 'the fill scope must be the dialog that owns the Goal Title');
    const chip = between('function findAddChip(', '\n        }');
    assert.doesNotMatch(chip, /document\.querySelector/, 'add-chips must come from the open dialog only');
});

test('createGoal submits only after re-reading every field it filled', () => {
    const body = between('async function createGoal(', 'async function runGoal(');
    const check = body.indexOf('const missed =');
    const bail = body.indexOf('if (missed.length)');
    const click = body.indexOf('simulateClick(submit');
    assert.ok(check >= 0 && bail > check, 'createGoal must compute `missed` and bail on it');
    assert.ok(click > bail, 'the Create Goal click must come after the completeness check');
});
