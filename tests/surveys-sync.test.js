// The functional-outcome SURVEYS config lives in three places:
//   1. surveys/survey-scoring.js                     (canonical, exported, tested)
//   2. userscript/athelas-insights-helper.user.js    (Surveys mirror near the boot)
//   3. athelas-insights-helper-extension/content.js  (generated copy of 2)
// This test fails if the SURVEYS array drifts between them. Comparison is
// comment- and whitespace-insensitive.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FILES = {
    canonical: 'surveys/survey-scoring.js',
    userscript: 'userscript/athelas-insights-helper.user.js',
    extension: 'athelas-insights-helper-extension/content.js',
};

const norm = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, '');
function surveysArray(rel) {
    const t = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const i = t.indexOf('const SURVEYS = [');
    assert.ok(i >= 0, `SURVEYS array not found in ${rel}`);
    const j = t.indexOf('];', i);
    assert.ok(j > i, `unterminated SURVEYS array in ${rel}`);
    return norm(t.slice(i, j));
}

test('SURVEYS config is identical across canonical, userscript, and content.js', () => {
    const canonical = surveysArray(FILES.canonical);
    assert.equal(surveysArray(FILES.userscript), canonical, 'userscript SURVEYS drifted from canonical');
    assert.equal(surveysArray(FILES.extension), canonical, 'content.js SURVEYS drifted from userscript — regenerate');
});
