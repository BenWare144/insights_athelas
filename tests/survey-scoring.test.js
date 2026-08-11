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
  ['Modified Oswestry', { 'Score %': 46, 'Score': 23 },                   'Modified Oswestry score of 46% disability'],
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

// Real target-state mapping (therapist tables). Values are the captured ones.
const TARGETS = [
  ['DHI',               { 'DHI Total Score': 60 },            'Patient will have a DHI score of 34/100 for improved QOL.'],
  ['Modified Oswestry', { 'Score %': 46, 'Score': 23 },       'Patient will have a Modified Oswestry score of 20% disability for improved QOL.'],
  ['NDI',               { 'Score %': 42, 'Score': 21 },       'Patient will have a NDI score of 10/50 (20% disability) for improved QOL.'],
  ['LEFS',              { 'Score %': 42.5, 'Score': 34 },     'Patient will have a LEFS score of >60/80 (>75% of full function) for improved QOL.'],
  ['QuickDASH',         { 'Score %': 22.7 },                  'Patient will have a QuickDASH score of <10/100 for improved QOL.'],
  ['KOS-ADLS',          { 'Total Score': 62.9 },              'Patient will have a KOS-ADLS score of >86% of full function for improved QOL.'],
];

test('computeTargetState: maps captured scores to the therapist target tables', () => {
  for (const [key, pairs, expected] of TARGETS) {
    assert.equal(S.computeTargetState(key, pairs), expected, `${key} target`);
  }
  assert.equal(S.computeTargetState('LEFS', {}), '');   // no score yet -> empty
});

test('computeTargetState: table boundaries and directions', () => {
  const tok = (k, p) => S.computeTargetState(k, p).match(/score of (\S+)/)[1];
  // QuickDASH (lower better): 28->,27->,17->
  assert.equal(tok('QuickDASH', { 'Score %': 28 }), '<20/100');
  assert.equal(tok('QuickDASH', { 'Score %': 27 }), '<10/100');
  assert.equal(tok('QuickDASH', { 'Score %': 17 }), '<5/100');
  // LEFS (higher better, raw /80): 62->79, 52->70, 51->>60
  assert.equal(tok('LEFS', { 'Score': 62 }), '79/80');
  assert.equal(tok('LEFS', { 'Score': 52 }), '70/80');
  assert.equal(tok('LEFS', { 'Score': 51 }), '>60/80');
  // Oswestry/NDI (lower better, raw /50): 40->30, 30->20, 20->10, 10->5, 9->0.
  // NDI shows raw+%, Oswestry shows % only (per the app's established formats).
  assert.equal(tok('Modified Oswestry', { 'Score': 40 }), '60%');   // raw 30 -> 60%
  assert.equal(tok('NDI', { 'Score': 9 }), '0/50');
  // DHI (lower better, /100): 54->34, 53->16, 35-><6
  assert.equal(tok('DHI', { 'DHI Total Score': 54 }), '34/100');
  assert.equal(tok('DHI', { 'DHI Total Score': 53 }), '16/100');
  assert.equal(tok('DHI', { 'DHI Total Score': 35 }), '<6/100');
  // KOS (higher better): % converted to raw /70 then displayed as %.
  // raw>=65 ->70(100%); >=50 ->>68(>97%); >=40 ->>60(>86%); else >50(>71%)
  assert.equal(tok('KOS-ADLS', { 'Total Score': 100 }), '100%');   // raw 70
  assert.equal(tok('KOS-ADLS', { 'Total Score': 30 }), '>71%');    // raw 21 -> >50
});

test('isInitialEvalValue: gate on note type, default present when unknown', () => {
  assert.equal(S.isInitialEvalValue('Initial Evaluation'), true);
  assert.equal(S.isInitialEvalValue('Re-Evaluation'), true);
  assert.equal(S.isInitialEvalValue('Daily Note'), false);
  assert.equal(S.isInitialEvalValue('Progress Note'), false);
  assert.equal(S.isInitialEvalValue(''), true);       // can't tell -> present
  assert.equal(S.isInitialEvalValue(null), true);
});
