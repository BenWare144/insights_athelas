// ICD-10 7th-character logic behind Fix Diagnosis (S sequela -> D subsequent).
// Billing-critical: a false positive rewrites a code that was already right, a
// false negative leaves a denial on the note.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bare, episode, subsequentOf } = require('../matching/diagnosis-codes.js');

test('bare: strips the decimal point and upper-cases', () => {
    assert.equal(bare('S52.301S'), 'S52301S');
    assert.equal(bare('s52.301s'), 'S52301S');
    assert.equal(bare('M25.571'), 'M25571');
    assert.equal(bare(''), '');
    assert.equal(bare(null), '');
});

test('episode: only 7-character codes carry an indicator', () => {
    assert.equal(episode('S52.301S'), 'S');
    assert.equal(episode('S52.301A'), 'A');
    assert.equal(episode('S52.301D'), 'D');
    assert.equal(episode('M25.571'), '');    // 6 chars — no episode indicator
    assert.equal(episode('R26.2'), '');      // 4 chars
    // X placeholders count toward the seven: S13.4XXA is S134XXA.
    assert.equal(episode('S13.4XXA'), 'A');
});

test('subsequentOf: rewrites S -> D and leaves everything else alone', () => {
    assert.equal(subsequentOf('S52.301S'), 'S52.301D');
    assert.equal(subsequentOf('S82.101S'), 'S82.101D');
    assert.equal(subsequentOf('s52.301s'), 's52.301D', 'the decimal point and case of the stem are preserved verbatim');
    assert.equal(subsequentOf('S52.301A'), null, 'initial encounter is not our business');
    assert.equal(subsequentOf('S52.301D'), null, 'already subsequent');
    assert.equal(subsequentOf('S52.301K'), null, 'other fracture-healing indicators are left alone');
});

test('subsequentOf: codes ENDING in S that are not 7 characters are untouched', () => {
    // The trap this guards: a naive /S$/ test would rewrite these.
    assert.equal(subsequentOf('M25.57S'), null);   // 6 chars
    assert.equal(subsequentOf('R26.S'), null);     // 4 chars
    // ...while X-placeholder codes DO reach seven and are in scope.
    assert.equal(subsequentOf('S13.4XXS'), 'S13.4XXD');
});

test('S -> D is idempotent: the rewritten code no longer matches', () => {
    const once = subsequentOf('S52.301S');
    assert.equal(subsequentOf(once), null);
});
