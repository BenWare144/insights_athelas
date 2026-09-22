// Unit tests for the canonical procedure-matching engine.
// Run: npm test   (Node >= 20, zero dependencies)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { normProc, resolveProcedure, RULES, J, resolveBadCode, resolveNonReimbursed, NON_REIMBURSED } =
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

test('justifications are append-only: no rule uses replace mode (therapist request)', () => {
    for (const r of RULES) {
        assert.notEqual(r.justMode, 'replace', `rule "${r.label}" still uses replace mode`);
    }
    // MET + Rib used to be replace; they must now be append and still carry met:true.
    const met = resolveProcedure('MET to Superior Tib-Fib Joint');
    assert.equal(met.justMode, 'append');
    assert.equal(met.met, true);
    const rib = resolveProcedure('Rib Mobilization/Manipulation Right Ribs 1, 2, and 5');
    assert.equal(rib.justMode, 'append');
    assert.equal(rib.met, true);
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

// When a name hits two rules, the WINNING rule decides BOTH the CPT code and the
// justification — they never come from different rules. (Regression guard for the
// corrected "justification also wins" principle; see matching-duplicates.md.)
test('intersecting names: justification follows the winning category', () => {
    // lunge + balance -> Balance wins: 97112 AND the glute-med balance text
    // (NOT the lunge "squat and recover" text).
    for (const name of ['Lateral Lunge to Single Leg Balance',
                         'Posterior Lunge To Single Leg Balance',
                         'Deficit Posterior Lunge - Step Up, Single Leg Balance']) {
        const r = resolveProcedure(name);
        assert.equal(r.code, '97112', `${name} should file under 97112`);
        assert.equal(r.justification, J.gluteMed, `${name} should carry the balance justification`);
        assert.notEqual(r.justification, J.squatrec, `${name} must NOT carry the lunge justification`);
    }
    // anterior step + balance -> Step wins: 97530 AND the stair-climbing text
    // (previously move-only; justification now follows the winning step category).
    for (const name of ['Anterior Step Up To Single Leg Balance',
                        'Anterior Step Down To Single Leg Balance']) {
        const r = resolveProcedure(name);
        assert.equal(r.code, '97530', `${name} should file under 97530`);
        assert.equal(r.justification, J.stairs, `${name} should carry the step justification`);
    }
});

// ---- non-reimbursed billing codes (98960 family) --------------------------
// Leaving an item under one of these bills at $0, so these are CRITICAL fixes:
// unlike the 97110/97112/97530 shuffle, "leave alone" is never an acceptable
// outcome here.

test('resolveBadCode: recognises a non-reimbursed card by code or full label', () => {
    for (const card of ['98960', '98960 - Education & Training', ' 98960 ']) {
        const bad = resolveBadCode(card);
        assert.ok(bad, `${JSON.stringify(card)} should be flagged`);
        assert.equal(bad.code, '98960');
        assert.equal(bad.to, '97535');
    }
});

test('resolveBadCode: the reimbursable codes are NOT flagged', () => {
    for (const card of ['97110 - Therapeutic Exercise', '97112', '97530', '97140', 'PPVISIT - Visit-Private Pay', '', null]) {
        assert.equal(resolveBadCode(card), null, `${JSON.stringify(card)} must not be flagged`);
    }
});

test('resolveNonReimbursed: a name rule picks the destination when it has one', () => {
    const r = resolveNonReimbursed('Chair squat', '98960');
    assert.equal(r.code, '97530', 'a squat mis-filed under 98960 still belongs under 97530');
    assert.equal(r.justification, J.squatrec, 'and carries the squat justification');
    assert.ok(r.nonReimbursed, 'and is flagged as a critical (non-reimbursed) fix');
});

test('resolveNonReimbursed: falls back to the family default when no name rule matches', () => {
    const r = resolveNonReimbursed('Home exercise program review', '98960');
    assert.equal(r.code, '97535');
    assert.equal(r.justMode, 'none', 'no canonical text to append for the default target');
    assert.equal(r.justification, null);
});

test('resolveNonReimbursed: "leave alone" rules are overridden — $0 is not an option', () => {
    for (const name of ['Supine Bridge', 'Terminal Knee Extension (TKE)']) {
        assert.equal(resolveProcedure(name).exclude, true, `${name} is normally left alone`);
        const r = resolveNonReimbursed(name, '98960');
        assert.equal(r.code, '97535', `${name} must still be moved off 98960`);
    }
});

test('resolveNonReimbursed: returns null for a card that is fine', () => {
    assert.equal(resolveNonReimbursed('Chair squat', '97110 - Therapeutic Exercise'), null);
});

test('NON_REIMBURSED entries all target a real reimbursable PT code', () => {
    const ok = new Set(['97110', '97112', '97530', '97535']);
    for (const [code, cfg] of Object.entries(NON_REIMBURSED)) {
        assert.ok(ok.has(cfg.to), `${code} targets ${cfg.to}, which is not a PT code we file under`);
        assert.ok(cfg.reason && cfg.reason.length > 10, `${code} needs a reason string for the warning tooltip`);
        assert.equal(resolveBadCode(cfg.to), null, `${code} must not map onto another non-reimbursed code`);
    }
});

// ---- simulated functional activity (details-based, highest priority) ------
// The therapist's ruling: when the note says the task simulates/replicates a
// functional activity, it is Therapeutic Activity (97530), and that beats every
// other rule. This is the only rule that reads the intervention DETAILS.

test('simulate/replicate in the details sends the item to 97530', () => {
    for (const d of [
        'Patient performed squats to simulate getting out of a car.',
        'Task simulates stair descent at home.',
        'Simulation of a lifting task from floor to counter.',
        'Simulated car transfer practice.',
        'The movement replicates reaching into an overhead cupboard.',
        'Replicating the patient’s work station set-up.',
    ]) {
        const r = resolveProcedure('Some Exercise', d);
        assert.ok(r, `should match: ${d}`);
        assert.equal(r.code, '97530', `should be Therapeutic Activity: ${d}`);
        assert.equal(r.justMode, 'none', 'move-only — the detail sentence is the justification');
        assert.equal(r.justification, null);
    }
});

test('simulated-activity outranks EVERY other rule, including the excludes', () => {
    const d = 'Performed to simulate getting on and off the toilet at home.';
    const cases = [
        ['Terminal Knee Extension (TKE)', 'TKE is normally left alone'],
        ['Supine Bridge', 'bridges are normally left alone (under review)'],
        ['Curtsey Step to Single Leg Balance', 'curtsey-step-to-balance is normally left alone'],
        ['MET to Superior Tib-Fib Joint', 'MET normally wins 97112'],
        ['TKE on Cable column', 'cable column normally wins 97530 WITH the yardwork text'],
        ['Single-Leg Balance - Left', 'balance normally wins 97112'],
        ['Chair squat', 'squat normally wins 97530 WITH the squat-recover text'],
        ['Hamstring Stretch-supine', 'stretch normally wins 97110'],
        ['Hip Internal Rotation PROM', 'PROM normally wins 97110'],
    ];
    for (const [name, why] of cases) {
        const r = resolveProcedure(name, d);
        assert.equal(r.code, '97530', `${name}: ${why}`);
        assert.equal(r.label, 'Simulated functional activity (details)', `${name} should match the top rule`);
        assert.notEqual(r.exclude, true, `${name} must not be left alone when the note documents a simulation`);
        assert.equal(r.justification, null, `${name} must not carry the other rule's canonical text`);
    }
});

test('simulated-activity is the FIRST rule in the table', () => {
    assert.equal(RULES[0].label, 'Simulated functional activity (details)',
        'precedence is positional — this rule must stay at index 0');
});

test('"symptom reproduction" does NOT trigger the simulated-activity rule', () => {
    // The only near-miss in 254 real interventions. Reproducing a SYMPTOM is the
    // opposite of simulating a functional task, so 'reproduc' is not in the family.
    const r = resolveProcedure('Straight leg raise mobility stretch',
        'Clinician assessed effect of tibial rotation on symptom reproduction.');
    assert.equal(r.code, '97110', 'should fall through to the Straight Leg Raise rule');
    assert.equal(r.label, 'Straight Leg Raise');
});

test('details only — the simulated-activity rule ignores the NAME', () => {
    // The phrasing is what the therapist says aloud and the scribe writes down; it
    // does not appear in exercise names (0 hits in the 2,701-name catalogue).
    const r = resolveProcedure('Simulated Stair Climb', '');
    assert.equal(r, null, 'no name rule matches, and the details are empty');
});

test('the details argument is optional: one-argument calls are unchanged', () => {
    for (const name of ['Chair squat', 'MET', 'Terminal Knee Extension (TKE)', 'Supine Bridge', 'Hip Internal Rotation PROM']) {
        const a = resolveProcedure(name);
        const b = resolveProcedure(name, '');
        const c = resolveProcedure(name, undefined);
        assert.deepEqual(a, b, `${name}: '' must behave like omitted`);
        assert.deepEqual(a, c, `${name}: undefined must behave like omitted`);
    }
});

test('a simulated activity under a non-reimbursed code still lands on 97530', () => {
    const r = resolveNonReimbursed('Supine Bridge', '98960', 'to simulate getting out of bed');
    assert.equal(r.code, '97530', 'the top rule supplies the destination');
    assert.ok(r.nonReimbursed, 'and it is still flagged as a critical fix');
});
