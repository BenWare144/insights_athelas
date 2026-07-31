// The procedure-matching table lives in three places (see AGENTS.md):
//   1. matching/procedure-matching.js          (canonical)
//   2. userscript/athelas-insights-helper.user.js    (shared `Proc` engine near the top)
//   3. athelas-insights-helper-extension/content.js    (generated copy of 2)
// This test fails if they drift. Comparison is comment- and whitespace-
// insensitive, so formatting (one-line vs wrapped entries, inline comments)
// may differ between copies as long as the rules themselves are identical.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FILES = {
    canonical: 'matching/procedure-matching.js',
    userscript: 'userscript/athelas-insights-helper.user.js',
    extension: 'athelas-insights-helper-extension/content.js',
};

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// Extract the RULES array, drop // comments, then strip all whitespace so the
// result is a normalized signature of the rules (order included).
function extractRules(src, rel) {
    const start = src.search(/const RULES = \[/);
    assert.notEqual(start, -1, `${rel}: no RULES table found`);
    const end = src.indexOf('];', start);
    assert.notEqual(end, -1, `${rel}: RULES not terminated`);
    return src.slice(start, end)
        .replace(/\/\/[^\n]*/g, '')   // strip line comments
        .replace(/\s+/g, '');         // strip all whitespace
}

// Extract the shared-justification map J as key -> value-source pairs.
function extractJ(src, rel) {
    const start = src.search(/const J = \{/);
    assert.notEqual(start, -1, `${rel}: no J map found`);
    const end = src.indexOf('};', start);
    const pairs = {};
    const re = /(\w+):\s*(null|'(?:[^'\\]|\\.)*')/g;
    let m;
    while ((m = re.exec(src.slice(start, end))) !== null) pairs[m[1]] = m[2];
    return pairs;
}

const srcs = Object.fromEntries(Object.entries(FILES).map(([k, rel]) => [k, read(rel)]));

test('RULES table is identical (rules + order) across all three copies', () => {
    const canonical = extractRules(srcs.canonical, FILES.canonical);
    assert.ok(canonical.length > 500, 'canonical RULES table unexpectedly small');
    for (const key of ['userscript', 'extension']) {
        assert.equal(extractRules(srcs[key], FILES[key]), canonical,
            `${FILES[key]} RULES table drifted from ${FILES.canonical} — sync per AGENTS.md`);
    }
});

test('J justification map is identical across all three copies', () => {
    const canonical = extractJ(srcs.canonical, FILES.canonical);
    assert.ok(Object.keys(canonical).length >= 9, 'canonical J map unexpectedly small');
    for (const key of ['userscript', 'extension']) {
        assert.deepEqual(extractJ(srcs[key], FILES[key]), canonical,
            `${FILES[key]} J map drifted from ${FILES.canonical}`);
    }
});

test('normProc normalization chain is present verbatim in all three copies', () => {
    const chain = `.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\\s+/g, ' ').trim()`
        .replace(/\s+/g, '');
    for (const [key, rel] of Object.entries(FILES)) {
        assert.ok(srcs[key].replace(/\s+/g, '').includes(chain),
            `${rel}: normProc chain missing or drifted`);
    }
});
