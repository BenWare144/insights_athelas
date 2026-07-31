// Unit tests for the canonical procedure-matching engine.
// Run: npm test   (Node >= 20, zero dependencies)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { normProc, resolveProcedure, RULES, J } =
    require(path.join(__dirname, '..', 'matching', 'procedure-matching.js'));

test('normProc: lowercases, strips punctuation, collapses whitespace', () => {
    assert.equal(normProc('Sit-to-Stand'), 'sit to stand');
    assert.equal(normProc('  MET — CT Junction (FRS T1/T2)  '), 'met ct junction frs t1 t2');
    assert.equal(normProc('Single-Leg Balance - Left'), 'single leg balance left');
    assert.equal(normProc(''), '');
    assert.equal(normProc(null), '');
    assert.equal(normProc(undefined), '');
});

test('rule integrity: label, callable test, and code/exclude shape', () => {
    assert.ok(RULES.length >= 20, 'rule table unexpectedly small');
    const validCodes = new Set(['97110', '97112', '97530']);
    for (const r of RULES) {
        assert.ok(r.label && typeof r.label === 'string', `entry missing label: ${JSON.stringify(r)}`);
        assert.equal(typeof r.test, 'function', `test not a function on "${r.label}"`);
        if (r.exclude) {
            assert.equal(r.code, undefined, `exclude rule "${r.label}" must not carry a code`);
        } else {
            assert.match(r.code, /^\d{5}$/, `bad code on "${r.label}"`);
            assert.ok(validCodes.has(r.code), `unexpected CPT ${r.code} on "${r.label}"`);
            assert.ok(['append', 'replace', 'none'].includes(r.justMode), `bad justMode on "${r.label}"`);
        }
    }
});

// name -> expected outcome:
//   ['Label', 'CODE']   must resolve to that rule + CPT
//   'EXCLUDE'           must resolve to a leave-alone rule
//   null                must not match any rule
const CASES = [
    // MET family -> 97112 (word-boundary 'met' or 'muscle energy')
    ['MET',                                  ['MET', '97112']],
    ['MET for posteriorly subluxed rib',     ['MET', '97112']],
    ['MET to Superior Tib-Fib Joint',        ['MET', '97112']],
    ['Muscle Energy Technique - Lumbar',     ['MET', '97112']],
    ['MET - jhgkhjg',                        null],   // junk MET (single non-word token) is ignored
    ['Metronome walking',                    null],   // 'met' must be a whole word

    // balance family -> 97112 (broadened: any 'balance'/'tandem'/'airex'/'bosu')
    ['Tandem Stance, eyes open',             ['Balance', '97112']],
    ['Single-Leg Balance - Left',            ['Balance', '97112']],
    ['Single leg stance on Airex',           ['Balance', '97112']],

    // therapeutic activity -> 97530
    ['Sit to Stand',                         ['Sit to Stand', '97530']],
    ['Lateral step ups',                     ['Step up', '97530']],   // plural via substring
    ['Chair squat',                          ['Squat', '97530']],
    ['Mini Squats',                          ['Squat', '97530']],
    ['Forward lunges',                       ['Lunge', '97530']],
    ['TKE on Cable column',                  ['Cable column', '97530']],  // cable column beats the TKE-exclude

    // therapeutic exercise -> 97110
    ['Hip Internal Rotation PROM',           ['PROM', '97110']],
    ['Hamstring Stretch-supine',             ['Stretch', '97110']],

    // rename: Rib Mobilization -> "MET - Rib" (but NOT first rib)
    ['Rib Mobilization/Manipulation Right Ribs 1, 2, and 5', ['Rib -> MET - Rib', '97112']],
    ['First Rib Mobilization - Strap',       null],

    // therapist "leave alone" rules
    ['Squat - TKE',                          'EXCLUDE'],
    ['Supine Bridge',                        'EXCLUDE'],

    // non-canonical names must not match
    ['Leg Press',                            null],
    ['Stationary Bike',                      null],
    ['Patellar Mobilization - Left',         null],
];

test('resolveProcedure: known real-world names map to expected outcome', () => {
    for (const [name, expected] of CASES) {
        const r = resolveProcedure(name);
        if (expected === null) {
            assert.equal(r, null, `"${name}" should not match, got "${r && r.label}"`);
        } else if (expected === 'EXCLUDE') {
            assert.ok(r && r.exclude, `"${name}" should be left alone, got ${JSON.stringify(r)}`);
        } else {
            assert.ok(r && !r.exclude, `"${name}" matched nothing, expected "${expected[0]}"`);
            assert.equal(r.label, expected[0], `"${name}" matched wrong label`);
            assert.equal(r.code, expected[1], `"${name}" matched wrong code`);
        }
    }
});

test('first rule hit wins (Cable column outranks a later TKE-exclude / Squat)', () => {
    assert.equal(resolveProcedure('TKE on Cable column').code, '97530');
    assert.equal(resolveProcedure('MET squat tandem').label, 'MET');   // MET precedes Squat/Balance
});

test('justifications: append rules carry canonical text; MET is name-spliced', () => {
    assert.equal(resolveProcedure('Sit to Stand').justification, J.toilet);
    assert.equal(resolveProcedure('Lateral step ups').justification, J.stairs);
    assert.equal(resolveProcedure('Single-Leg Balance - Left').justification, J.gluteMed);
    assert.equal(resolveProcedure('Hamstring Stretch-supine').justification, null); // justMode 'none'
    assert.match(resolveProcedure('MET to Superior Tib-Fib Joint').justification,
        /^Muscle energy technique applied to Superior Tib-Fib Joint,/);
    assert.match(resolveProcedure('Rib Mobilization/Manipulation Right Ribs 1, 2, and 5').justification,
        /^Muscle energy technique applied to Rib,/);   // spliced from the RENAMED name
});
