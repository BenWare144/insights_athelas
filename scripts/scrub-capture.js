#!/usr/bin/env node
'use strict';
/*
 * scrub-capture.js - de-identify raw page captures BEFORE anyone reads them.
 *
 * Raw captures (Chrome "Save as... Webpage, Single File" .mhtml, or .html DOM
 * dumps) are real patient charts. They live OUTSIDE this repo, in a sibling
 * folder (default ../insights_athelas_raw_captures). This script writes a
 * scrubbed copy of each into captures/, under a neutral name, and that copy is
 * the only thing an agent is meant to open.
 *
 * The scrub is FAIL-CLOSED: everything is removed unless it is known to be safe.
 *   - Text and label-like attributes (aria-label, title, placeholder, value...)
 *     are replaced by same-shape placeholders (letters -> x/X, digits -> 0)
 *     unless they are a known UI label from scripts/scrub-vocabulary.txt.
 *   - Attributes keep their value only if the attribute NAME is on a short
 *     structural allowlist (class, role, name, data-section, ...). Everything
 *     else is shape-scrubbed. Event handlers are dropped.
 *   - URLs keep known route words only; ids, query strings and fragments go.
 *   - Images and every other binary part are dropped. Stylesheets and fonts
 *     are kept (static site assets). Scripts and comments are dropped.
 *   - The patient's name is read from the RAW FILENAME (the part before
 *     "Chart Note") and forced out everywhere, even where the vocabulary would
 *     have kept a word. A final audit re-reads the output and refuses to write
 *     it if any of those name tokens survived.
 *   - The output filename is "<capture date>_<your description>", never the
 *     raw name.
 *
 * What it is NOT: a HIPAA de-identification guarantee. It is a strong
 * best-effort scrub for selector and layout debugging.
 *
 * Usage (from the repo root):
 *   node scripts/scrub-capture.js            scrub new or changed raw captures
 *   node scripts/scrub-capture.js --all      re-scrub everything
 *   node scripts/scrub-capture.js --hook     same, but quiet JSON for a Claude Code hook
 *   --raw <dir> / --out <dir>                override the folders
 *   --verbose                                also list which attribute NAMES were scrubbed
 *
 * This script never prints raw text. Anything containing raw strings (the
 * manifest, the review list of scrubbed labels) is written into the RAW folder.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SCRUBBER_VERSION = 2;   // bump whenever a scrub rule changes: every capture is then re-scrubbed on the next run
const REPO = path.join(__dirname, '..');
const DEFAULT_RAW = process.env.ATHELAS_RAW_CAPTURES || path.join(REPO, '..', 'insights_athelas_raw_captures');
const DEFAULT_OUT = path.join(REPO, 'captures');
const VOCAB_FILE = path.join(__dirname, 'scrub-vocabulary.txt');
const MANIFEST = '_scrub-manifest.json';
const REVIEW = '_scrub-review.txt';

// ---------------------------------------------------------------------------
// Vocabulary: the UI labels that are allowed to survive.
// ---------------------------------------------------------------------------
const norm = (s) => String(s).replace(/[\s ​]+/g, ' ').trim().toLowerCase();
const rxEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const phraseRx = (p) => rxEscape(norm(p)).replace(/ /g, '[\\s\\u00a0]+');

function parseVocabulary(text, extra = []) {
    const phrases = new Set();
    const prefixes = [];
    const suffixes = [];
    const add = (line) => {
        const t = String(line).replace(/\s+$/, '');
        if (!t.trim() || t.trim().startsWith('#')) return;
        if (t.startsWith('^')) prefixes.push(new RegExp('^[\\s\\u00a0]*' + phraseRx(t.slice(1)) + '(?![\\p{L}\\p{N}])', 'iu'));
        else if (t.startsWith('$')) suffixes.push(new RegExp('(?<![\\p{L}\\p{N}])' + phraseRx(t.slice(1)) + '[\\s\\u00a0]*$', 'iu'));
        else phrases.add(norm(t));
    };
    text.split(/\r?\n/).forEach(add);
    extra.forEach(add);
    return { phrases, prefixes, suffixes };
}

function loadVocabulary(file = VOCAB_FILE) {
    const extra = [];
    try {   // survey names are UI vocabulary; take them from the canonical engine so they never drift
        const { SURVEYS } = require(path.join(REPO, 'surveys', 'survey-scoring.js'));
        for (const s of SURVEYS || []) for (const k of ['key', 'auto', 'section']) if (s[k]) extra.push(s[k]);
    } catch (e) { /* vocabulary file alone is fine */ }
    const text = fs.readFileSync(file, 'utf8');
    const vocab = parseVocabulary(text, extra);
    vocab.hash = crypto.createHash('sha256').update(text).update(extra.join('\n')).digest('hex').slice(0, 16);
    return vocab;
}

// ---------------------------------------------------------------------------
// Text policy
// ---------------------------------------------------------------------------
const HAS_ALNUM = /[\p{L}\p{N}]/u;
// Same length, same punctuation, no content: "Jane Doe 04/12/1961" -> "Xxxx Xxx 00/00/0000".
function shape(s) {
    return String(s).replace(/[\p{L}\p{N}]/gu, (ch) => (/\p{N}/u.test(ch) ? '0' : (ch !== ch.toLowerCase() ? 'X' : 'x')));
}
const stripPunct = (n) => n.replace(/^[([\s]+|[)\]\s]+$/g, '').replace(/[\s:*.…]+$/g, '').trim();
const inVocab = (vocab, s) => { const n = norm(s); return vocab.phrases.has(n) || vocab.phrases.has(stripPunct(n)); };

// -> { text, kept } where kept is 'all' | 'part' | 'none'
function classifyLabel(s, vocab, deny) {
    if (!HAS_ALNUM.test(s)) return { text: s, kept: 'all' };
    if (deny && deny.test(s)) return { text: shape(s), kept: 'none' };            // the patient's own name always loses
    if (inVocab(vocab, s)) return { text: s, kept: 'all' };
    if (/^\s*[a-z]+(_[a-z0-9]+)+\s*$/.test(s)) return { text: s, kept: 'all' };   // icon ligature names: keyboard_arrow_down
    const rest = (r) => (!HAS_ALNUM.test(r) || inVocab(vocab, r) ? r : shape(r));
    for (const rx of vocab.prefixes) { const m = rx.exec(s); if (m) return { text: m[0] + rest(s.slice(m[0].length)), kept: 'part' }; }
    const lv = /^([\s ]*)([^:]{1,60}?)([\s ]*:[\s ]*)([\s\S]+)$/.exec(s);   // "Known Label: value"
    if (lv && inVocab(vocab, lv[2])) return { text: lv[1] + lv[2] + lv[3] + rest(lv[4]), kept: 'part' };
    for (const rx of vocab.suffixes) { const m = rx.exec(s); if (m) return { text: rest(s.slice(0, m.index)) + m[0], kept: 'part' }; }
    return { text: shape(s), kept: 'none' };
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s) {
    if (s.indexOf('&') < 0) return s;
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
        if (e[0] === '#') {
            const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
            try { return String.fromCodePoint(cp); } catch (err) { return ''; }
        }
        const k = e.toLowerCase();
        return Object.prototype.hasOwnProperty.call(NAMED, k) ? NAMED[k] : m;
    });
}
const encodeText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
const encodeAttr = (s) => encodeText(s).replace(/"/g, '&quot;');

// ---------------------------------------------------------------------------
// Attribute policy
// ---------------------------------------------------------------------------
// Attribute NAMES whose values are structure, not content. Anything not listed
// here (and not handled below) is shape-scrubbed, so a new attribute is safe by
// default; add its name here only once you know what it holds.
const KEEP_ATTRS = new Set([
    'role', 'type', 'name', 'id', 'for', 'tabindex', 'lang', 'dir', 'charset', 'http-equiv', 'rel', 'media', 'target', 'method',
    'disabled', 'readonly', 'checked', 'selected', 'hidden', 'required', 'multiple', 'open', 'novalidate', 'autofocus',
    'contenteditable', 'spellcheck', 'translate', 'draggable', 'inputmode', 'autocomplete', 'autocapitalize', 'autocorrect',
    'maxlength', 'minlength', 'rows', 'cols', 'colspan', 'rowspan', 'span', 'scope', 'wrap', 'size',
    'width', 'height', 'viewbox', 'xmlns', 'xmlns:xlink', 'focusable', 'preserveaspectratio', 'version',
    'aria-hidden', 'aria-expanded', 'aria-haspopup', 'aria-invalid', 'aria-disabled', 'aria-selected', 'aria-checked', 'aria-pressed',
    'aria-controls', 'aria-labelledby', 'aria-describedby', 'aria-owns', 'aria-activedescendant', 'aria-orientation', 'aria-modal',
    'aria-multiline', 'aria-multiselectable', 'aria-autocomplete', 'aria-required', 'aria-readonly', 'aria-live', 'aria-atomic',
    'aria-busy', 'aria-current', 'aria-level', 'aria-sort', 'aria-setsize', 'aria-posinset', 'aria-colcount', 'aria-rowcount',
    'aria-colindex', 'aria-rowindex', 'aria-colspan', 'aria-rowspan', 'aria-relevant', 'aria-grabbed', 'aria-dropeffect',
    'data-section', 'data-slot', 'data-state', 'data-side', 'data-variant', 'data-orientation', 'data-testid', 'data-tour',
    'data-tag-index', 'data-index', 'data-disabled', 'data-highlighted', 'data-active', 'data-focus', 'data-focus-visible',
    'data-selected', 'data-checked', 'data-open', 'data-collapsible', 'data-collapsed', 'data-size', 'data-type', 'data-icon',
    'data-align', 'data-placement', 'data-popper-placement', 'data-calendar-event', 'data-name-text', 'data-sidebar', 'data-shrink',
    'data-simplebar', 'data-pm-slice', 'data-node-view-wrapper', 'data-node-view-content', 'data-drag-handle', 'data-direction',
    // added after the first full run's census of scrubbed attribute names: enums, flags and indices only
    'crossorigin', 'as', 'frameborder', 'scrolling', 'allowtransparency', 'orientation', 'variant', 'xml:space',
    'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'fill-rule', 'clip-rule', 'opacity',
    'data-field', 'data-colindex', 'data-rowindex', 'data-indeterminate', 'data-loading', 'data-option-index', 'data-dragging',
    'data-initializing', 'data-panel-open', 'data-popper-escaped', 'data-floating-ui-portal', 'data-base-ui-portal',
    'data-chart-note-scope', 'data-copilot-surface',
]);
// Human-readable attributes: kept only when they are a known UI label.
const LABEL_ATTRS = new Set([
    'aria-label', 'aria-description', 'aria-placeholder', 'aria-roledescription', 'aria-valuetext', 'title', 'placeholder', 'alt',
    'value', 'label', 'data-value', 'data-placeholder', 'data-label', 'data-title', 'summary', 'abbr',
]);
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'poster', 'data', 'cite', 'background', 'longdesc', 'manifest', 'xlink:href', 'srcset', 'ping']);
const MEDIA_TAGS = new Set(['img', 'source', 'video', 'audio', 'picture', 'image', 'track', 'embed', 'object']);
const ROUTE_WORDS = new Set([
    'ehr', 'v1', 'v2', 'v3', 'api', 'patients', 'appointments', 'calendar', 'my_account', 'insights', 'settings', 'notes', 'chart',
    'assets', 'static', 'tasks', 'orders', 'attachments', 'demographics', 'billing', 'reports', 'dashboard', 'login', 'logout',
    'home', 'schedule', 'messages', 'flowsheet', 'goals',
]);

const UUID_RX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
// Record ids hide in structural attributes (id="note-8842113"). React's own ids (_r_17a_) are short and survive.
const maskIds = (s) => s.replace(UUID_RX, '00000000-0000-0000-0000-000000000000').replace(/\d{5,}/g, (d) => '0'.repeat(d.length));

function scrubUrl(u, ctx) {
    const s = String(u).trim();
    if (!s) return '';
    const denied = (x) => !!(ctx.deny && ctx.deny.test(x));       // a route word can also be somebody's name
    if (ctx.keptLocations && ctx.keptLocations.has(s)) return s;   // link to a stylesheet/font part we kept
    if (/^cid:/i.test(s)) return denied(s) ? 'cid:' : s;           // opaque MHTML content id
    if (s[0] === '#') return '#';
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(s);
    if (scheme && !/^https?$/i.test(scheme[1])) return scheme[1].toLowerCase() + ':';   // mailto:, tel:, data:, blob: -> scheme only
    let url;
    try { url = new URL(s, 'https://insights.athelas.com/'); } catch (e) { return ''; }
    const absolute = /^(https?:)?\/\//i.test(s);
    if (!/(^|\.)athelas\.com$/i.test(url.hostname)) return url.protocol + '//' + (denied(url.hostname) ? '_' : url.hostname) + '/';
    const segs = url.pathname.split('/').filter(Boolean).map((x) => (ROUTE_WORDS.has(x.toLowerCase()) && !denied(x) ? x.toLowerCase() : '_'));
    return (absolute ? url.protocol + '//' + url.hostname : '') + '/' + segs.join('/');
}
const scrubStyle = (s) => s.replace(/url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\)/gi, 'url()');

// ---------------------------------------------------------------------------
// HTML tokenizer + scrubber
// ---------------------------------------------------------------------------
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
// Elements whose content the HTML parser treats as raw text. Only <style> content survives.
const RAW_TAGS = new Set(['script', 'style', 'textarea', 'title', 'noscript', 'iframe', 'xmp', 'noembed', 'noframes', 'plaintext']);
// A scrubbed label found inside one of these is probably UI chrome worth offering for the vocabulary.
const CONTROL_TAGS = new Set(['button', 'label', 'legend', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'option', 'summary', 'a']);
const CONTROL_ROLES = new Set(['button', 'tab', 'menuitem', 'option', 'heading', 'combobox', 'link', 'columnheader', 'switch', 'checkbox', 'radio']);

const newStats = () => ({ text: { all: 0, part: 0, none: 0 }, labels: { all: 0, part: 0, none: 0 }, attrsShaped: {}, attrsDropped: 0, mediaRefsDropped: 0 });

// Parses one start tag beginning at html[lt] === '<'. Quote-aware, so a '>' inside an attribute value is not the end.
function parseStartTag(html, lt) {
    const n = html.length;
    let i = lt + 1;
    while (i < n && !/[\s/>]/.test(html[i])) i++;
    const rawName = html.slice(lt + 1, i);
    const attrs = [];
    for (;;) {
        while (i < n && /\s/.test(html[i])) i++;
        if (i >= n) throw new Error('unterminated start tag');
        if (html[i] === '>') return { rawName, attrs, selfClosing: false, end: i + 1 };
        if (html[i] === '/') {
            if (html[i + 1] === '>') return { rawName, attrs, selfClosing: true, end: i + 2 };
            i++; continue;
        }
        const a0 = i;
        while (i < n && !/[\s=/>]/.test(html[i])) i++;
        if (i === a0) { i++; continue; }   // stray '=' and the like
        const name = html.slice(a0, i);
        while (i < n && /\s/.test(html[i])) i++;
        let value = null;
        if (html[i] === '=') {
            i++;
            while (i < n && /\s/.test(html[i])) i++;
            const q = html[i];
            if (q === '"' || q === "'") {
                const e = html.indexOf(q, i + 1);
                if (e < 0) throw new Error('unterminated attribute value');
                value = html.slice(i + 1, e); i = e + 1;
            } else {
                const v0 = i;
                while (i < n && !/[\s>]/.test(html[i])) i++;
                value = html.slice(v0, i);
            }
        }
        attrs.push({ name, lname: name.toLowerCase(), value });
    }
}

function scrubAttrs(tag, attrs, ctx, stack) {
    const { vocab, deny, stats, review } = ctx;
    let out = '';
    const isMedia = MEDIA_TAGS.has(tag);
    const controlish = CONTROL_TAGS.has(tag) || attrs.some((a) => a.lname === 'role' && CONTROL_ROLES.has(String(a.value).toLowerCase())) || inControl(stack);
    for (const a of attrs) {
        const k = a.lname;
        if (k.startsWith('on')) { stats.attrsDropped++; continue; }                 // event handlers
        if (a.value === null) { out += ' ' + a.name; continue; }                    // bare boolean attribute
        const dec = decodeEntities(a.value);
        let val;
        if (k === 'class') val = dec;
        else if (k === 'style') val = scrubStyle(dec);
        else if (URL_ATTRS.has(k)) {
            if (isMedia || k === 'srcset') { stats.mediaRefsDropped++; continue; }  // the image parts are gone anyway
            val = scrubUrl(dec, ctx);
        } else if (tag === 'meta' && k === 'content') val = /^text\/html;\s*charset=[\w-]+$/i.test(dec.trim()) ? dec : shape(dec);
        else if (LABEL_ATTRS.has(k)) {
            const r = classifyLabel(dec, vocab, deny);
            if (HAS_ALNUM.test(dec)) { stats.labels[r.kept]++; if (r.kept === 'none' && review && (controlish || k !== 'value')) review.add(dec); }
            val = r.text;
        } else if (KEEP_ATTRS.has(k)) val = deny && deny.test(dec) ? shape(dec) : maskIds(dec);
        else { val = shape(dec); stats.attrsShaped[k] = (stats.attrsShaped[k] || 0) + 1; }
        out += ' ' + a.name + '="' + encodeAttr(val) + '"';
    }
    return out;
}

function inControl(stack) {
    for (let d = stack.length - 1, hops = 0; d >= 0 && hops < 4; d--, hops++) if (stack[d].control) return true;
    return false;
}

function scrubHtml(html, ctx) {
    ctx = Object.assign({ deny: null, keptLocations: new Set(), stats: newStats(), review: null }, ctx);
    const { vocab, deny, stats, review } = ctx;
    const n = html.length;
    const stack = [];
    let out = '';
    let i = 0;
    const text = (raw) => {
        if (!raw) return;
        if (!/\S/.test(raw)) { out += raw; return; }
        const dec = decodeEntities(raw);
        const top = stack[stack.length - 1];
        // An icon-font element's text is the icon's NAME ("signature", "close"), not content.
        if (top && top.icon && /^s*[a-z0-9_]{1,40}s*$/.test(dec) && !(deny && deny.test(dec))) { stats.text.all++; out += raw; return; }
        const r = classifyLabel(dec, vocab, deny);
        if (HAS_ALNUM.test(dec)) { stats.text[r.kept]++; if (r.kept === 'none' && review && inControl(stack)) review.add(dec); }
        out += encodeText(r.text);
    };
    while (i < n) {
        const lt = html.indexOf('<', i);
        if (lt < 0) { text(html.slice(i)); break; }
        if (lt > i) text(html.slice(i, lt));
        if (html.startsWith('<!--', lt)) {
            const e = html.indexOf('-->', lt + 4);
            if (e < 0) throw new Error('unterminated comment');
            out += '<!---->'; i = e + 3; continue;                      // keep the node, drop its text
        }
        if (html.startsWith('<![CDATA[', lt)) {
            const e = html.indexOf(']]>', lt + 9);
            if (e < 0) throw new Error('unterminated CDATA');
            text(html.slice(lt + 9, e)); i = e + 3; continue;
        }
        const c = html[lt + 1];
        if (c === '!' || c === '?') {
            const e = html.indexOf('>', lt);
            if (e < 0) throw new Error('unterminated declaration');
            out += /^<!doctype\s+html\s*>$/i.test(html.slice(lt, e + 1)) ? '<!DOCTYPE html>' : ''; i = e + 1; continue;
        }
        if (c === '/') {
            const e = html.indexOf('>', lt);
            if (e < 0) throw new Error('unterminated end tag');
            const rawName = html.slice(lt + 2, e).trim();
            const lname = rawName.toLowerCase();
            for (let d = stack.length - 1; d >= 0; d--) if (stack[d].name === lname) { stack.length = d; break; }
            out += '</' + rawName.replace(/[^\w:-]/g, '') + '>'; i = e + 1; continue;
        }
        if (!c || !/[a-zA-Z]/.test(c)) { out += '&lt;'; i = lt + 1; continue; }   // a literal '<'
        const t = parseStartTag(html, lt);
        const tag = t.rawName.toLowerCase();
        if (!/^[\w:-]+$/.test(t.rawName)) throw new Error('unexpected tag name');
        out += '<' + t.rawName + scrubAttrs(tag, t.attrs, ctx, stack) + (t.selfClosing ? '/>' : '>');
        i = t.end;
        if (t.selfClosing || VOID_TAGS.has(tag)) continue;
        if (RAW_TAGS.has(tag)) {
            const closeRx = new RegExp('</' + tag + '\\s*>', 'ig');
            closeRx.lastIndex = i;
            const close = closeRx.exec(html);
            if (!close) throw new Error('unterminated <' + tag + '>');
            const inner = html.slice(i, close.index);
            if (tag === 'style') out += inner;
            else if (tag === 'title') out += stack.some((s) => s.name === 'svg') ? '' : 'scrubbed capture';
            else if (tag === 'textarea' && /\S/.test(inner)) {
                const dec = decodeEntities(inner);
                const r = classifyLabel(dec, vocab, deny);
                if (HAS_ALNUM.test(dec)) stats.text[r.kept]++;
                out += encodeText(r.text);
            }
            out += '</' + t.rawName + '>';
            i = close.index + close[0].length;
            continue;
        }
        const role = t.attrs.find((a) => a.lname === 'role');
        const icon = t.attrs.some((a) => (a.lname === 'data-testid' && a.value === 'material-symbol') || (a.lname === 'class' && /(^|s)material-(symbols|icons)/.test(String(a.value))));
        stack.push({ name: tag, icon, control: CONTROL_TAGS.has(tag) || (!!role && CONTROL_ROLES.has(String(role.value).toLowerCase())) });
    }
    return out;
}

// Re-reads scrubbed HTML and counts places where a name token survived (class, style and <style> are not content).
function auditHtml(html, deny, where) {
    if (!deny) return 0;
    let hits = 0;
    const hit = (k) => { hits++; if (where) where[k] = (where[k] || 0) + 1; };
    let i = 0;
    const n = html.length;
    while (i < n) {
        const lt = html.indexOf('<', i);
        const chunk = html.slice(i, lt < 0 ? n : lt);
        if (chunk && deny.test(decodeEntities(chunk))) hit('text');
        if (lt < 0) break;
        if (html.startsWith('<!--', lt)) { i = html.indexOf('-->', lt) + 3; continue; }
        const c = html[lt + 1];
        if (c === '/' || c === '!') { i = html.indexOf('>', lt) + 1; continue; }
        const t = parseStartTag(html, lt);
        for (const a of t.attrs) if (a.value !== null && a.lname !== 'class' && a.lname !== 'style' && deny.test(decodeEntities(a.value))) hit('@' + a.lname);
        i = t.end;
        if (t.rawName.toLowerCase() === 'style') { const e = html.toLowerCase().indexOf('</style', i); i = e < 0 ? n : e; }
    }
    return hits;
}

function auditOrThrow(html, deny) {
    const where = {};
    const left = auditHtml(html, deny, where);
    if (left) throw new Error('audit: a name token survived in ' + left + ' place(s) [' + Object.entries(where).map(([k, v]) => k + ' x' + v).join(', ') + ']');
}

// ---------------------------------------------------------------------------
// Quoted-printable + MHTML container
// ---------------------------------------------------------------------------
function qpDecode(str) {
    const s = str.replace(/=\r?\n/g, '');
    const out = Buffer.alloc(s.length);
    let o = 0;
    for (let i = 0; i < s.length; i++) {
        const ch = s.charCodeAt(i);
        if (ch === 61 && /^[0-9A-Fa-f]{2}$/.test(s.substr(i + 1, 2))) { out[o++] = parseInt(s.substr(i + 1, 2), 16); i += 2; }
        else out[o++] = ch & 0xff;
    }
    return out.subarray(0, o);
}
function qpEncode(buf) {
    const lines = [];
    let line = '';
    const hex = (b) => '=' + (b < 16 ? '0' : '') + b.toString(16).toUpperCase();
    const flush = () => { lines.push(line.replace(/[ \t]$/, (m) => hex(m.charCodeAt(0)))); line = ''; };   // no bare trailing whitespace
    for (let i = 0; i < buf.length; i++) {
        const b = buf[i];
        if (b === 13 && buf[i + 1] === 10) { flush(); i++; continue; }
        if (b === 10) { flush(); continue; }
        const tok = (b >= 33 && b <= 126 && b !== 61) || b === 32 || b === 9 ? String.fromCharCode(b) : hex(b);
        if (line.length + tok.length > 72) { lines.push(line + '='); line = ''; }   // soft break, well inside the 76 limit
        line += tok;
    }
    flush();
    return lines.join('\r\n');
}

function parseHeaders(block) {
    const out = [];
    for (const raw of block.replace(/\r\n([ \t])/g, '$1').split('\r\n')) {
        const m = /^([!-9;-~]+):\s*(.*)$/.exec(raw);
        if (m) out.push({ name: m[1], lname: m[1].toLowerCase(), value: m[2] });
    }
    return out;
}
const header = (list, name) => { const h = list.find((x) => x.lname === name); return h ? h.value : ''; };

function parseMhtml(buf) {
    let s = buf.toString('latin1');
    if (s.indexOf('\r\n\r\n') < 0) s = s.replace(/\r?\n/g, '\r\n');
    const headEnd = s.indexOf('\r\n\r\n');
    if (headEnd < 0) throw new Error('not an MHTML file (no header block)');
    const headers = parseHeaders(s.slice(0, headEnd));
    const bm = /boundary="?([^";]+)"?/i.exec(header(headers, 'content-type'));
    if (!bm) throw new Error('not an MHTML file (no multipart boundary)');
    const chunks = s.slice(headEnd + 2).split('\r\n--' + bm[1]);
    const parts = [];
    for (let k = 1; k < chunks.length; k++) {
        if (chunks[k].startsWith('--')) break;   // closing delimiter
        const c = chunks[k].replace(/^\r\n/, '');
        const he = c.indexOf('\r\n\r\n');
        if (he < 0) throw new Error('malformed MHTML part');
        parts.push({ headers: parseHeaders(c.slice(0, he)), body: c.slice(he + 4) });
    }
    if (!parts.length) throw new Error('MHTML file has no parts');
    return { headers, boundary: bm[1], parts };
}
function decodePart(part) {
    const enc = header(part.headers, 'content-transfer-encoding').toLowerCase();
    if (enc === 'quoted-printable') return qpDecode(part.body);
    if (enc === 'base64') return Buffer.from(part.body.replace(/\s+/g, ''), 'base64');
    return Buffer.from(part.body, 'latin1');
}
const isCss = (ct) => /^text\/css\b/i.test(ct);
const isFont = (ct) => /^font\//i.test(ct) || /^application\/(x-)?font/i.test(ct) || /woff|opentype|truetype/i.test(ct);
const isHtml = (ct) => /^(text\/html|application\/xhtml\+xml)\b/i.test(ct);

// -> { out: Buffer, stats, parts: { html, css, font, dropped } }
function scrubMhtml(buf, ctx) {
    ctx = Object.assign({ deny: null, stats: newStats(), review: null }, ctx);
    const mh = parseMhtml(buf);
    const counts = { html: 0, css: 0, font: 0, dropped: 0 };
    // Stylesheets and fonts are static site assets: keep them, with their locations, so layout survives.
    const keptLocations = new Set();
    for (const p of mh.parts) {
        const ct = header(p.headers, 'content-type');
        const loc = header(p.headers, 'content-location');
        p.kind = isHtml(ct) ? 'html' : isCss(ct) ? 'css' : isFont(ct) ? 'font' : 'drop';
        if ((p.kind === 'css' || p.kind === 'font') && ctx.deny && ctx.deny.test(loc)) p.kind = 'drop';
        if (p.kind === 'css' || p.kind === 'font') keptLocations.add(loc);
    }
    const sub = Object.assign({}, ctx, { keptLocations });
    const outParts = [];
    for (const p of mh.parts) {
        counts[p.kind === 'drop' ? 'dropped' : p.kind]++;
        if (p.kind === 'drop') continue;
        const keep = ['content-type', 'content-id', 'content-transfer-encoding', 'content-location'];
        let headers = p.headers.filter((h) => keep.includes(h.lname));
        let body = p.body;
        if (p.kind === 'html') {
            const scrubbed = scrubHtml(decodePart(p).toString('utf8'), sub);
            auditOrThrow(scrubbed, ctx.deny);
            body = qpEncode(Buffer.from(scrubbed, 'utf8'));
            headers = headers.filter((h) => h.lname !== 'content-transfer-encoding').map((h) => (h.lname === 'content-location' ? Object.assign({}, h, { value: scrubUrl(h.value, sub) }) : h));
            headers.push({ name: 'Content-Transfer-Encoding', lname: 'content-transfer-encoding', value: 'quoted-printable' });
        }
        outParts.push(headers.map((h) => h.name + ': ' + h.value).join('\r\n') + '\r\n\r\n' + body);
    }
    const date = header(mh.headers, 'date');
    const top = [
        'From: <Saved by Blink>',
        'Snapshot-Content-Location: ' + scrubUrl(header(mh.headers, 'snapshot-content-location'), sub),
        'Subject: scrubbed capture',
    ];
    if (/^[A-Za-z0-9 ,:+()-]+$/.test(date)) top.push('Date: ' + date);
    top.push('MIME-Version: 1.0', 'Content-Type: multipart/related;\r\n\ttype="text/html";\r\n\tboundary="' + mh.boundary + '"');
    const file = top.join('\r\n') + '\r\n\r\n' + outParts.map((p) => '--' + mh.boundary + '\r\n' + p + '\r\n').join('') + '--' + mh.boundary + '--\r\n';
    return { out: Buffer.from(file, 'latin1'), stats: ctx.stats, parts: counts };
}

// ---------------------------------------------------------------------------
// Filenames: where the patient's name is, and what the clean copy is called.
// ---------------------------------------------------------------------------
// Words that describe a capture rather than name a person, for raw files that do not follow "<Name> Chart Note_<description>".
const DESCRIPTOR_WORDS = new Set(['dom', 'chart', 'note', 'notes', 'capture', 'html', 'mhtml', 'athelas', 'insights', 'calendar', 'daily', 'progress', 'initial', 'eval', 'evaluation', 'compact', 'phase', 'example', 'screenshot', 'copy']);
const MARKER = /chart[ _-]?note/i;

function nameTokens(rawName) {
    const base = rawName.replace(/\.[A-Za-z0-9]+$/, '');
    const m = MARKER.exec(base);
    const words = (s) => (s.match(/\p{L}+/gu) || []).map((w) => w.toLowerCase());
    const toks = m ? words(base.slice(0, m.index)) : words(base).filter((w) => !DESCRIPTOR_WORDS.has(w));
    return [...new Set(toks.filter((w) => w.length >= 2 && !(m && DESCRIPTOR_WORDS.has(w))))];
}
function denyRegex(tokens) {
    if (!tokens.length) return null;
    return new RegExp('(?<![\\p{L}])(?:' + tokens.map(rxEscape).join('|') + ')(?![\\p{L}])', 'iu');
}
function cleanName(rawName, mtime, taken) {
    const ext = /\.html?$/i.test(rawName) ? '.html' : '.mhtml';
    const base = rawName.replace(/\.[A-Za-z0-9]+$/, '');
    const m = MARKER.exec(base);
    // Only the description AFTER "Chart Note" is reused; long digit runs could be a record number, so they go too.
    let slug = m ? base.slice(m.index + m[0].length).toLowerCase().replace(/\d{4,}/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') : '';
    if (!slug) slug = m ? 'chart_note' : 'capture';
    const d = new Date(mtime);
    const date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    let name = date + '_' + slug + ext;
    for (let k = 2; taken.has(name.toLowerCase()); k++) name = date + '_' + slug + '-' + k + ext;
    return name;
}

// ---------------------------------------------------------------------------
// Batch driver
// ---------------------------------------------------------------------------
function scrubFile(rawPath, vocab, review) {
    const rawName = path.basename(rawPath);
    const deny = denyRegex(nameTokens(rawName));
    const buf = fs.readFileSync(rawPath);
    const ctx = { vocab, deny, stats: newStats(), review };
    if (/\.html?$/i.test(rawName)) {
        const scrubbed = scrubHtml(buf.toString('utf8'), ctx);
        auditOrThrow(scrubbed, deny);
        return { out: Buffer.from(scrubbed, 'utf8'), stats: ctx.stats, parts: { html: 1, css: 0, font: 0, dropped: 0 } };
    }
    return scrubMhtml(buf, ctx);
}

function run(opts) {
    const rawDir = opts.raw || DEFAULT_RAW;
    const outDir = opts.out || DEFAULT_OUT;
    const result = { scrubbed: [], failed: 0, skipped: 0, missingRawDir: false, stats: newStats(), parts: { html: 0, css: 0, font: 0, dropped: 0 } };
    if (!fs.existsSync(rawDir)) { result.missingRawDir = true; return result; }
    const vocab = opts.vocab || loadVocabulary();
    const manifestPath = path.join(rawDir, MANIFEST);
    let manifest = { version: SCRUBBER_VERSION, vocab: vocab.hash, files: {} };
    try { manifest = Object.assign(manifest, JSON.parse(fs.readFileSync(manifestPath, 'utf8'))); } catch (e) { /* first run */ }
    const stale = opts.all || manifest.version !== SCRUBBER_VERSION || manifest.vocab !== vocab.hash;   // new rules: redo everything
    manifest.version = SCRUBBER_VERSION; manifest.vocab = vocab.hash;
    const taken = new Set(Object.values(manifest.files).map((f) => String(f.clean).toLowerCase()));
    const review = new Map();
    const reviewAdd = { add: (s) => { const k = s.replace(/\s+/g, ' ').trim(); if (k && k.length <= 60) review.set(k, (review.get(k) || 0) + 1); } };
    const errors = [];
    fs.mkdirSync(outDir, { recursive: true });
    const names = fs.readdirSync(rawDir).filter((f) => /\.(mhtml|mht|html?)$/i.test(f) && !f.startsWith('_')).sort();
    for (const name of names) {
        const full = path.join(rawDir, name);
        const st = fs.statSync(full);
        const prev = manifest.files[name];
        const same = prev && prev.size === st.size && prev.mtimeMs === st.mtimeMs;
        const unchanged = same && (prev.ok ? fs.existsSync(path.join(outDir, prev.clean)) : true);   // a known failure is not retried until the file changes
        if (unchanged && !stale) { result.skipped++; continue; }
        const clean = prev ? prev.clean : cleanName(name, st.mtimeMs, taken);
        taken.add(clean.toLowerCase());
        try {
            const r = scrubFile(full, vocab, reviewAdd);
            fs.writeFileSync(path.join(outDir, clean), r.out);
            manifest.files[name] = { clean, size: st.size, mtimeMs: st.mtimeMs, ok: true };
            result.scrubbed.push(clean);
            for (const k of ['all', 'part', 'none']) { result.stats.text[k] += r.stats.text[k]; result.stats.labels[k] += r.stats.labels[k]; }
            for (const [k, v] of Object.entries(r.stats.attrsShaped)) result.stats.attrsShaped[k] = (result.stats.attrsShaped[k] || 0) + v;
            for (const k of Object.keys(result.parts)) result.parts[k] += r.parts[k];
        } catch (e) {
            // Fail closed: no clean copy is written, and one left by an earlier run under older rules is withdrawn.
            try { fs.unlinkSync(path.join(outDir, clean)); } catch (err) { /* there was none */ }
            manifest.files[name] = { clean, size: st.size, mtimeMs: st.mtimeMs, ok: false };
            errors.push(name + ' -> ' + clean + ': ' + (e && e.message));
            result.failed++;
        }
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    if (result.scrubbed.length || errors.length) {
        const top = [...review.entries()].sort((a, b) => b[1] - a[1]).slice(0, 400);
        fs.writeFileSync(path.join(rawDir, REVIEW), [
            '# Labels the scrubber REMOVED, most frequent first. This file contains raw page text - it stays in this folder.',
            '# If a line is plain app chrome (a button, tab or field label - never a name), copy it into',
            '# scripts/scrub-vocabulary.txt in the repo and it will be kept from then on.',
            '',
            ...(errors.length ? ['# COULD NOT SCRUB (no clean copy was written):', ...errors.map((e) => '#   ' + e), ''] : []),
            ...top.map(([k, v]) => v + '\t' + k),
            '',
        ].join('\n'));
    }
    return result;
}

function main(argv) {
    const opts = { all: argv.includes('--all'), hook: argv.includes('--hook'), verbose: argv.includes('--verbose') };
    for (const k of ['raw', 'out']) { const i = argv.indexOf('--' + k); if (i >= 0) opts[k] = path.resolve(argv[i + 1]); }
    let r;
    try { r = run(opts); } catch (e) {
        if (opts.hook) return;                     // never block a prompt on a tooling error
        console.error('scrub failed: ' + (e && e.message)); process.exitCode = 1; return;
    }
    const where = path.relative(REPO, opts.out || DEFAULT_OUT).replace(/\\/g, '/') || '.';
    if (opts.hook) {
        if (!r.scrubbed.length && !r.failed) return;   // nothing new: say nothing
        const lines = [];
        if (r.scrubbed.length) lines.push('New scrubbed capture(s) are ready to read: ' + r.scrubbed.map((f) => where + '/' + f).join(', ') + '.');
        if (r.failed) lines.push(r.failed + ' raw capture(s) could not be scrubbed safely, so no clean copy exists for them. Do not open the raw folder; tell the user to look at ' + REVIEW + ' there.');
        process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: lines.join(' ') } }));
        return;
    }
    if (r.missingRawDir) { console.log('raw capture folder not found - nothing to do'); return; }
    console.log('scrubbed ' + r.scrubbed.length + ', unchanged ' + r.skipped + ', failed ' + r.failed);
    for (const f of r.scrubbed) console.log('  ' + where + '/' + f);
    const t = r.stats.text, l = r.stats.labels;
    console.log('text nodes   kept ' + t.all + ' | label kept, value scrubbed ' + t.part + ' | scrubbed ' + t.none);
    console.log('label attrs  kept ' + l.all + ' | partly ' + l.part + ' | scrubbed ' + l.none);
    console.log('parts        html ' + r.parts.html + ' | css ' + r.parts.css + ' | font ' + r.parts.font + ' | dropped ' + r.parts.dropped);
    if (opts.verbose) console.log('attributes scrubbed by name: ' + Object.entries(r.stats.attrsShaped).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' x' + v).join(', '));
    if (r.failed) { console.log('some captures failed closed - see ' + REVIEW + ' in the raw folder'); process.exitCode = 2; }
}

module.exports = {
    SCRUBBER_VERSION, parseVocabulary, loadVocabulary, shape, classifyLabel, decodeEntities, scrubUrl, scrubHtml, auditHtml,
    qpEncode, qpDecode, parseMhtml, scrubMhtml, nameTokens, denyRegex, cleanName, run, newStats,
};
if (require.main === module) main(process.argv.slice(2));
