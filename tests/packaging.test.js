// Guards against version/content drift between the userscript (source of
// truth) and the Chrome extension packaging. See AGENTS.md "Dual-artifact rule".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, 'athelas-insights-helper-extension');
const userscriptPath = path.join(ROOT, 'userscript', 'athelas-insights-helper.user.js');
const contentPath = path.join(EXT, 'content.js');
const manifestPath = path.join(EXT, 'manifest.json');

const userscript = fs.readFileSync(userscriptPath, 'utf8');
const content = fs.readFileSync(contentPath, 'utf8');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const GM_HEADER_LINES = 12;   // // ==UserScript== ... // ==/UserScript==
const BANNER_LINES = 8;       // generated banner at the top of content.js

function headerField(name) {
    const m = userscript.match(new RegExp(`^// @${name}\\s+(.+)$`, 'm'));
    return m && m[1].trim();
}

test('versions match: userscript @version == manifest.json == package.json', () => {
    const uv = headerField('version');
    assert.ok(uv, 'userscript @version not found');
    assert.equal(manifest.version, uv, 'manifest.json version drifted from userscript');
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.equal(pkg.version, uv, 'package.json version drifted from userscript');
});

test('content.js body is byte-identical to the userscript body', () => {
    const scriptBody = userscript.split('\n').slice(GM_HEADER_LINES).join('\n');
    const contentBody = content.split('\n').slice(BANNER_LINES).join('\n');
    assert.equal(contentBody, scriptBody,
        'content.js drifted from the userscript — regenerate per athelas-insights-helper-extension/README.md');
});

test('manifest: MV3, MAIN world, document_start, same match patterns as @match', () => {
    assert.equal(manifest.manifest_version, 3);
    const cs = manifest.content_scripts;
    assert.equal(cs.length, 1);
    assert.equal(cs[0].run_at, 'document_start', 'must match @run-at document-start');
    assert.equal(cs[0].world, 'MAIN',
        'MAIN world is required: Fix-MET reads __reactFiber$ expandos (see AGENTS.md)');
    assert.deepEqual(cs[0].js, ['content.js']);
    const gmMatches = [...userscript.matchAll(/^\/\/ @match\s+(.+)$/gm)].map((m) => m[1].trim()).sort();
    assert.deepEqual([...cs[0].matches].sort(), gmMatches,
        'manifest matches drifted from userscript @match lines');
    assert.equal(manifest.permissions, undefined, 'extension must stay permission-free');
    assert.equal(manifest.host_permissions, undefined, 'extension must stay permission-free');
});

test('manifest icon files exist', () => {
    for (const rel of Object.values(manifest.icons)) {
        assert.ok(fs.existsSync(path.join(EXT, rel)), `missing icon ${rel}`);
    }
});

test('content.js parses (node --check)', () => {
    const r = spawnSync(process.execPath, ['--check', contentPath], { encoding: 'utf8' });
    assert.equal(r.status, 0, `syntax error:\n${r.stderr}`);
});
