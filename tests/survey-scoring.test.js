// Unit tests for the canonical survey-scoring engine.
// Values below are the real ones parsed from the [patient] initial-eval
// capture (captures/…_forms_filled_out.mhtml). Run: npm test (Node >= 20).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const S = require(path.join(__dirname, '..', 'surveys', 'survey-scoring.js'));

test('SURVEYS: six surveys with the confirmed autocomplete text + families', () => {
  assert.equal(S.SURVEYS.length, 6);
  assert.equal(S.byKey('KOS-ADLS').auto, 'KOS - Activities of Daily Living');
  assert.equal(S.byKey('NDI').auto, 'Neck Disability Index [NDI]');
  // function-family (higher = better) vs disability-family (higher = worse)
  assert.equal(S.byKey('LEFS').family, 'function');
  assert.equal(S.byKey('KOS-ADLS').family, 'function');
  for (const k of ['DHI', 'Modified Oswestry', 'NDI', 'QuickDASH']) {
    assert.equal(S.byKey(k).family, 'disability');
  }
});

test('parseScoreText: pulls "Label: number" pairs from a Scores region', () => {
  assert.deepEqual(S.parseScoreText('Score %: 42.0 +0.0 Score: 21.0'), { 'Score %': 42, 'Score': 21 });
  assert.deepEqual(S.parseScoreText('DHI Total Score: 60.0 +0.0 Emotional Score: 16.0'),
    { 'DHI Total Score': 60, 'Emotional Score': 16 });
  assert.deepEqual(S.parseScoreText('Total Score: 62.9 check'), { 'Total Score': 62.9 });
});

// Real parsed values -> the exact initial-state string we agreed on.
const CASES = [
  ['DHI',               { 'DHI Total Score': 60, 'Emotional Score': 16 }, 'DHI score of 60/100'],
  ['Modified Oswestry', { 'Score %': 46 },                                'Modified Oswestry score of 46% disability'],
  ['NDI',               { 'Score %': 42, 'Score': 21 },                   'NDI score of 21/50 (42% disability)'],
  ['LEFS',              { 'Score %': 42.5, 'Score': 34 },                 'LEFS score of 34/80 (42.5% of full function)'],
  ['QuickDASH',         { 'Score %': 22.7 },                              'QuickDASH score of 22.7/100'],
  ['KOS-ADLS',          { 'Total Score': 62.9 },                          'KOS-ADLS score of 62.9% of full function'],
];

test('initialStateText: family-aware labels match the agreed format', () => {
  for (const [key, pairs, expected] of CASES) {
    assert.equal(S.initialStateText(key, pairs), expected, `${key} label`);
  }
});

test('initialStateText: trailing .0 dropped, real decimals kept', () => {
  assert.equal(S.fmtNum(60.0), '60');
  assert.equal(S.fmtNum(42.5), '42.5');
  assert.equal(S.initialStateText('LEFS', { 'Score %': 42.0, 'Score': 34.0 }),
    'LEFS score of 34/80 (42% of full function)');
});

test('goalTitle: "<key> score"', () => {
  assert.equal(S.goalTitle('LEFS'), 'LEFS score');
  assert.equal(S.goalTitle('Modified Oswestry'), 'Modified Oswestry score');
  assert.equal(S.goalTitle('KOS-ADLS'), 'KOS-ADLS score');
});

test('computeTargetState: family-aware stub points the right direction', () => {
  assert.match(S.computeTargetState('LEFS', { 'Score %': 42.5 }), /improved function/);
  assert.match(S.computeTargetState('NDI', { 'Score %': 42 }), /reduced disability/);
  assert.match(S.computeTargetState('LEFS', {}), /\[TARGET TBD\]/);   // still a stub
});

test('isInitialEvalValue: gate on note type, default present when unknown', () => {
  assert.equal(S.isInitialEvalValue('Initial Evaluation'), true);
  assert.equal(S.isInitialEvalValue('Re-Evaluation'), true);
  assert.equal(S.isInitialEvalValue('Daily Note'), false);
  assert.equal(S.isInitialEvalValue('Progress Note'), false);
  assert.equal(S.isInitialEvalValue(''), true);       // can't tell -> present
  assert.equal(S.isInitialEvalValue(null), true);
});
