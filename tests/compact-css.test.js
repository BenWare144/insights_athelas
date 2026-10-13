// Guards on the compact-layout stylesheets (userscript MODULE 1).
//
// The rule they enforce: compact CSS is SPACING ONLY. A spacing rule whose
// selector stops matching after a site update simply does nothing. A geometry
// rule (a width, an offset, a position) that keeps half-matching breaks the
// page - which is how a leftover `.q-page-container { padding-left: 200px }`
// put a blank band down the left of every note once the site replaced its
// drawer. See DECISIONS.md "Compact CSS is spacing-only".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const userscript = fs.readFileSync(path.join(__dirname, '..', 'userscript', 'athelas-insights-helper.user.js'), 'utf8');

// Evaluate a `const <name> = `...`;` template literal out of the source.
function cssBlock(name) {
    const marker = `const ${name} = \``;
    const a = userscript.indexOf(marker);
    assert.ok(a >= 0, `${name} not found`);
    const start = a + marker.length - 1;
    const end = userscript.indexOf('`;', start + 1);
    const literal = userscript.slice(start, end + 1);
    assert.doesNotMatch(literal, /\$\{/, `${name} must stay a plain literal`);
    return new Function('return ' + literal)();
}

// -> [{ selector, prop, value }] for every declaration, comments stripped.
function declarations(css) {
    const out = [];
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = m[1].trim().replace(/\s+/g, ' ');
        for (const decl of m[2].split(';')) {
            const i = decl.indexOf(':');
            if (i < 0) continue;
            out.push({ selector, prop: decl.slice(0, i).trim().toLowerCase(), value: decl.slice(i + 1).replace(/!important/i, '').trim() });
        }
    }
    return out;
}

const BLOCKS = { cssAppointments: declarations(cssBlock('cssAppointments')), cssChartNote: declarations(cssBlock('cssChartNote')) };

// Everything the stylesheets are allowed to set. Deliberately absent: width,
// min-/max-width, left/right/top/bottom/inset, position, transform, display,
// overflow, flex-*, grid-* - anything that moves or resizes a box.
const SPACING = /^(padding|margin)(-(top|right|bottom|left))?$|^(row-|column-)?gap$/;
const ALLOWED = (p) => SPACING.test(p) || ['line-height', 'min-height', 'height', 'font-size'].includes(p);
const px = (token) => (/rem$/.test(token) ? parseFloat(token) * 16 : parseFloat(token));

test('the stylesheets parse to a plausible number of rules', () => {
    assert.ok(BLOCKS.cssAppointments.length > 10, 'cssAppointments parsed too few declarations');
    assert.ok(BLOCKS.cssChartNote.length > 60, 'cssChartNote parsed too few declarations');
});

for (const [name, decls] of Object.entries(BLOCKS)) {
    test(`${name}: spacing and density properties only`, () => {
        const bad = decls.filter((d) => !ALLOWED(d.prop)).map((d) => `${d.selector} { ${d.prop}: ${d.value} }`);
        assert.deepEqual(bad, [], 'compact CSS may not move or resize boxes');
    });

    test(`${name}: only ever shrinks spacing (nothing above 16px)`, () => {
        const bad = [];
        for (const d of decls.filter((x) => SPACING.test(x.prop))) {
            for (const token of d.value.split(/\s+/)) {
                assert.match(token, /^(0|\d*\.?\d+(px|rem))$/, `unexpected spacing value in ${d.selector} { ${d.prop}: ${d.value} }`);
                if (px(token) > 16) bad.push(`${d.selector} { ${d.prop}: ${d.value} }`);
            }
        }
        assert.deepEqual(bad, [], 'a large spacing value is a layout offset in disguise');
    });

    test(`${name}: height is only ever released, never fixed`, () => {
        const bad = decls.filter((d) => d.prop === 'height' && d.value !== 'auto').map((d) => `${d.selector} { height: ${d.value} }`);
        assert.deepEqual(bad, []);
    });

    test(`${name}: never targets the app shell`, () => {
        const shell = /q-drawer|q-page-container|q-layout|q-header|app-shell|resizable-panel|(^|[\s,>+~])(html|body|main|aside)\b/;
        const bad = [...new Set(decls.filter((d) => shell.test(d.selector)).map((d) => d.selector))];
        assert.deepEqual(bad, [], 'the sidebar, page container and main area belong to the site');
    });

    test(`${name}: no css-hash selectors`, () => {
        const bad = [...new Set(decls.filter((d) => /\.css-[a-z0-9]+/i.test(d.selector)).map((d) => d.selector))];
        assert.deepEqual(bad, [], 'MUI regenerates css-* hashes on every deploy (AGENTS.md hard constraint 3)');
    });
}

test('the chart-note stylesheet is watched by the runtime self-check', () => {
    // The test above stops US writing a geometry rule. It cannot stop a site
    // update changing what an existing rule does - compactSelfCheck() does.
    assert.match(userscript, /if \(isChartNote && applyCompactCss\._done\.chart\) compactSelfCheck\(log\);/);
    assert.match(userscript, /if \(isChartNote && !applyCompactCss\._tripped\) wanted\.push\(\['chart', cssChartNote\]\);/,
        'a tripped self-check must keep the stylesheet out until the page reloads');
});
