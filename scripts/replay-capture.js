#!/usr/bin/env node
'use strict';
/*
 * replay-capture.js - serve a SCRUBBED capture at its real route, with the working-copy userscript
 * injected, so you can see what the helper does on a page without the live site.
 *
 *   npm run replay                 then open, in a browser:
 *   http://127.0.0.1:8765/ehr/calendar?cap=<name>&script=1
 *   http://127.0.0.1:8765/ehr/v2/patients/1/appointments/2?cap=<name>&script=1
 *
 * <name> is a file in captures/ without ".mhtml". The path matters: the helper decides what a page is
 * from location.pathname (pageType()), so a calendar capture has to be opened under /ehr/calendar and a
 * chart note under /ehr/v2/patients/<anything>/appointments/<anything>.
 *
 *   script=1   inject userscript/athelas-insights-helper.user.js (read fresh on every request)
 *   keep=1     leave the helper's OWN captured buttons and stylesheets in place. A capture saved while
 *              the helper was running contains them (its buttons are in the DOM, its <style> blocks are
 *              saved as stylesheet parts), and with them present you are looking at what the old build
 *              did on the day, not at what this build does. Default: stripped.
 *
 * What it can show: whether selectors still match, where injected buttons land, layout with the real
 * CSS, and the __athelas* DevTools hooks. What it cannot: anything that needs Athelas's own code (no
 * scripts survive the scrub, so nothing on the page reacts to a click) or a real value (see
 * DECISIONS.md "What a scrubbed capture can and cannot show").
 *
 * Local only: binds to 127.0.0.1, reads captures/ (never the raw folder), and removes <base> and every
 * absolute <link>, so the replayed page does not request anything from the real site.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const S = require('./scrub-capture.js');

const REPO = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 8765;
const USERSCRIPT = path.join(REPO, 'userscript', 'athelas-insights-helper.user.js');
const GM_SHIM = '<script>window.GM_addStyle=function(c){var s=document.createElement("style");s.textContent=c;(document.head||document.documentElement).appendChild(s);return s;};</script>';

const cache = new Map();
function load(cap) {
    if (cache.has(cap)) return cache.get(cap);
    const mh = S.parseMhtml(fs.readFileSync(path.join(REPO, 'captures', cap + '.mhtml')));
    const parts = mh.parts.map((p) => {
        const h = (k) => (p.headers.find((x) => x.name.toLowerCase() === k) || {}).value || '';
        const enc = h('content-transfer-encoding').toLowerCase();
        const raw = typeof p.body === 'string' ? p.body : p.body.toString('latin1');
        const body = enc === 'quoted-printable' ? S.qpDecode(raw) : Buffer.from(raw, enc === 'base64' ? 'base64' : 'latin1');
        return { type: h('content-type'), loc: h('content-location'), cid: h('content-id').replace(/^<|>$/g, ''), body };
    });
    cache.set(cap, parts);
    return parts;
}
const isHtml = (p) => /text\/html/i.test(p.type);
// One of the helper's own stylesheets, saved into the capture by a build that was running at the time.
function isHelperCss(p) {
    if (!/css/i.test(p.type)) return false;
    const t = p.body.toString('utf8');
    return /[.#]ath-|athelas/.test(t) || /[.]tr-gap-y-8\s*[{][^}]*!important/.test(t);
}

function page(cap, parts, { keep, script }) {
    let html = parts.find(isHtml).body.toString('utf8');
    parts.forEach((p, i) => {
        if (isHtml(p)) return;
        const url = '"/__part?cap=' + cap + (keep ? '&amp;keep=1' : '') + '&amp;i=' + i + '"';
        for (const key of [p.loc, p.cid && 'cid:' + p.cid]) if (key) html = html.split('"' + key + '"').join(url);
    });
    html = html.replace(/<base[^>]*>/gi, '').replace(/<link[^>]*href="https?:[^>]*>/gi, '').replace(/<iframe[^>]*>/gi, '<iframe>');
    if (!keep) html = html.replace(/<button[^>]*[ ]id="ath[^"]*"[^>]*>[^]*?<[/]button>/g, '');
    if (script) html = html.replace(/<head[^>]*>/i, (m) => m + GM_SHIM + '<script src="/__userscript.js"></script>');
    return html;
}

function main() {
    http.createServer((req, res) => {
        const send = (code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
        try {
            const u = new URL(req.url, 'http://x');
            if (u.pathname === '/__userscript.js') return send(200, 'text/javascript; charset=utf-8', fs.readFileSync(USERSCRIPT));
            const cap = (u.searchParams.get('cap') || '').replace(/[^\w.-]/g, '');
            if (!cap) {
                const names = fs.readdirSync(path.join(REPO, 'captures')).filter((f) => f.endsWith('.mhtml')).map((f) => f.slice(0, -6)).sort().reverse();
                return send(200, 'text/plain; charset=utf-8', 'Add ?cap=<name>&script=1 to a calendar or chart-note path (see the header of scripts/replay-capture.js).\n\n' + names.join('\n'));
            }
            const parts = load(cap);
            const keep = u.searchParams.get('keep') === '1';
            if (u.pathname === '/__part') {
                const p = parts[Number(u.searchParams.get('i'))];
                if (!p) return send(404, 'text/plain', 'no such part');
                return send(200, p.type.split(';')[0] + (/css|html/i.test(p.type) ? '; charset=utf-8' : ''), !keep && isHelperCss(p) ? '' : p.body);
            }
            return send(200, 'text/html; charset=utf-8', page(cap, parts, { keep, script: u.searchParams.get('script') === '1' }));
        } catch (e) { send(500, 'text/plain; charset=utf-8', String(e && e.message)); }
    }).listen(PORT, '127.0.0.1', () => console.log('replaying captures on http://127.0.0.1:' + PORT + '/  (Ctrl+C to stop)'));
}

module.exports = { page, isHelperCss };
if (require.main === module) main();
