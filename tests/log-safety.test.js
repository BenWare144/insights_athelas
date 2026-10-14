// Guards on the helper's console logging. The therapist saves the console to
// report bugs, so a log line must not carry chart content: values go through
// athLogVal() (same-shape placeholder unless the opt-in log-values flag is on),
// and elements go through athLogEl() (makeLogger applies it to every argument).
// See DECISIONS.md "Console logs are safe to save".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { shape } = require('../scripts/scrub-capture.js');

const userscript = fs.readFileSync(path.join(__dirname, '..', 'userscript', 'athelas-insights-helper.user.js'), 'utf8');

function between(from, to) {
    const a = userscript.indexOf(from);
    assert.ok(a >= 0, `marker not found: ${from}`);
    const b = userscript.indexOf(to, a);
    assert.ok(b > a, `end marker not found: ${to}`);
    return userscript.slice(a, b);
}

// Evaluate the shared logging block on its own, with a fake localStorage and console.
function loadLogging(flag) {
    const block = between('const ATH_LOG_VALUES_KEY =', '\n    // =====');
    const store = { 'athelas-helper:log-values': flag };
    const localStorage = { getItem: (k) => (k in store ? store[k] : null) };
    const lines = [];
    const consoleStub = {};
    for (const lvl of ['log', 'info', 'warn', 'error', 'debug']) consoleStub[lvl] = (...args) => lines.push({ lvl, args });
    const api = new Function('localStorage', 'console', block + '\nreturn { athShape, athLogVal, athLogEl, makeLogger, ATH_LOG_VALUES };')(localStorage, consoleStub);
    return { ...api, lines };
}

// A stand-in for a DOM element: just enough for athIsElement + athLogEl.
const fakeEl = (tag, attrs) => ({ nodeType: 1, tagName: tag, value: attrs.value, getAttribute: (a) => (a in attrs ? attrs[a] : null) });

// Drop every athLogVal(...) call (balanced parens) so what is left of a log line
// is only what it prints verbatim.
function stripShaped(line) {
    let out = '', i = 0;
    for (;;) {
        const at = line.indexOf('athLogVal(', i);
        if (at < 0) return out + line.slice(i);
        out += line.slice(i, at) + 'SHAPED';
        let depth = 0, j = at + 'athLogVal'.length;
        for (; j < line.length; j++) {
            if (line[j] === '(') depth++;
            else if (line[j] === ')' && --depth === 0) break;
        }
        i = j + 1;
    }
}
const LOG_CALL = /\b(log|highlightLogger)\.(log|info|warn|error|debug)\(/;
const LOG_CALL_G = new RegExp(LOG_CALL.source, 'g');
// The argument text of each log call on a line (balanced parens, skipping '…'
// and "…" strings), so code beside the call - a toast, a return - is not judged.
function logArgs(line) {
    const out = [];
    for (const m of line.matchAll(LOG_CALL_G)) {
        let depth = 1, j = m.index + m[0].length, quote = null;
        for (; j < line.length && depth > 0; j++) {
            const c = line[j];
            if (quote) { if (c === '\\') j++; else if (c === quote) quote = null; continue; }
            if (c === "'" || c === '"') quote = c;
            else if (c === '(') depth++;
            else if (c === ')') depth--;
        }
        out.push(line.slice(m.index + m[0].length, j - 1));
    }
    return out.join(' ;; ');
}
// Only the code of an expression: '…' and "…" become '', template text is
// dropped and each ${x} becomes `+ x +`. What is left is what gets evaluated.
function codeOnly(src) {
    let out = '', i = 0;
    const stack = [];   // 'tpl' = inside template text, '{' = inside ${…} or a plain block
    while (i < src.length) {
        const c = src[i];
        if (stack.at(-1) === 'tpl') {
            if (c === '\\') { i += 2; continue; }
            if (c === '`') { stack.pop(); out += "''"; i++; continue; }
            if (c === '$' && src[i + 1] === '{') { stack.push('${'); out += ' + '; i += 2; continue; }
            i++; continue;
        }
        if (c === "'" || c === '"') {
            let j = i + 1;
            while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
            out += "''"; i = j + 1; continue;
        }
        if (c === '`') { stack.push('tpl'); i++; continue; }
        if (c === '{') stack.push('{');
        if (c === '}') { const top = stack.pop(); if (top === '${') { out += ' + '; i++; continue; } }
        out += c; i++;
    }
    return out;
}
// Helpers that take a chart value but return a number or boolean.
const NUMERIC = /\b(indexOfNameInCard|itemCountInCard|isAtBottomOfCard)\([^()]*\)/g;
const logLines = () => userscript.split('\n')
    .map((line, i) => ({ text: line, args: codeOnly(logArgs(line)).replace(NUMERIC, 'N'), n: i + 1 }))
    .filter(({ text }) => LOG_CALL.test(text) && !/\/\/ log-safe:/.test(text));

// Log lines of one module: from its makeLogger('<tag>') to the next makeLogger(.
function moduleLogLines(tag) {
    const a = userscript.indexOf(`makeLogger('${tag}')`);
    assert.ok(a >= 0, `no module logger "${tag}"`);
    const b = userscript.indexOf('makeLogger(', a + 1);
    const first = userscript.slice(0, a).split('\n').length;
    const last = b < 0 ? Infinity : userscript.slice(0, b).split('\n').length;
    return logLines().filter(({ n }) => n >= first && n < last);
}
// Does a log call print `ident` verbatim - interpolated, concatenated, or as an
// argument of its own? (Run on codeOnly() output, where ${x} reads `+ x +`.)
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const prints = (bare, ident) => new RegExp(`(^|[,+(])\\s*${esc(ident)}\\s*($|[,)+])`).test(bare);

test('athShape is the scrubber\'s shape()', () => {
    const { athShape } = loadLogging(null);
    for (const s of ['Knee pain 03/14/2026', 'M54.50', 'S72.001S', 'Ölçek 12 Ä', '', 'already-shaped Xxxx 0000', 42]) {
        assert.equal(athShape(s), shape(s), `athShape(${JSON.stringify(s)})`);
    }
    assert.equal(athShape('Pt walks 150 ft'), 'Xx xxxxx 000 xx');
});

test('by default, values are shaped and elements are descriptors', () => {
    const { athLogVal, athLogEl, makeLogger, ATH_LOG_VALUES, lines } = loadLogging(null);
    assert.equal(ATH_LOG_VALUES, false);
    assert.equal(athLogVal('Initial 03/14/2026'), 'Xxxxxxx 00/00/0000');
    assert.equal(athLogVal(46), '00');
    assert.deepEqual(athLogVal({ date: '01/02/2026', initial: 'DHI 46' }), { date: '00/00/0000', initial: 'XXX 00' });
    assert.deepEqual(athLogVal(['M54.50', 'S72.001S']), ['X00.00', 'X00.000X']);
    assert.equal(athLogVal(null), null);
    assert.equal(athLogVal(true), true);

    const chip = fakeEl('DIV', { role: 'button', 'aria-label': 'Principal · M54.50 - Low back pain', value: 'x' });
    assert.equal(athLogEl(chip), '<div role="button" aria-label="Xxxxxxxxx · X00.00 - Xxx xxxx xxxx">');
    const input = fakeEl('INPUT', { name: 'duration', type: 'number', value: '4' });
    assert.equal(athLogEl(input), '<input name="duration" type="number">');
    assert.equal(athLogEl('a string'), 'a string');

    // makeLogger converts element arguments on its own, so `log.log('x', el)` is safe.
    makeLogger('t').log('clicked', chip, 3);
    assert.deepEqual(lines.at(-1).args, ['[athelas:t]', 'clicked', athLogEl(chip), 3]);
    assert.ok(!lines.some((l) => l.lvl === 'warn'), 'no "log-values is ON" warning when it is off');
});

test('log-values=1 restores raw values and live elements, and says so', () => {
    const { athLogVal, athLogEl, makeLogger, ATH_LOG_VALUES, lines } = loadLogging('1');
    assert.equal(ATH_LOG_VALUES, true);
    assert.equal(athLogVal('Initial 03/14/2026'), 'Initial 03/14/2026');
    const el = fakeEl('INPUT', { name: 'duration' });
    assert.equal(athLogEl(el), el);
    makeLogger('t').log('x', el);
    assert.equal(lines.at(-1).args[2], el);
    assert.ok(lines.some((l) => l.lvl === 'warn' && /log-values is ON/.test(l.args.join(' '))), 'a warning line must say raw values are on');
    assert.equal(loadLogging('true').ATH_LOG_VALUES, false, 'only the exact value "1" turns it on');
});

test('setReactValue never logs a raw value', () => {
    // The main offender: it logged before/after/requested for every field it
    // filled - goal sentences, dates, plan-of-care numbers, diagnosis codes.
    const body = between('function setReactValue(', '\n    }\n');
    const logs = body.split('\n').filter((l) => LOG_CALL.test(l));
    assert.ok(logs.length >= 3, 'setReactValue should still log');
    for (const l of logs) {
        assert.doesNotMatch(stripShaped(l), /\$\{\s*(before|value|el\.value)\s*\}/, `raw value in: ${l.trim()}`);
    }
    assert.match(body, /athLogVal\(before\)/);
    assert.match(body, /athLogVal\(value\)/);
    assert.match(body, /stuck=\$\{el\.value === value\}/, 'it should say whether the value stuck');
});

test('no log line prints a field value, element text, or URL', () => {
    const offenders = [];
    for (const { text, args, n } of logLines()) {
        const bare = stripShaped(args);
        if (/\.value\b(?!\s*===|\.length)|getAttribute\(\s*['"]value['"]\)|\.textContent(?!\.length)|\.innerText|\.innerHTML|\.outerHTML|\.href\b/.test(bare)) offenders.push(`${n}: ${text.trim()}`);
    }
    assert.deepEqual(offenders, [], 'wrap these in athLogVal(), or mark a line "// log-safe: <why>" if it is app chrome');
});

test('chart-content readers only reach a log line through athLogVal', () => {
    const offenders = [];
    for (const { text, args, n } of logLines()) {
        // Intervention names, the dnd-kit live region, plan-of-care fields.
        if (/\b(nameOf|itemName|liName|liveRegionText|valOf|readPoc)\(/.test(stripShaped(args))) offenders.push(`${n}: ${text.trim()}`);
    }
    assert.deepEqual(offenders, [], 'wrap these in athLogVal()');
});

test('each module shapes the chart values it handles', () => {
    // Per module, because the same variable name means different things: `code`
    // is a CPT code in Fix Procedures (verbatim on purpose) and an ICD-10 code in
    // Fix Diagnosis (the patient's diagnosis).
    const CHART = {
        'fix-met': ['name', 'f.name', 'next.fix.name'],
        'fix-pp': ['name', 'it.name'],
        'proc-match': ['r.name', 'name'],
        'goals': ['fields', 'fields.date', 'fields.initial', 'fields.target'],
        'calendar': ['apptId', 'cached', 'live.href'],
        'fix-dx': ['target', 'code', 'row.code', 'row.to', 'r.code', 'r.to'],
        'fix-poc': ['key', 'only', 'projEnd', 'projVisits', 'p.duration', 'before', 'p.endDate', 'p.visits'],
    };
    const offenders = [];
    for (const [tag, idents] of Object.entries(CHART)) {
        const lines = moduleLogLines(tag);
        assert.ok(lines.length > 0, `no log lines found for ${tag} - did the module move?`);
        for (const { text, args, n } of lines) {
            const bare = stripShaped(args);
            for (const id of idents) if (prints(bare, id)) offenders.push(`[${tag}] ${n} prints ${id}: ${text.trim()}`);
        }
    }
    assert.deepEqual(offenders, [], 'wrap these in athLogVal()');
});
