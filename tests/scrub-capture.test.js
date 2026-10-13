// Tests for scripts/scrub-capture.js - the de-identifier that stands between raw
// page captures and anyone reading them. Every fixture here is synthetic: the
// "patient" is Zelda Quixley, who does not exist.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const S = require('../scripts/scrub-capture.js');

const vocab = S.parseVocabulary([
    'Add Goal', 'Create Goal', 'Goal Title', 'Initial State', 'Plan of Care End Date', 'Status', 'Day', 'Goals',
    'MM/DD/YYYY', 'Goal status', 'Checked In', 'MRN', 'QuickDASH', '^Scores for', '^Principal ·', '$interventions',
].join('\n'));
const deny = S.denyRegex(S.nameTokens('Zelda Quixley Chart Note_broken_goals.mhtml'));
const scrub = (html, extra) => S.scrubHtml(html, Object.assign({ vocab, deny }, extra));

test('shape keeps length and punctuation, drops content', () => {
    assert.equal(S.shape('Zelda Quixley 04/12/1961'), 'Xxxxx Xxxxxxx 00/00/0000');
    assert.equal(S.shape('MRN: A-10492'), 'XXX: X-00000');
    assert.equal(S.shape('éÉ ñ'), 'xX x');
});

test('text is scrubbed unless it is a known UI label', () => {
    assert.equal(scrub('<button>Add Goal</button>'), '<button>Add Goal</button>');
    assert.equal(scrub('<span>Zelda Quixley</span>'), '<span>Xxxxx Xxxxxxx</span>');
    assert.equal(scrub('<p>Pain 7/10 after gardening on 3 May.</p>'), '<p>Xxxx 0/00 xxxxx xxxxxxxxx xx 0 Xxx.</p>');
    assert.equal(scrub('<label>Goal Title:</label>'), '<label>Goal Title:</label>', 'trailing colon is ignored when matching');
    assert.equal(scrub('<span>  add   goal </span>'), '<span>  add   goal </span>', 'case and spacing do not matter');
    assert.equal(scrub('<i>keyboard_arrow_down</i>'), '<i>keyboard_arrow_down</i>', 'icon ligature names are not content');
    assert.equal(scrub('<b>@</b><b> · </b>'), '<b>@</b><b> · </b>', 'pure punctuation is left alone');
    assert.equal(scrub('<span data-testid="material-symbol">signature</span><span>signature</span>'), '<span data-testid="material-symbol">signature</span><span>xxxxxxxxx</span>', 'an icon-font element holds the icon name; the same word elsewhere is content');
    assert.equal(scrub('<span class="material-symbols-outlined">zelda</span>'), '<span class="material-symbols-outlined">xxxxx</span>', '...unless it is the name of the patient');
});

test('"Label: value" keeps the label and scrubs the value', () => {
    assert.equal(scrub('<span>Plan of Care End Date: 11/10/2026</span>'), '<span>Plan of Care End Date: 00/00/0000</span>');
    assert.equal(scrub('<span>(MRN: 48213)</span>'), '<span>(MRN: 00000)</span>');
    assert.equal(scrub('<span>Allergies: penicillin</span>'), '<span>Xxxxxxxxx: xxxxxxxxxx</span>', 'unknown label: everything goes');
});

test('prefix and suffix rules keep only the affix', () => {
    assert.equal(scrub('<div aria-label="Scores for QuickDASH"></div>'), '<div aria-label="Scores for QuickDASH"></div>');
    assert.equal(scrub('<div aria-label="Scores for Zung Index"></div>'), '<div aria-label="Scores for Xxxx Xxxxx"></div>');
    assert.equal(scrub('<div aria-label="Principal · M54.5 - Low back pain"></div>'), '<div aria-label="Principal · X00.0 - Xxx xxxx xxxx"></div>');
    assert.equal(scrub('<div aria-label="97110 - Therapeutic Exercise interventions"></div>'), '<div aria-label="00000 - Xxxxxxxxxxx Xxxxxxxx interventions"></div>');
});

test("the patient's own name loses even where the vocabulary would keep a word", () => {
    const v = S.parseVocabulary('Day\nStatus');
    const d = S.denyRegex(S.nameTokens('Jane Day Chart Note.mhtml'));
    assert.equal(S.scrubHtml('<b>Day</b><b>Status</b>', { vocab: v, deny: d }), '<b>Xxx</b><b>Status</b>');
    assert.equal(S.scrubHtml('<b id="day-panel">x</b>', { vocab: v, deny: d }), '<b id="xxx-xxxxx">x</b>', 'also inside structural attributes');
    assert.equal(S.scrubHtml('<b class="tr-day">x</b>', { vocab: v, deny: d }), '<b class="tr-day">x</b>', 'class names are structure');
});

test('attributes: structure is kept, content is scrubbed, handlers are dropped', () => {
    const out = scrub('<div class="tr-flex tr-w-[160px]" role="region" data-section="goals" data-patient-name="Zelda Quixley" data-rbd-draggable-id="88421" onclick="steal()" style="width: 220px; background: url(https://x.test/zelda.png)"></div>');
    assert.match(out, /class="tr-flex tr-w-\[160px\]"/);
    assert.match(out, /role="region"/);
    assert.match(out, /data-section="goals"/);
    assert.match(out, /data-patient-name="Xxxxx Xxxxxxx"/, 'unknown attribute: scrubbed by default');
    assert.match(out, /data-rbd-draggable-id="00000"/, 'unknown attribute: record id scrubbed');
    assert.doesNotMatch(out, /onclick|steal/);
    assert.match(out, /style="width: 220px; background: url\(\)"/, 'inline style keeps layout, loses its url');
});

test('attributes: labels, values and ids', () => {
    assert.equal(scrub('<input name="due_date" placeholder="MM/DD/YYYY" value="11/10/2026" type="text">'), '<input name="due_date" placeholder="MM/DD/YYYY" value="00/00/0000" type="text">');
    assert.equal(scrub('<input aria-label="Goal status" value="">'), '<input aria-label="Goal status" value="">');
    assert.equal(scrub('<span title="Zelda Quixley" aria-label="Zelda Quixley-88213"></span>'), '<span title="Xxxxx Xxxxxxx" aria-label="Xxxxx Xxxxxxx-00000"></span>');
    assert.equal(scrub('<div id="_r_17a_" aria-labelledby="_r_17a_"></div>'), '<div id="_r_17a_" aria-labelledby="_r_17a_"></div>', 'React ids survive');
    assert.equal(scrub('<div id="note-8842113"></div>'), '<div id="note-0000000"></div>', 'long digit runs are record numbers');
    assert.equal(scrub('<div id="p-3f2a9c1e-11aa-4bcd-9e0f-aabbccddeeff"></div>'), '<div id="p-00000000-0000-0000-0000-000000000000"></div>');
    assert.equal(scrub('<input disabled checked>'), '<input disabled checked>');
});

test('urls keep route words only; media references are dropped', () => {
    const ctx = { keptLocations: new Set(['https://insights.athelas.com/assets/app-4f3a.css']) };
    assert.equal(S.scrubUrl('/ehr/v2/patients/3f2a9c1e-11aa-4bcd-9e0f-aabbccddeeff/appointments/88213?tab=notes#goals', ctx), '/ehr/v2/patients/_/appointments/_');
    assert.equal(S.scrubUrl('https://insights.athelas.com/files/Zelda_Quixley_referral.pdf', ctx), 'https://insights.athelas.com/_/_');
    assert.equal(S.scrubUrl('https://cdn.example.com/u/zelda/avatar.png?sig=abc', ctx), 'https://cdn.example.com/');
    assert.equal(S.scrubUrl('mailto:zelda@example.com', ctx), 'mailto:');
    assert.equal(S.scrubUrl('tel:+15551234567', ctx), 'tel:');
    assert.equal(S.scrubUrl('data:image/png;base64,AAAA', ctx), 'data:');
    assert.equal(S.scrubUrl('cid:css-1234@mhtml.blink', ctx), 'cid:css-1234@mhtml.blink');
    assert.equal(S.scrubUrl('https://insights.athelas.com/assets/app-4f3a.css', ctx), 'https://insights.athelas.com/assets/app-4f3a.css', 'a stylesheet part we kept stays linked');
    // a route word that is also a word of the raw filename is treated as a possible name, like everything else
    const d = S.denyRegex(S.nameTokens('Appointments Example Person.mhtml'));
    assert.equal(S.scrubUrl('/ehr/v2/patients/991/appointments/5512', { deny: d }), '/ehr/v2/patients/_/_/_');
    assert.equal(S.scrubUrl('https://cdn.person.com/a.png', { deny: d }), 'https://_/');
    assert.equal(S.auditHtml(S.scrubHtml('<a href="/ehr/v2/appointments/1">x</a>', { vocab, deny: d }), d), 0);
    assert.equal(scrub('<img src="https://x.test/zelda.jpg" alt="Zelda Quixley" width="40">'), '<img alt="Xxxxx Xxxxxxx" width="40">');
    assert.equal(scrub('<a href="/ehr/v2/patients/991/appointments/5512">Open</a>'), '<a href="/ehr/v2/patients/_/appointments/_">Xxxx</a>');
});

test('raw-text elements: scripts and titles go, styles stay, textareas are scrubbed', () => {
    assert.equal(scrub('<title>Zelda Quixley Chart Note</title>'), '<title>scrubbed capture</title>');
    assert.equal(scrub('<script>var p = "Zelda Quixley";</script>'), '<script></script>');
    assert.equal(scrub('<style>.a > .b { color: red }</style>'), '<style>.a > .b { color: red }</style>');
    assert.equal(scrub('<textarea name="name">Zelda walks 2 miles</textarea>'), '<textarea name="name">Xxxxx xxxxx 0 xxxxx</textarea>');
    assert.equal(scrub('<div><!-- Zelda Quixley --></div>'), '<div><!----></div>');
    assert.equal(scrub('<noscript><img src="https://x.test/t?u=zelda"></noscript>'), '<noscript></noscript>');
});

test('tokenizer: ">" inside an attribute, entities, single quotes, self-closing', () => {
    assert.equal(scrub('<div class="ds:[&amp;:has(>*:not(:empty))]:flex">Add Goal</div>'), '<div class="ds:[&amp;:has(&gt;*:not(:empty))]:flex">Add Goal</div>');
    assert.equal(scrub("<span title='Zelda &amp; Co'>A &lt; B &amp; C</span>"), '<span title="Xxxxx &amp; Xx">X &lt; X &amp; X</span>');
    assert.equal(scrub('<svg viewBox="0 0 24 24"><path d="M19 13h-6v6"/></svg>'), '<svg viewBox="0 0 24 24"><path d="X00 00x-0x0"/></svg>');
    assert.equal(scrub('<p>Zelda&nbsp;Quixley &#8212; 5 &#x3c; 7</p>'), '<p>Xxxxx&nbsp;Xxxxxxx — 0 &lt; 0</p>');
});

test('malformed input fails closed instead of guessing', () => {
    assert.throws(() => scrub('<div title="Zelda'), /unterminated/);
    assert.throws(() => scrub('<script>var x = 1;'), /unterminated/);
    assert.throws(() => scrub('<div><!-- Zelda'), /unterminated/);
});

test('audit finds a name that slipped through', () => {
    assert.equal(S.auditHtml('<div class="zelda" style="x:zelda"><style>.zelda{}</style>Xxxxx</div>', deny), 0, 'class/style are not content');
    assert.equal(S.auditHtml('<div>Zelda</div>', deny), 1);
    assert.equal(S.auditHtml('<div data-x="quixley"></div>', deny), 1);
    assert.equal(S.auditHtml(scrub('<div title="Zelda" id="quixley-1">Zelda Quixley<input value="Quixley, Zelda"></div>'), deny), 0);
});

test('quoted-printable round-trips, including long lines, "=" and UTF-8', () => {
    const samples = ['', 'plain', 'a=b', 'trailing space \r\nnext', 'tab\t\r\n', 'é — ✓  ', 'x'.repeat(500), 'line1\nline2\r\nline3'];
    for (const s of samples) {
        const enc = S.qpEncode(Buffer.from(s, 'utf8'));
        for (const line of enc.split('\r\n')) assert.ok(line.length <= 76, 'encoded line too long');
        assert.equal(S.qpDecode(enc).toString('utf8'), s.replace(/\r?\n/g, '\r\n'));
    }
});

test('filenames: tokens to remove, and a neutral clean name', () => {
    assert.deepEqual(S.nameTokens('Zelda R Quixley Chart Note_create_goals_opened.mhtml'), ['zelda', 'quixley']);
    assert.deepEqual(S.nameTokens('Zelda Quixley Chart Note.mhtml'), ['zelda', 'quixley']);
    assert.deepEqual(S.nameTokens('dom-zelda-progress-note.html'), ['zelda'], 'no marker: every word that is not a descriptor is treated as a name');
    assert.deepEqual(S.nameTokens('Example_Chart_Note_3.mhtml'), []);
    const when = new Date(2026, 9, 13, 16, 28).getTime();
    const taken = new Set();
    assert.equal(S.cleanName('Zelda Quixley Chart Note_broken_goals.mhtml', when, taken), '2026-10-13_broken_goals.mhtml');
    assert.equal(S.cleanName('Zelda Quixley Chart Note.mhtml', when, taken), '2026-10-13_chart_note.mhtml');
    taken.add('2026-10-13_chart_note.mhtml');
    assert.equal(S.cleanName('Other Person Chart Note.mhtml', when, taken), '2026-10-13_chart_note-2.mhtml');
    assert.equal(S.cleanName('Zelda Quixley Chart Note_43523452.mhtml', when, new Set()), '2026-10-13_chart_note.mhtml', 'a long number could be a record number');
    assert.equal(S.cleanName('dom-zelda-progress-note.html', when, new Set()), '2026-10-13_capture.html', 'no marker: nothing of the raw name is reused');
});

// ---- end to end ------------------------------------------------------------
function fakeMhtml() {
    const B = '----MultipartBoundary--abc123----';
    const html = '<!DOCTYPE html><html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8">'
        + '<title>Zelda Quixley Chart Note</title><link rel="stylesheet" href="cid:css-1@mhtml.blink"></head><body>'
        + '<h3 role="heading">Goals</h3><button type="button">Add Goal</button>'
        + '<div data-section="goals"><span>Zelda Quixley</span><span>(MRN: 48213)</span>'
        + '<img src="cid:img-1@mhtml.blink" alt="Zelda Quixley">'
        + '<input name="initial_value" value="QuickDASH score of 50/100"><textarea name="name">Zelda will garden for 20 min</textarea>'
        + '<a href="https://insights.athelas.com/ehr/v2/patients/991/appointments/5512">Zelda Quixley</a></div></body></html>';
    const part = (headers, body) => '--' + B + '\r\n' + headers.join('\r\n') + '\r\n\r\n' + body + '\r\n';
    return [
        'From: <Saved by Blink>',
        'Snapshot-Content-Location: https://insights.athelas.com/ehr/v2/patients/991/appointments/5512',
        'Subject: Zelda Quixley Chart Note',
        'Date: Tue, 13 Oct 2026 21:28:43 -0000',
        'X-Patient: Zelda Quixley',
        'MIME-Version: 1.0',
        'Content-Type: multipart/related;\r\n\ttype="text/html";\r\n\tboundary="' + B + '"',
        '', '',
    ].join('\r\n')
        + part(['Content-Type: text/html', 'Content-ID: <frame-1@mhtml.blink>', 'Content-Transfer-Encoding: quoted-printable', 'Content-Location: https://insights.athelas.com/ehr/v2/patients/991/appointments/5512'], S.qpEncode(Buffer.from(html, 'utf8')))
        + part(['Content-Type: text/css', 'Content-Transfer-Encoding: quoted-printable', 'Content-Location: cid:css-1@mhtml.blink'], S.qpEncode(Buffer.from('.tr-flex { display: flex }', 'utf8')))
        + part(['Content-Type: image/png', 'Content-Transfer-Encoding: base64', 'Content-Location: cid:img-1@mhtml.blink'], Buffer.from('Zelda Quixley signature pixels').toString('base64'))
        + '--' + B + '--\r\n';
}

test('MHTML end to end: nothing identifying is left anywhere in the file', () => {
    const r = S.scrubMhtml(Buffer.from(fakeMhtml(), 'latin1'), { vocab, deny });
    const file = r.out.toString('latin1');
    assert.deepEqual(r.parts, { html: 1, css: 1, font: 0, dropped: 1 });
    assert.match(file, /^Subject: scrubbed capture\r$/m);
    assert.match(file, /^Snapshot-Content-Location: https:\/\/insights\.athelas\.com\/ehr\/v2\/patients\/_\/appointments\/_\r$/m);
    assert.doesNotMatch(file, /X-Patient/, 'unknown headers are dropped');
    // it is still a well-formed MHTML that parses back
    const back = S.parseMhtml(r.out);
    assert.equal(back.parts.length, 2);
    const html = S.qpDecode(back.parts[0].body).toString('utf8');
    const css = S.qpDecode(back.parts[1].body).toString('utf8');
    assert.equal(css, '.tr-flex { display: flex }', 'stylesheet kept verbatim');
    // the structure an agent needs survived
    for (const keep of ['<button type="button">Add Goal</button>', 'data-section="goals"', 'name="initial_value"', '<textarea name="name">', 'href="cid:css-1@mhtml.blink"', '>Goals<', '(MRN: 00000)']) {
        assert.ok(html.includes(keep), 'expected to survive: ' + keep);
    }
    // and nothing else did - checked on every decoded byte of the output
    const everything = file + '\n' + html + '\n' + back.parts.map((p) => Buffer.from(p.body, 'base64').toString('latin1')).join('\n');
    for (const leak of [/zelda/i, /quixley/i, /48213/, /\b991\b/, /5512/, /50\/100/, /garden/i, /signature pixels/, /image\/png/]) {
        assert.doesNotMatch(everything, leak, 'leaked: ' + leak);
    }
});

test('batch run: neutral names, manifest in the raw folder, idempotent, never prints raw names', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scrub-test-'));
    const raw = path.join(tmp, 'raw'); const out = path.join(tmp, 'clean');
    fs.mkdirSync(raw);
    fs.writeFileSync(path.join(raw, 'Zelda Quixley Chart Note_broken_goals.mhtml'), Buffer.from(fakeMhtml(), 'latin1'));
    fs.writeFileSync(path.join(raw, 'dom-zelda-progress-note.html'), '<div><b>Zelda Quixley</b><button>Add Goal</button></div>');
    fs.writeFileSync(path.join(raw, 'Broken Person Chart Note_bad.mhtml'), 'this is not an mhtml file');
    fs.writeFileSync(path.join(raw, '_notes.html'), '<p>underscore files are not captures</p>');
    try {
        const r1 = S.run({ raw, out, vocab: Object.assign({ hash: 'h1' }, vocab) });
        assert.equal(r1.scrubbed.length, 2);
        assert.equal(r1.failed, 1, 'the unparseable file fails closed');
        const cleanFiles = fs.readdirSync(out).sort();
        assert.equal(cleanFiles.length, 2);
        for (const f of cleanFiles) assert.match(f, /^\d{4}-\d{2}-\d{2}_(broken_goals\.mhtml|capture\.html)$/);
        assert.doesNotMatch(JSON.stringify(r1), /zelda|quixley|broken person/i, 'the result object (what gets printed) carries no raw names');
        assert.equal(fs.readFileSync(path.join(out, cleanFiles.find((f) => f.endsWith('.html'))), 'utf8'), '<div><b>Xxxxx Xxxxxxx</b><button>Add Goal</button></div>');
        assert.ok(fs.existsSync(path.join(raw, '_scrub-manifest.json')), 'the raw-name -> clean-name map stays in the raw folder');
        assert.ok(!fs.existsSync(path.join(out, '_scrub-manifest.json')));
        const r2 = S.run({ raw, out, vocab: Object.assign({ hash: 'h1' }, vocab) });
        assert.equal(r2.scrubbed.length, 0, 'second run has nothing to do');
        assert.equal(r2.skipped, 3);
        assert.equal(r2.failed, 0, 'a known failure is not retried or re-announced until the file changes');
        const r3 = S.run({ raw, out, vocab: Object.assign({ hash: 'h2' }, vocab) });
        assert.equal(r3.scrubbed.length, 2, 'a vocabulary change re-scrubs everything');
        assert.equal(r3.failed, 1, '...and retries the failure');
        assert.deepEqual(fs.readdirSync(out).sort(), cleanFiles, 'under the same clean names');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('the shipped vocabulary loads and holds no rule that keeps arbitrary text', () => {
    const v = S.loadVocabulary();
    assert.ok(v.phrases.has('add goal') && v.phrases.has('create new goal'));
    assert.ok(v.phrases.size > 100);
    for (const p of v.phrases) assert.ok(p.length <= 60 && !/\d{3,}/.test(p), 'suspicious vocabulary entry: ' + p);
    assert.equal(S.scrubHtml('<p>Zelda Quixley, 64, reports pain.</p>', { vocab: v }), '<p>Xxxxx Xxxxxxx, 00, xxxxxxx xxxx.</p>');
});
