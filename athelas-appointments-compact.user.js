// ==UserScript==
// @name         Athelas Insights - Compact Mode + Chart Note Helpers
// @namespace    https://insights.athelas.com/
// @version      15.13.0
// @description  Compact spacing for Appointments / Chart Note; jump-to-Flowsheet on load; Fix Procedures (move interventions to their correct CPT code) incl. MET; Fix Private Pay. Verbose logging.
// @author       Ben
// @match        https://insights.athelas.com/*
// @run-at       document-start
// @grant        GM_addStyle
// @grant        window.onurlchange
// ==/UserScript==

(function () {
    'use strict';

    // v15.9: Athelas is a single-page app. Rather than @match only the two
    // deep URLs (which meant the script never injected when the tab first
    // loaded on a non-matching URL and then client-side-navigated in), we now
    // @match the whole domain and decide what to do per-navigation from the
    // CURRENT pathname. pageType() is re-evaluated on every route change.
    function pageType() {
        const p = location.pathname;
        return {
            isAppointments: p.startsWith('/v3/appointments'),
            isChartNote: /^\/ehr\/v2\/patients\/[^/]+\/appointments\//.test(p),
        };
    }
    // Fire `cb` whenever the SPA changes the URL without a full reload. Combines
    // Tampermonkey's native window.onurlchange (when granted), History API hooks
    // (pushState/replaceState), popstate (back/forward), and a slow poll as a
    // catch-all. Works identically under the Chrome-extension MAIN-world build.
    function onUrlChange(cb) {
        let last = location.href;
        const fire = () => { if (location.href !== last) { last = location.href; try { cb(); } catch (e) {} } };
        try { window.addEventListener('urlchange', fire); } catch (e) {}   // TM native (no-op if unsupported)
        for (const m of ['pushState', 'replaceState']) {
            const orig = history[m];
            if (typeof orig === 'function' && !orig.__athelasPatched) {
                const patched = function () { const r = orig.apply(this, arguments); fire(); return r; };
                patched.__athelasPatched = true;
                try { history[m] = patched; } catch (e) {}
            }
        }
        window.addEventListener('popstate', fire);
        setInterval(fire, 600);   // safety net for SPAs that stash the original History refs
    }
    // v14.15: calendar support removed entirely (dead since v11 - the page
    // ships its own in-product compact toggle, so the script did nothing there).

    // =====================================================================
    // Shared logging helpers
    // =====================================================================
    function makeLogger(tag) {
        const prefix = `[athelas:${tag}]`;
        const fmt = (lvl) => (...args) => console[lvl](prefix, ...args);
        return { log: fmt('log'), info: fmt('info'), warn: fmt('warn'), error: fmt('error'), debug: fmt('debug'), group: (label) => console.groupCollapsed(prefix, label), groupEnd: () => console.groupEnd() };
    }

    // =====================================================================
    // Shared DOM helpers (used by multiple modules)
    // =====================================================================

    /** Poll for selector via MutationObserver. Returns the element or null on timeout. */
    function waitFor(selector, { root = document, timeoutMs = 15000, log } = {}) {
        return new Promise((resolve) => {
            const existing = root.querySelector(selector);
            if (existing) { log && log.log(`waitFor("${selector}") -> already in DOM`); return resolve(existing); }
            log && log.log(`waitFor("${selector}") -> waiting (timeout ${timeoutMs}ms)`);
            let timeoutId = null;
            const obs = new MutationObserver(() => {
                const el = root.querySelector(selector);
                if (el) {
                    obs.disconnect();
                    if (timeoutId) clearTimeout(timeoutId);
                    log && log.log(`waitFor("${selector}") -> resolved`);
                    resolve(el);
                }
            });
            obs.observe(root === document ? document.documentElement : root, { childList: true, subtree: true });
            timeoutId = setTimeout(() => {
                obs.disconnect();
                log && log.warn(`waitFor("${selector}") -> TIMEOUT`);
                resolve(null);
            }, timeoutMs);
        });
    }

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    /** Click via a dispatched MouseEvent with simulated=true (same pattern as Ben's Hippo
     *  script). Falls back to native .click() if dispatch returns false.
     *
     *  NOTE: do NOT pass `view: window` to MouseEvent under Tampermonkey - the script's
     *  `window` is a sandboxed proxy, not a real Window, and the MouseEvent constructor
     *  rejects it with `Failed to convert value to 'Window'`. bubbles+cancelable are
     *  sufficient for React onClick handlers to fire. */
    function simulateClick(el, log) {
        if (!el) { log && log.warn('simulateClick: element is null'); return false; }
        // Always run the native click first - it's the most reliable path for MUI buttons
        // and won't throw under a sandboxed window. Dispatch the MouseEvent afterwards
        // for handlers that listen for the synthetic event specifically.
        let nativeOk = false;
        try {
            if (typeof el.click === 'function') {
                el.click();
                nativeOk = true;
                log && log.log('simulateClick: native .click() called');
            }
        } catch (err) {
            log && log.error('simulateClick: native .click() threw', err);
        }
        try {
            const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
            ev.simulated = true; // React15 used this; harmless otherwise
            const dispatched = el.dispatchEvent(ev);
            log && log.log(`simulateClick: dispatched MouseEvent -> defaultPrevented=${ev.defaultPrevented}, dispatched=${dispatched}`, el);
            return true;
        } catch (err) {
            log && log.error('simulateClick: dispatch threw', err);
            return nativeOk;
        }
    }

    /** Set a controlled <input>/<textarea> value in a way React/MUI will accept.
     *  React 16+ intercepts the native value setter via a "valueTracker". If you just
     *  do `el.value = x`, React reads the old tracked value, compares against the new
     *  one, and decides nothing changed -> no re-render. Calling the *native* setter
     *  bypasses the tracker. Then we fire input + change so React's onChange runs. */
    function setReactValue(el, value, log) {
        if (!el) { log && log.warn('setReactValue: element is null'); return false; }
        try {
            el.focus();
            const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
            const before = el.value;
            setter.call(el, value);
            const ev1 = new Event('input', { bubbles: true });
            ev1.simulated = true;
            el.dispatchEvent(ev1);
            const ev2 = new Event('change', { bubbles: true });
            ev2.simulated = true;
            el.dispatchEvent(ev2);
            log && log.log(`setReactValue: "${before}" -> "${el.value}" (requested "${value}")`, el);
            // If React wiped it back (controlled component reverting), retry the
            // simpler heno-style approach as a sanity check.
            if (el.value !== value) {
                log && log.warn(`setReactValue: React appears to have reverted the value. Trying plain assignment as fallback.`);
                el.value = value;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                log && log.log(`setReactValue (fallback): "${el.value}"`);
            }
            return el.value === value;
        } catch (err) {
            log && log.error('setReactValue: threw', err);
            return false;
        }
    }

    /** Set Tiptap/ProseMirror contenteditable content via the clipboard-paste path
     *  (Tiptap listens to beforeinput / paste). execCommand is deprecated but still
     *  the easiest path that Tiptap reliably intercepts. */
    function setProseMirrorText(el, value, log) {
        if (!el) { log && log.warn('setProseMirrorText: element is null'); return false; }
        try {
            el.focus();
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(el);
            sel.removeAllRanges();
            sel.addRange(range);
            const ok = document.execCommand('insertText', false, value);
            log && log.log(`setProseMirrorText: execCommand returned ${ok}, current text now: "${el.textContent.slice(0,80)}..."`);
            return ok;
        } catch (err) {
            log && log.error('setProseMirrorText: threw', err);
            return false;
        }
    }

    // =====================================================================
    // Persistent row-highlight helper. Shared by featureAutofillInterventions
    // (highlights newly-filled rows) and featureMoveToBottom (highlights
    // already-checked rows the user queued).
    //
    // The highlight survives for the rest of the session: a MutationObserver
    // re-applies the inline backgroundColor by data-id whenever MUI swaps the
    // row element during a re-render. Identifying rows by id (not by element
    // reference) makes the highlight outlive React reconciliation cycles.
    // =====================================================================
    const HIGHLIGHT_COLOR = '#ffeaa7';                 // warm yellow
    const HIGHLIGHT_RGB   = 'rgb(255, 234, 167)';      // computed form for comparison
    const highlightedIds = new Set();
    let highlightObserver = null;
    const highlightLogger = makeLogger('highlight');

    function applyHighlights() {
        for (const id of highlightedIds) {
            const row = document.querySelector(`.MuiDataGrid-row[data-id="${id}"]`);
            if (row && row.style.backgroundColor !== HIGHLIGHT_RGB) {
                row.style.transition = 'background-color 0.4s ease';
                row.style.backgroundColor = HIGHLIGHT_COLOR;
            }
        }
    }
    function startHighlightObserver() {
        if (highlightObserver) return;
        const grid = document.querySelector('.MuiDataGrid-root');
        if (!grid) {
            // Grid not in DOM yet - try again on next mutation of body.
            const bootObs = new MutationObserver(() => {
                if (document.querySelector('.MuiDataGrid-root')) {
                    bootObs.disconnect();
                    startHighlightObserver();
                    applyHighlights();
                }
            });
            if (document.body) bootObs.observe(document.body, { childList: true, subtree: true });
            return;
        }
        highlightObserver = new MutationObserver(applyHighlights);
        highlightObserver.observe(grid, { childList: true, subtree: true });
        highlightLogger.log('persistent highlight observer attached to grid');
    }
    function markRowHighlighted(id, reason = '') {
        if (!id) return;
        if (highlightedIds.has(id)) return;
        highlightedIds.add(id);
        highlightLogger.log(`marked row data-id=${id} for persistent highlight${reason ? ' ('+reason+')' : ''}; total: ${highlightedIds.size}`);
        startHighlightObserver();
        applyHighlights();
    }
    function clearAllHighlights() {
        for (const id of highlightedIds) {
            const row = document.querySelector(`.MuiDataGrid-row[data-id="${id}"]`);
            if (row) row.style.backgroundColor = '';
        }
        highlightedIds.clear();
        if (highlightObserver) { highlightObserver.disconnect(); highlightObserver = null; }
        highlightLogger.log('all highlights cleared');
    }
    // DevTools helpers
    window.__athelasHighlight = markRowHighlighted;
    window.__athelasClearHighlights = clearAllHighlights;
    window.__athelasHighlightedIds = highlightedIds;

    /** Toggle an MUI Checkbox to a target state.
     *
     *  MUI Checkbox structure: a <span class="MuiCheckbox-root MuiButtonBase-root">
     *  wrapper that holds the click handler, containing a hidden
     *  <input type="checkbox" class="PrivateSwitchBase-input"> positioned absolutely
     *  over the wrapper. The hidden input is what the user visually clicks (it has
     *  opacity:0 covering the full wrapper) - but for synthetic clicks we usually
     *  need to target the wrapper, because MUI installs its onClick there and the
     *  input itself often has e.stopPropagation/preventDefault from React's controlled
     *  component plumbing.
     *
     *  We try three strategies in order, with a small async settle so React has time
     *  to re-render and reflect the new checked state in the input's DOM property. */
    async function ensureChecked(input, shouldBeChecked, log) {
        if (!input) { log && log.warn('ensureChecked: input is null'); return false; }
        const target = !!shouldBeChecked;
        if (!!input.checked === target) {
            log && log.log(`ensureChecked: already ${target}, no action`);
            return true;
        }

        // Strategy 1: click the MUI wrapper span (most reliable on MUI 5+).
        const wrapper = input.closest('.MuiCheckbox-root, .PrivateSwitchBase-root');
        if (wrapper && wrapper !== input) {
            log && log.log('ensureChecked: strategy 1 - click MUI wrapper span', wrapper);
            simulateClick(wrapper, log);
            await sleep(150);
            if (!!input.checked === target) { log && log.log(`  strategy 1 worked, checked=${input.checked}`); return true; }
        }

        // Strategy 2: click the input directly (what we did before; some MUI versions
        // wire onChange on the input itself).
        log && log.log('ensureChecked: strategy 2 - click input directly');
        simulateClick(input, log);
        await sleep(150);
        if (!!input.checked === target) { log && log.log(`  strategy 2 worked, checked=${input.checked}`); return true; }

        // Strategy 3: bypass via the native `checked` setter + dispatch click + change.
        // This is the React-controlled-component analogue of setReactValue.
        log && log.log('ensureChecked: strategy 3 - native setter + dispatch click/change');
        try {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked').set;
            setter.call(input, target);
            input.dispatchEvent(new Event('click',  { bubbles: true }));
            input.dispatchEvent(new Event('input',  { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (err) {
            log && log.error('ensureChecked: strategy 3 threw', err);
        }
        await sleep(150);
        if (!!input.checked === target) { log && log.log(`  strategy 3 worked, checked=${input.checked}`); return true; }

        log && log.warn(`ensureChecked: ALL STRATEGIES FAILED. final checked=${input.checked}, aria-checked=${input.getAttribute('aria-checked')}`);
        // Tell the user where to look next.
        log && log.warn('  Try inspecting the wrapper and looking for onClick / onChange handlers.');
        return false;
    }


    // =====================================================================
    // SHARED: Procedure-matching engine.
    // The therapist's canonical rules from "Stuff for EMR.xlsx" + markup.
    // Used by BOTH the Fix Procedures button (MODULE 9) and the read-only
    // preview (MODULE 10). This is the single source of truth in the script;
    // keep it in sync with redesign/procedure-matching.js.
    //
    // Proc.resolveProcedure(name) -> null            (no rule; leave alone)
    //   | { label, exclude:true }                    (matched an "leave alone" rule)
    //   | { label, code, justification, justMode, rename }
    //     code       target CPT ('97110'|'97112'|'97530')
    //     justMode   'replace' (MET) | 'append' (canonical text) | 'none' (move only)
    //     rename     new name to set first (e.g. Rib -> "MET - Rib"), else null
    // First matching rule wins; order is deliberate.
    // =====================================================================
    const Proc = (function () {
        const normProc = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
        const _has = (n, ...toks) => toks.every((t) => n.includes(t));
        const _word = (n, w) => new RegExp('\\b' + w + '\\b').test(n);
        const J = {
            toilet: 'Improve toilet transfers',
            bedxfer: 'Improved transfers on and off the bed',
            stairs: 'Improve stair climbing ability',
            squatrec: 'Improve ablity to squat and recover',
            yardwork: 'Functional training for yard/house work',
            extremity: 'To restore normal function of extremity',
            bedcore: 'To assist with bed mobility and assist with core stabilty during functional tasks',
            gluteMed: 'Verbal and tactile cues to glute med for upright posture',
            rom: 'To assist with pain free range of motion and restore normal function',
        };
        const metDescriptor = (name) => {
            let x = (name || '').trim();
            x = x.replace(/^\s*muscle\s*energy\s*technique\s*(\(met\))?\s*[:\-]?\s*/i, '');   // spelled-out prefix (+ optional "(MET)")
            x = x.replace(/^\s*met\b[\s:\-]*/i, '');                                          // abbreviated prefix
            x = x.replace(/^[\s\-:()]+|[\s\-:()]+$/g, '').trim();                              // trim stray wrapping punctuation
            return x;
        };
        const isJunkMET = (name) => { const x = metDescriptor(name); if (!x) return false; if (/\s/.test(x)) return false; return /\d/.test(x) || !/[aeiou]/i.test(x); };
        const metJustification = (name) => {
            const tail = 'with tactile and vc to help facilitate proper proprioception and posture.';
            const rest = metDescriptor(name);
            if (!rest) return 'Muscle energy technique applied, ' + tail;
            const hasConn = /^(to|for|at|of|on|in|with|toward|towards)\b/i.test(rest);
            return 'Muscle energy technique applied ' + (hasConn ? rest : 'to ' + rest) + ', ' + tail;
        };
        const RULES = [
            { label: 'Cable column', code: '97530', just: J.yardwork, justMode: 'append', test: (n) => _has(n, 'cable column') },
            { label: 'TKE (leave alone)', exclude: true, test: (n) => _word(n, 'tke') || _has(n, 'terminal knee extension') },
            { label: 'Bridges (under review — left alone)', exclude: true, test: (n) => _word(n, 'bridge') || _word(n, 'bridges') },
            { label: 'Curtsey step → balance (leave alone)', exclude: true, test: (n) => _has(n, 'curtsey') && _has(n, 'step') && _has(n, 'single leg balance') },
            { label: 'Anterior step → balance (97530)', code: '97530', justMode: 'none', test: (n) => _has(n, 'anterior') && _has(n, 'step') && _has(n, 'single leg balance') },
            { label: 'Rib -> MET - Rib', code: '97112', justMode: 'replace', met: true, rename: 'MET - Rib', test: (n) => _has(n, 'rib mobilization') && !_has(n, 'first rib') },
            { label: 'MET', code: '97112', justMode: 'replace', met: true, test: (n) => (_word(n, 'met') || _has(n, 'muscle energy')) },
            { label: 'Balance', code: '97112', just: J.gluteMed, justMode: 'append', test: (n) => _has(n, 'tandem') || _has(n, 'airex') || _has(n, 'bosu') || _has(n, 'balance') },
            { label: 'Lunge Hip Flexion Stretch', code: '97110', justMode: 'none', test: (n) => _has(n, 'lunge') && _has(n, 'hip flexion stretch') },
            { label: 'Lunge', code: '97530', just: J.squatrec, justMode: 'append', test: (n) => _has(n, 'lunge') },
            { label: 'Squat', code: '97530', just: J.squatrec, justMode: 'append', test: (n) => _has(n, 'squat') || _has(n, 'wall sit') },
            { label: 'Step up', code: '97530', just: J.stairs, justMode: 'append', test: (n) => _has(n, 'step up') },
            { label: 'Step down', code: '97530', just: J.stairs, justMode: 'append', test: (n) => _has(n, 'step down') },
            { label: 'Sit to Stand', code: '97530', just: J.toilet, justMode: 'append', test: (n) => _has(n, 'sit to stand') },
            { label: 'Sit to Supine', code: '97530', just: J.bedxfer, justMode: 'append', test: (n) => _has(n, 'sit to supine') },
            { label: 'Matrix', code: '97530', just: J.extremity, justMode: 'append', test: (n) => _word(n, 'matrix') },
            { label: 'Curl', code: '97110', justMode: 'none', test: (n) => _has(n, 'curl') },
            { label: 'PROM', code: '97110', just: J.rom, justMode: 'append', test: (n) => _word(n, 'prom') || (_has(n, 'passive') && _has(n, 'range') && _has(n, 'motion')) },
            { label: 'Long Arc Quad', code: '97110', justMode: 'none', test: (n) => _has(n, 'long arc quad') || _word(n, 'laq') },
            { label: 'Short Arc Quad', code: '97110', justMode: 'none', test: (n) => _has(n, 'short arc quad') || _word(n, 'saq') },
            { label: 'Genu Articularis', code: '97110', justMode: 'none', test: (n) => _has(n, 'genu articularis') },
            { label: 'Scapular Retraction', code: '97110', justMode: 'none', test: (n) => _has(n, 'scapular retraction') },
            { label: 'Straight Leg Raise', code: '97110', justMode: 'none', test: (n) => _has(n, 'straight leg raise') || _word(n, 'slr') },
            { label: 'Shoulder Abduction', code: '97110', justMode: 'none', test: (n) => _has(n, 'shoulder abduction') },
            { label: 'Shoulder Extension', code: '97110', justMode: 'none', test: (n) => _has(n, 'shoulder extension') && !_has(n, 'd2') && !_has(n, 'split squat') && !_has(n, 'step up') && !_has(n, 'posterior sling') && !_has(n, 'plank') },
            { label: 'Stretch', code: '97110', justMode: 'none', test: (n) => _has(n, 'stretch') && !_has(n, 'hip shifting') },
        ];
        const resolveProcedure = (name) => {
            const n = normProc(name);
            for (const r of RULES) {
                if (!r.test(n)) continue;
                if (r.exclude) return { label: r.label, exclude: true };
                if (r.met && isJunkMET(name)) return null;
                // For MET (and Rib->"MET - Rib"), the justification is spliced from the
                // FINAL name (after any rename). Otherwise use the canonical text.
                const finalName = r.rename || name;
                const justification = r.met ? metJustification(finalName) : (r.just || null);
                return { label: r.label, code: r.code, justification, justMode: r.justMode, rename: r.rename || null };
            }
            return null;
        };
        return { normProc, resolveProcedure, metJustification, isJunkMET, RULES, J };
    })();


    // =====================================================================
    // SHARED UI: progress toast + move-confirmation dialog (v15.12).
    // Pure DOM, no dependencies. Used by the Fix Procedures / Fix Private Pay
    // movers so a therapist can review every change before it runs and watch
    // what's happening while it runs.
    // =====================================================================
    function athEnsureToastHost() {
        let host = document.getElementById('athelas-toast-host');
        if (!host) {
            host = document.createElement('div');
            host.id = 'athelas-toast-host';
            Object.assign(host.style, {
                position: 'fixed', right: '16px', bottom: '16px', zIndex: '2147483647',
                display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end',
                pointerEvents: 'none', maxWidth: '380px',
            });
            (document.body || document.documentElement).appendChild(host);
        }
        return host;
    }
    // Fading, non-interactive bubble in the lower-right. Returns {update, done}.
    function athToast(text, opts) {
        opts = opts || {};
        const b = document.createElement('div');
        b.textContent = text;
        Object.assign(b.style, {
            background: 'rgba(28,28,38,0.92)', color: '#fff',
            font: '500 12.5px/1.35 system-ui, sans-serif', padding: '8px 12px',
            borderRadius: '8px', boxShadow: '0 4px 14px rgba(0,0,0,0.28)',
            opacity: '0', transform: 'translateY(6px)',
            transition: 'opacity .18s ease, transform .18s ease',
            pointerEvents: 'none', whiteSpace: 'normal', wordBreak: 'break-word',
        });
        athEnsureToastHost().appendChild(b);
        requestAnimationFrame(() => { b.style.opacity = '1'; b.style.transform = 'translateY(0)'; });
        let timer = null;
        const fade = () => { b.style.opacity = '0'; b.style.transform = 'translateY(6px)'; setTimeout(() => b.remove(), 240); };
        const arm = (ms) => { if (timer) clearTimeout(timer); if (ms > 0) timer = setTimeout(fade, ms); };
        if (opts.ttl !== 0) arm(opts.ttl || 2600);
        return {
            update: (t) => { b.textContent = t; if (opts.ttl !== 0) arm(opts.ttl || 2600); },
            done: (ms) => { arm(ms == null ? 900 : ms); },
        };
    }

    // Modal listing every pending change with two checkboxes per row (move,
    // justification). Resolves to { confirmed, decisions:[{...row, moveChecked,
    // justChecked}] }. rows: { name, fromLabel, toLabel, willMove, willJust,
    // oldJust, newJust, renameTo }.
    function athConfirmMoves(title, rows) {
        return new Promise((resolve) => {
            const stop = (fn) => (ev) => { ev.preventDefault(); ev.stopPropagation(); fn(); };
            const overlay = document.createElement('div');
            Object.assign(overlay.style, {
                position: 'fixed', inset: '0', zIndex: '2147483646', background: 'rgba(0,0,0,0.45)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px',
            });
            const modal = document.createElement('div');
            Object.assign(modal.style, {
                background: '#fff', color: '#1a1a1a', borderRadius: '10px', maxWidth: '920px',
                width: '100%', maxHeight: '84vh', display: 'flex', flexDirection: 'column',
                overflow: 'hidden', boxShadow: '0 12px 40px rgba(0,0,0,0.35)', font: '13px/1.4 system-ui, sans-serif',
            });
            const head = document.createElement('div');
            Object.assign(head.style, { padding: '14px 18px', borderBottom: '1px solid #e5e5e5' });
            const h = document.createElement('div'); h.textContent = title;
            Object.assign(h.style, { font: '600 15px system-ui, sans-serif' });
            const sub = document.createElement('div');
            sub.textContent = rows.length + ' change' + (rows.length === 1 ? '' : 's') + ' to review. Uncheck anything you do not want, then Apply.';
            Object.assign(sub.style, { marginTop: '3px', color: '#666', fontSize: '12px' });
            head.appendChild(h); head.appendChild(sub);

            const body = document.createElement('div');
            Object.assign(body.style, { overflow: 'auto', padding: '2px 8px 6px' });
            const table = document.createElement('table');
            Object.assign(table.style, { width: '100%', borderCollapse: 'collapse' });
            const thr = document.createElement('tr');
            [['Procedure', '26%'], ['', '34px'], ['Movement', 'auto'], ['', '34px'], ['Justification', '38%']].forEach(([t, w]) => {
                const th = document.createElement('th'); th.textContent = t; th.style.width = w;
                Object.assign(th.style, { textAlign: 'left', padding: '7px 10px', position: 'sticky', top: '0', background: '#fafafa', borderBottom: '1px solid #e5e5e5', fontSize: '11px', color: '#888', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '.03em' });
                thr.appendChild(th);
            });
            table.appendChild(thr);

            // A checkbox when the change is applicable, otherwise a greyed-out ✕ so
            // it's obvious the box cannot be checked.
            function mkCheck(applicable) {
                if (applicable) { const c = document.createElement('input'); c.type = 'checkbox'; c.checked = true; c.style.cursor = 'pointer'; return c; }
                const x = document.createElement('span'); x.textContent = '✕'; x.title = 'no change — nothing to apply';
                Object.assign(x.style, { color: '#c4c4c4', fontWeight: '700', fontSize: '13px', display: 'inline-block' });
                return x;
            }

            const state = [];
            rows.forEach((r) => {
                const tr = document.createElement('tr'); tr.style.borderBottom = '1px solid #f0f0f0';
                const mkCell = () => { const td = document.createElement('td'); td.style.padding = '7px 10px'; td.style.verticalAlign = 'top'; return td; };
                // Procedure
                const cP = mkCell();
                const nm = document.createElement('span'); nm.textContent = '“' + r.name + '”'; nm.style.fontWeight = '600'; cP.appendChild(nm);
                // move checkbox
                const c1 = mkCell(); c1.style.textAlign = 'center';
                const mv = mkCheck(!!r.willMove); c1.appendChild(mv);
                // movement: start section -> end section
                const c2 = mkCell();
                if (r.willMove) {
                    const from = document.createElement('span'); from.textContent = r.fromLabel; from.style.color = '#b3261e'; from.style.textDecoration = 'line-through'; c2.appendChild(from);
                    c2.appendChild(document.createTextNode('  →  '));
                    const to = document.createElement('span'); to.textContent = r.toLabel; to.style.color = '#127a2e'; to.style.fontWeight = '600'; c2.appendChild(to);
                } else {
                    const dash = document.createElement('span'); dash.textContent = '—'; dash.style.color = '#bbb'; c2.appendChild(dash);
                }
                // justification checkbox
                const c3 = mkCell(); c3.style.textAlign = 'center';
                const jv = mkCheck(!!r.willJust); c3.appendChild(jv);
                // justification: old (red) -> new (green)
                const c4 = mkCell(); c4.style.fontSize = '12px';
                if (r.willJust) {
                    if (r.renameTo) {
                        const rn = document.createElement('div'); rn.appendChild(document.createTextNode('rename → '));
                        const g = document.createElement('span'); g.textContent = '“' + r.renameTo + '”'; g.style.color = '#127a2e'; g.style.fontWeight = '600'; rn.appendChild(g); c4.appendChild(rn);
                    }
                    if (r.justMode === 'append' && r.appendText) {
                        // Diff view: existing text stays grey (nothing removed on an
                        // append), only the appended sentence is green.
                        const line = document.createElement('div');
                        if (r.oldJust) {
                            const o = document.createElement('span'); o.textContent = r.oldJust; o.style.color = '#777'; line.appendChild(o);
                            line.appendChild(document.createTextNode(' '));
                        }
                        const g = document.createElement('span'); g.textContent = r.appendText; g.style.color = '#127a2e'; line.appendChild(g);
                        c4.appendChild(line);
                    } else if (r.newJust) {
                        // Replace (MET): old text struck through in red, new text in green.
                        if (r.oldJust) {
                            const od = document.createElement('div'); const o = document.createElement('span');
                            o.textContent = r.oldJust; o.style.color = '#b3261e'; o.style.textDecoration = 'line-through'; od.appendChild(o); c4.appendChild(od);
                        }
                        const nd = document.createElement('div'); const n = document.createElement('span');
                        n.textContent = r.newJust; n.style.color = '#127a2e'; nd.appendChild(n); c4.appendChild(nd);
                    }
                } else {
                    const none = document.createElement('span'); none.textContent = 'no change'; none.style.color = '#999'; c4.appendChild(none);
                }
                tr.appendChild(cP); tr.appendChild(c1); tr.appendChild(c2); tr.appendChild(c3); tr.appendChild(c4);
                table.appendChild(tr);
                state.push({ row: r, mv, jv });
            });
            body.appendChild(table);

            const foot = document.createElement('div');
            Object.assign(foot.style, { padding: '12px 18px', borderTop: '1px solid #e5e5e5', display: 'flex', justifyContent: 'flex-end', gap: '10px' });
            const cancel = document.createElement('button'); cancel.textContent = 'Cancel';
            Object.assign(cancel.style, { padding: '7px 16px', borderRadius: '6px', border: '1px solid #ccc', background: '#fff', cursor: 'pointer', font: '500 13px system-ui' });
            const apply = document.createElement('button'); apply.textContent = 'Apply checked';
            Object.assign(apply.style, { padding: '7px 16px', borderRadius: '6px', border: '1px solid #1746c9', background: '#1746c9', color: '#fff', cursor: 'pointer', font: '600 13px system-ui' });
            foot.appendChild(cancel); foot.appendChild(apply);

            modal.appendChild(head); modal.appendChild(body); modal.appendChild(foot);
            overlay.appendChild(modal);
            (document.body || document.documentElement).appendChild(overlay);

            const close = (confirmed) => {
                const isChecked = (el) => !!el && el.tagName === 'INPUT' && el.checked;
                const decisions = state.map((s) => Object.assign({}, s.row, {
                    moveChecked: isChecked(s.mv),
                    justChecked: isChecked(s.jv),
                }));
                overlay.remove();
                document.removeEventListener('keydown', onKey, true);
                resolve({ confirmed, decisions });
            };
            const onKey = (ev) => { if (ev.key === 'Escape') stop(() => close(false))(ev); };
            cancel.addEventListener('click', stop(() => close(false)));
            apply.addEventListener('click', stop(() => close(true)));
            overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(false); });
            document.addEventListener('keydown', onKey, true);
        });
    }

    // Nearest scrollable ancestor (for programmatic scroll during a drag).
    function athFindScrollParent(el) {
        let n = el && el.parentElement;
        while (n && n !== document.body && n !== document.documentElement) {
            const s = getComputedStyle(n);
            if (/(auto|scroll|overlay)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 4) return n;
            n = n.parentElement;
        }
        return document.scrollingElement || document.documentElement;
    }


    // =====================================================================
    // SHARED: item fixer - applies a matched rule's rename + justification to an
    // intervention <li>. Extracted from Fix Procedures so Fix Private Pay can
    // apply the SAME justification/rename when it moves Done items down (only the
    // destination differs). Self-contained; takes a logger. See Proc for the rules.
    // =====================================================================
    const Fixer = (function () {
        const nameOf = (li) => { const i = li.querySelector('input[aria-label="Intervention name"]'); return i ? (i.value || i.getAttribute('value') || '').trim() : ''; };
        function findTiptapEditor(el) {
            const k = Object.keys(el).find((x) => x.startsWith('__reactFiber$') || x.startsWith('__reactInternalInstance$'));
            let f = k ? el[k] : null, depth = 0;
            while (f && depth < 30) {
                const p = f.memoizedProps;
                if (p && p.editor && typeof p.editor.chain === 'function') return p.editor;
                const sn = f.stateNode;
                if (sn && sn.editor && typeof sn.editor.chain === 'function') return sn.editor;
                f = f.return; depth++;
            }
            return null;
        }
        function fxSetViaTiptap(el, value, log) {
            const editor = findTiptapEditor(el);
            if (!editor) { log && log.log('setViaTiptap: no editor on fiber'); return false; }
            try { editor.chain().focus().selectAll().insertContent(value).run(); return true; }
            catch (e) { log && log.error('setViaTiptap threw', e); return false; }
        }
        function keyA(el, type) {
            const ev = new KeyboardEvent(type, { key: 'a', code: 'KeyA', bubbles: true, cancelable: true, ctrlKey: true });
            try { Object.defineProperty(ev, 'keyCode', { get: () => 65 }); } catch (e) {}
            try { Object.defineProperty(ev, 'which', { get: () => 65 }); } catch (e) {}
            el.dispatchEvent(ev);
        }
        async function fxSetViaExecCommand(el, value, log) {
            el.focus();
            for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, { bubbles: true }));
            await sleep(30);
            keyA(el, 'keydown'); keyA(el, 'keyup');
            await sleep(20);
            document.execCommand('delete', false);
            await sleep(20);
            if ((el.textContent || '').trim() !== '') { log && log.warn('setViaExecCommand: Ctrl+A+delete did not clear - aborting'); return false; }
            const ok = document.execCommand('insertText', false, value);
            await sleep(20);
            return ok;
        }
        async function fxWriteDetails(details, text, log) {
            if ((details.textContent || '').trim() === text) return true;
            for (let attempt = 1; attempt <= 3; attempt++) {
                const usedTiptap = fxSetViaTiptap(details, text, log);
                if (!usedTiptap) await fxSetViaExecCommand(details, text, log);
                await sleep(150);
                let now = (details.textContent || '').trim();
                if (now === text) { await sleep(150); now = (details.textContent || '').trim(); }
                if (now === text) return true;
            }
            return false;
        }
        async function fxRenameItem(li, newName, log) {
            const inp = li.querySelector('input[aria-label="Intervention name"]');
            if (!inp) { log && log.warn('rename: no name input'); return false; }
            if ((inp.value || '').trim() === newName) return true;
            setReactValue(inp, newName, log);
            await sleep(120);
            const ok = (inp.value || '').trim() === newName;
            log && log.log('rename -> "' + newName + '": ' + (ok ? 'ok' : 'FAILED (value="' + (inp.value || '') + '")'));
            return ok;
        }
        // Apply rename + justification. justMode: 'none' (leave), 'replace' (MET -
        // overwrite), 'append' (add canonical text once, keep the scribe's text).
        async function fxApplyItemFix(li, fix, log) {
            let renamed = false, justified = false;
            if (fix.rename && (nameOf(li) !== fix.rename)) renamed = await fxRenameItem(li, fix.rename, log);
            if (fix.justMode === 'none' || !fix.justification) return { renamed, justified };
            const details = li.querySelector('[contenteditable="true"][aria-label="Intervention details"]');
            if (!details) { log && log.warn('no "Intervention details" field for "' + nameOf(li) + '"'); return { renamed, justified }; }
            const existing = (details.textContent || '').trim();
            let target;
            if (fix.justMode === 'replace') { target = fix.justification; }
            else { if (existing.includes(fix.justification)) return { renamed, justified: true }; target = existing ? (existing.replace(/\s+$/, '') + ' ' + fix.justification) : fix.justification; }
            justified = await fxWriteDetails(details, target, log);
            if (!justified && log) log.warn('justification for "' + nameOf(li) + '" did NOT stick');
            return { renamed, justified };
        }
        function fxCurrentDetailsText(li) {
            const d = li && li.querySelector('[contenteditable="true"][aria-label="Intervention details"]');
            return d ? (d.textContent || '').trim() : '';
        }
        function fxComputeNewJust(fix, cur) {
            if (fix.justMode === 'none' || !fix.justification) return '';
            if (fix.justMode === 'replace') return fix.justification;
            if (cur.includes(fix.justification)) return cur;
            return cur ? (cur.replace(/\s+$/, '') + ' ' + fix.justification) : fix.justification;
        }
        return { applyItemFix: fxApplyItemFix, currentDetailsText: fxCurrentDetailsText, computeNewJust: fxComputeNewJust };
    })();


    // =====================================================================
    // MODULE 1: Compact-mode CSS
    // (Same as v4. Per-page block selected by URL.)
    // =====================================================================
    function applyCompactCss() {
        const log = makeLogger('compact');
        const cssAppointments = `
            .v2-advanced-table .q-table th,
            .v2-advanced-table .q-table td {
                padding: 2px 8px !important;
                line-height: 1.25 !important;
            }
            .v2-advanced-table .q-table th:first-child,
            .v2-advanced-table .q-table td:first-child { padding-left: 10px !important; }
            .v2-advanced-table .q-table th:last-child,
            .v2-advanced-table .q-table td:last-child  { padding-right: 10px !important; }

            .v2-advanced-table .q-table tr.q-tr,
            .v2-advanced-table .q-table tr.q-tr > td,
            .v2-advanced-table .q-table tr.q-tr > th {
                height: auto !important;
                min-height: 0 !important;
            }

            .v2-advanced-table .q-td .tw-m-1 { margin: 0 !important; }
            .v2-advanced-table .q-td .tw-gap-1 > * + * { margin-top: 0 !important; }
            .v2-advanced-table .q-td p { margin: 0 !important; }

            .appointments-date-header { margin: 4px 0 2px !important; }
            .appointments-date-header__text,
            .appointments-date-header p { margin: 0 !important; line-height: 1.2 !important; }

            .q-table__container.v2-advanced-table { margin-bottom: 4px !important; }

            .v2-advanced-table .q-table__top    { padding: 4px 8px !important; }
            .v2-advanced-table .q-table__bottom { padding: 0 !important; min-height: 0 !important; }
        `;

        const cssChartNote = `
            /* v14.15: pruned every tr-* utility override whose class no longer
               appears anywhere in the post-rework chart-note DOM (verified
               against 5 captures incl. open dialogs). */
            .tr-gap-y-8 { row-gap: 0.375rem !important; }
            .tr-gap-y-2 { row-gap: 0.125rem !important; }

            .tr-gap-8 { gap: 0.5rem !important; }
            .tr-gap-6 { gap: 0.375rem !important; }
            .tr-gap-5 { gap: 0.25rem !important; }
            .tr-gap-4 { gap: 0.25rem !important; }
            .tr-gap-3 { gap: 0.25rem !important; }
            .tr-gap-2 { gap: 0.25rem !important; }

            .tr-py-4 { padding-top: 0.25rem !important; padding-bottom: 0.25rem !important; }
            .tr-py-3 { padding-top: 0.125rem !important; padding-bottom: 0.125rem !important; }
            .tr-py-2 { padding-top: 0.125rem !important; padding-bottom: 0.125rem !important; }
            .tr-py-1 { padding-top: 0.0625rem !important; padding-bottom: 0.0625rem !important; }

            .tr-mb-5 { margin-bottom: 0.25rem !important; }
            .tr-mb-4 { margin-bottom: 0.25rem !important; }
            .tr-mb-3 { margin-bottom: 0.125rem !important; }
            .tr-mb-2 { margin-bottom: 0.125rem !important; }

            .tr-mt-7 { margin-top: 0.5rem !important; }
            .tr-mt-3 { margin-top: 0.125rem !important; }
            .tr-mt-2 { margin-top: 0.125rem !important; }

            .tr-space-y-2 > :not([hidden]) ~ :not([hidden]) { margin-top: 0.125rem !important; }

            .tr-min-h-7  { min-height: 0 !important; }

            .tr-p-6 { padding: 0.25rem !important; }
            .tr-p-4 { padding: 0.25rem !important; }
            .tr-p-3 { padding: 0.25rem !important; }
            .tr-p-2 { padding: 0.125rem !important; }
            .tr-pt-5 { padding-top: 0.25rem !important; }
            .tr-pt-4 { padding-top: 0.25rem !important; }
            .tr-pt-3 { padding-top: 0.125rem !important; }
            .tr-pt-2 { padding-top: 0.125rem !important; }
            .tr-pb-5 { padding-bottom: 0.25rem !important; }
            .tr-pb-4 { padding-bottom: 0.25rem !important; }
            .tr-pb-3 { padding-bottom: 0.125rem !important; }
            .tr-pb-2 { padding-bottom: 0.125rem !important; }

            /* ============================================================
               MUI input compact-mode CSS DISABLED (v14).

               After the Athelas site rework, the new Mins field uses
               .MuiInputBase-root.MuiInputBase-sizeSmall.css-ygpv1j (an
               <input aria-label="minutes"> wrapped in an MUI OutlinedInput)
               and these overrides break both its display and its ability
               to accept edits. Left commented for reference and possible
               future use if the compact form-control styling is ever
               wanted again.
               ============================================================ */
            /*
            .MuiOutlinedInput-root { padding: 2px 6px !important; }
            .MuiOutlinedInput-root.MuiInputBase-sizeSmall {
                padding-top: 2px !important;
                padding-bottom: 2px !important;
                padding-left: 6px !important;
            }
            .MuiOutlinedInput-root .MuiAutocomplete-input { padding: 1px 4px 1px 6px !important; }
            .MuiOutlinedInput-root.MuiInputBase-sizeSmall .MuiAutocomplete-input { padding: 1px 4px 1px 6px !important; }
            .MuiOutlinedInput-root:has(.MuiInputAdornment-positionEnd) { padding-right: 28px !important; }
            .MuiInputBase-root { padding: 2px 28px 2px 6px !important; min-height: 22px !important; }
            .MuiInputBase-root .MuiInputBase-input { padding: 0 !important; min-height: 0 !important; }
            .MuiOutlinedInput-root .MuiInputBase-multiline { padding: 1px 6px !important; font-size: 13px !important; min-height: 0 !important; }
            .MuiInputBase-multiline textarea,
            .MuiInputBase-multiline { min-height: 1.5em !important; }

            .tiptap.ProseMirror { min-height: 1.5em !important; line-height: 1.3 !important; padding: 2px 6px !important; }
            .tiptap.ProseMirror p { margin: 1px 0 !important; }
            */

            .MuiFormControlLabel-root { margin-top: 0 !important; margin-bottom: 0 !important; min-height: 0 !important; }
            .MuiCheckbox-root { padding: 2px !important; }

            .MuiCollapse-wrapperInner { padding-top: 0 !important; padding-bottom: 0 !important; }

            .MuiIconButton-sizeSmall { padding: 2px !important; }
            .MuiIconButton-sizeMedium { padding: 4px !important; }
            .MuiButton-sizeMedium { padding: 2px 8px !important; min-height: 0 !important; }

            .MuiTypography-Body\\.Normal\\.Regular,
            .MuiTypography-Body\\.Normal\\.Medium,
            .MuiTypography-Body\\.Small\\.Regular,
            .MuiTypography-Body\\.Small\\.Medium,
            .MuiTypography-Body\\.Small\\.SemiBold,
            .MuiTypography-Body\\.Large\\.SemiBold {
                line-height: 1.25 !important;
            }

            [data-section] > .tr-grid { padding-top: 1px !important; padding-bottom: 1px !important; }

            .tr-pb-16, .tr-pb-12 { padding-bottom: 0.5rem !important; }

            /* ============================================================
               v10: aggressive compactness on five specific regions the
               user called out. Each block is scoped to a stable class
               combo from the page so we don't bleed elsewhere.
               ============================================================ */

            /* 1. Left rail: the 160/200px sub-section nav inside the chart-
                  note content area. Drop right padding (tr-pr-6 = 24px) and
                  collapse vertical spacing on its children. */
            .tr-w-\\[160px\\].tr-min-w-\\[160px\\].tr-max-w-\\[160px\\] { padding-right: 4px !important; }
            .tr-w-\\[160px\\].tr-min-w-\\[160px\\].tr-max-w-\\[160px\\] [class*="tr-py-"] { padding-top: 0 !important; padding-bottom: 0 !important; }
            .tr-w-\\[160px\\].tr-min-w-\\[160px\\].tr-max-w-\\[160px\\] [class*="tr-mb-"],
            .tr-w-\\[160px\\].tr-min-w-\\[160px\\].tr-max-w-\\[160px\\] [class*="tr-mt-"] { margin-top: 0 !important; margin-bottom: 0 !important; }
            .tr-w-\\[160px\\].tr-min-w-\\[160px\\].tr-max-w-\\[160px\\] [class*="tr-gap-y-"] { row-gap: 1px !important; }
            .tr-w-\\[160px\\].tr-min-w-\\[160px\\].tr-max-w-\\[160px\\] [class*="tr-min-h-"] { min-height: 0 !important; }
            .tr-w-\\[160px\\].tr-min-w-\\[160px\\].tr-max-w-\\[160px\\] .MuiListItem-root,
            .tr-w-\\[160px\\].tr-min-w-\\[160px\\].tr-max-w-\\[160px\\] .MuiListItemButton-root { padding-top: 1px !important; padding-bottom: 1px !important; min-height: 0 !important; }

            /* 2. Quasar drawer aside (the left global nav with EHR / Insights
                  expansion items). Tighten q-item rows. */
            .q-drawer-container > aside .q-item { min-height: 28px !important; padding-top: 2px !important; padding-bottom: 2px !important; }
            .q-drawer-container > aside .q-expansion-item__container { min-height: 0 !important; }
            .q-drawer-container > aside [class*="tw-h-12"] { height: 28px !important; }
            .q-drawer-container > aside [class*="tw-h-10"] { height: 24px !important; }
            .q-drawer-container > aside [class*="tw-my-"] { margin-top: 0 !important; margin-bottom: 0 !important; }
            .q-drawer-container > aside [class*="tw-mt-"] { margin-top: 0 !important; }

            /* 3. "Surface4" sub-section banner with px-5: drop vertical breathing. */
            .tr-bg-Surface-Neutral-Lighter-Surface4.tr-border-b.tr-border-Shape-OnSurface-Outlines.tr-px-5 { padding-top: 2px !important; padding-bottom: 2px !important; }
            .tr-bg-Surface-Neutral-Lighter-Surface4.tr-border-b.tr-border-Shape-OnSurface-Outlines.tr-px-5 [class*="tr-py-"] { padding-top: 1px !important; padding-bottom: 1px !important; }
            .tr-bg-Surface-Neutral-Lighter-Surface4.tr-border-b.tr-border-Shape-OnSurface-Outlines.tr-px-5 [class*="tr-min-h-"] { min-height: 0 !important; }

            /* 4. Sticky page-top header bar (the action-bar row with Save / Print /
                  etc.). Buttons set the floor, but trim the surrounding padding. */
            .tr-sticky.tr-top-0.tr-z-10.tr-w-full.tr-border-b.tr-border-Shape-OnSurface-Outlines.tr-bg-Surface-Neutral-Lighter-Surface { padding-top: 1px !important; padding-bottom: 1px !important; }
            .tr-sticky.tr-top-0.tr-z-10.tr-w-full.tr-border-b.tr-border-Shape-OnSurface-Outlines.tr-bg-Surface-Neutral-Lighter-Surface [class*="tr-py-"] { padding-top: 1px !important; padding-bottom: 1px !important; }
            .tr-sticky.tr-top-0.tr-z-10.tr-w-full.tr-border-b.tr-border-Shape-OnSurface-Outlines.tr-bg-Surface-Neutral-Lighter-Surface .MuiButton-sizeMedium { padding-top: 1px !important; padding-bottom: 1px !important; min-height: 22px !important; }

            /* v14.15: the long-disabled MUI DataGrid compact block was deleted.
               The v14 site rework replaced the interventions DataGrid with
               dnd-kit sortable cards - no .MuiDataGrid-* elements exist on the
               page anymore. Historical notes live in
               athelas-appointments-compact.archive.js (featureSimpleGridHeight). */

            /* ============================================================
               v15 Phase 1: horizontal space reclaim. CSS only - nothing is
               hidden, nothing new is injected; icons and (truncated) labels
               stay visible and clickable everywhere.
               ============================================================ */

            /* 1. Global Quasar drawer: 250px -> 150px. The drawer width and
                  the page-container's left offset are both set via INLINE
                  style on the page (DOM-FACTS lesson #2), so !important is
                  required to win. The existing v10 drawer rules above
                  (q-item min-height 28/24px etc.) still apply on top of this. */
            /* v15.11: 150px was too narrow - labels like "Daily Operations"
               overflowed and gave the drawer a horizontal scrollbar. 200px (down
               from the native 250px) still reclaims space but fits the labels;
               overflow-x:hidden is a safety net so no h-scrollbar can appear. */
            aside.q-drawer { width: 200px !important; }
            .q-page-container { padding-left: 200px !important; }
            aside.q-drawer .q-drawer__content { overflow-x: hidden !important; }

            /* Ellipsize the section-header label row (EHR / Insights / Daily
               Operations / Utilities / Settings) so a narrower rail never
               wraps or clips mid-word. The individual nav links beneath each
               section already truncate via the site's own tw-truncate class. */
            .q-drawer-container > aside .q-item [class*="tw-flex-1"] {
                overflow: hidden !important;
                text-overflow: ellipsis !important;
                white-space: nowrap !important;
                min-width: 0 !important;
            }
            .q-drawer-container > aside [class*="tw-px-4"] { padding-left: 8px !important; padding-right: 8px !important; }

            /* 2. Section sub-nav rail: v15.11 KEEPS THE NATIVE WIDTH (160/200px).
                  Forcing it narrower (the old 160->112px rule) made the item
                  highlight boxes and labels overflow the rail and paint over the
                  note - see redesign/COMPACT-MODE-POSTMORTEM.md. Only the padding/
                  height compaction from the v10 rail rules above is kept; the
                  vertical density is preserved, the horizontal breakage is not. */

            /* 3. Content side margins: drop the note scroller's 16px
                  tr-mx-4 gutters, and shrink the tr-px-6 rows inside the
                  sticky header (breadcrumb / title / info-strip rows) to
                  8px - scoped to that header container only. */
            .tr-mx-4.tr-h-full.tr-w-full.tr-overflow-x-auto { margin-left: 0 !important; margin-right: 0 !important; }
            .tr-sticky.tr-top-0.tr-z-10.tr-w-full.tr-border-b.tr-border-Shape-OnSurface-Outlines.tr-bg-Surface-Neutral-Lighter-Surface [class*="tr-px-6"] { padding-left: 8px !important; padding-right: 8px !important; }

            /* ============================================================
               v15 Phase 2: compact the bars above the note content (patient
               banner, patient-level tabs, breadcrumb/title/info sticky
               header, sticky in-note tabs). Nothing hidden, no font-size
               changes on Small/ExtraSmall text, no MuiInputBase/
               MuiOutlinedInput padding touched.
               ============================================================ */

            /* 1. Breadcrumb strip (sticky header row 1, tr-px-6 tr-py-2):
                  already thinned to 1px top/bottom by the existing v10 rule
                  above (".tr-sticky...Surface [class*=\"tr-py-\"]") - that
                  rule's attribute-contains match already covers tr-py-2.
                  No new rule needed here; fonts are untouched either way. */

            /* 2. Patient banner (avatar + name + MRN + icon buttons + Book
                  Appointment): its row uses tr-my-2 (margin, not padding -
                  not covered by the existing Surface4 tr-py-/tr-min-h- rules
                  below), confirmed via the "(MRN:" text in both DOM captures.
                  Scoped to the same unique Surface4 sub-section container
                  the v10 rules already use. */
            .tr-bg-Surface-Neutral-Lighter-Surface4.tr-border-b.tr-border-Shape-OnSurface-Outlines.tr-px-5 [class*="tr-my-"] {
                margin-top: 2px !important;
                margin-bottom: 2px !important;
            }

            /* 3. Tabs: patient-level (Demographics/Appointments/Attachments/
                  Tasks/Orders, inside the same Surface4 banner container)
                  and the sticky z-20 tabs inside the note (Scribe Notes /
                  Transcription & Context, plus the adjacent section-shortcut
                  tabs in the same sticky container). Tab label text is
                  Body.Small.SemiBold - untouched. Sticky positioning and the
                  z-20 element's tr-mx-[-20px] negative margin are untouched -
                  only min-height/padding on the tabs themselves change. */
            .tr-bg-Surface-Neutral-Lighter-Surface4.tr-border-b.tr-border-Shape-OnSurface-Outlines.tr-px-5 .MuiTabs-root,
            .tr-sticky.tr-top-0.tr-z-20 .MuiTabs-root {
                min-height: 26px !important;
            }
            .tr-bg-Surface-Neutral-Lighter-Surface4.tr-border-b.tr-border-Shape-OnSurface-Outlines.tr-px-5 .MuiTab-root,
            .tr-sticky.tr-top-0.tr-z-20 .MuiTab-root {
                min-height: 26px !important;
                padding: 2px 10px !important;
            }

            /* 4. Title row (sticky header row 2): the visit title H4 is a
                  LARGE font, safe to shrink - scoped to the sticky header so
                  the unrelated H4s elsewhere (an "AI Summary" card title, a
                  few dialog titles) are not touched. Row padding (tr-pt-3)
                  is already 2px via the existing generic .tr-pt-3 rule
                  above; the two selects (Appointment Type / Clinical Note
                  Type) are MuiInputBase-sizeSmall autocompletes - their
                  wrapper row's gap is tightened in block 5 below, but the
                  input itself is never touched. */
            .tr-sticky.tr-top-0.tr-z-10.tr-w-full.tr-border-b.tr-border-Shape-OnSurface-Outlines.tr-bg-Surface-Neutral-Lighter-Surface h4.MuiTypography-Heading\\.H4 {
                font-size: 15px !important;
                line-height: 1.2 !important;
            }

            /* 5. Info strip (Plan of Care End Date / Pending Visits / Prior
                  Auth / Insurance / ... + the "Expand" toggle's revealed
                  rows): tighten the remaining gap/padding utilities within
                  the sticky header that the existing tr-py- rule doesn't
                  cover (tr-pt-/tr-pb- are separate Tailwind utilities from
                  tr-py-, and the info-strip grid's tr-gap-4 wasn't scoped
                  down before). This also nudges row 2's title/select gap and
                  row 1's breadcrumb gap a little tighter as a side effect -
                  harmless, wrapper-only. The Expand toggle itself is a
                  button, unaffected by spacing tweaks; it keeps working. */
            .tr-sticky.tr-top-0.tr-z-10.tr-w-full.tr-border-b.tr-border-Shape-OnSurface-Outlines.tr-bg-Surface-Neutral-Lighter-Surface [class*="tr-gap-"] { gap: 2px !important; }
            .tr-sticky.tr-top-0.tr-z-10.tr-w-full.tr-border-b.tr-border-Shape-OnSurface-Outlines.tr-bg-Surface-Neutral-Lighter-Surface [class*="tr-pt-"] { padding-top: 2px !important; }
            .tr-sticky.tr-top-0.tr-z-10.tr-w-full.tr-border-b.tr-border-Shape-OnSurface-Outlines.tr-bg-Surface-Neutral-Lighter-Surface [class*="tr-pb-"] { padding-bottom: 2px !important; }

            /* ============================================================
               v15 Phase 3: density inside the note content, especially
               [data-section="flowsheet"]. Nothing hidden, drag handles keep
               their full hit area, no MuiInputBase/MuiOutlinedInput padding
               anywhere, no Small/ExtraSmall font shrinking.
               ============================================================ */

            /* 1. Section H1s (Subjective / Objective / Interventions / ... -
                  9 per note, confirmed identical in both DOM captures, none
                  of them shared with any dialog). LARGE font - shrink freely. */
            h1.MuiTypography-root.MuiTypography-Heading\\.H1 {
                font-size: 18px !important;
                line-height: 1.2 !important;
                margin: 0 !important;
            }

            /* 2. Flowsheet intervention rows. The row's real height floor is
                  the "Intervention name" MuiInputBase-sizeSmall input
                  (present in every row, ~40px per MUI's own small-outlined
                  metrics) - untouchable per the MuiInputBase ban, so this is
                  as tight as the outer li can get without that ban. The drag
                  handle (tr-w-5 = 20px wide) is unaffected by this padding
                  change and is centered within the ~40px input-driven row
                  height, well above the 20px hit-area floor. */
            li[aria-label="Intervention"] {
                padding: 1px 0 1px 4px !important;
            }

            /* 3. Procedure-card header row (drag handle + replace-procedure +
                  Mod + mins/units + therapist + HEP/Done). Its two widest
                  fields (replace-procedure, Mod) are MEDIUM-size MUI
                  Autocompletes, not sizeSmall - they set this row's own
                  height floor and are never touched. Only the row's own
                  wrapper gap and the card li's right padding are trimmed;
                  the intervention-list indent beneath each card is also
                  trimmed for horizontal density (same wrapper-padding
                  spirit, reuses MODULE 9's own region selector pattern). */
            [data-section="flowsheet"] ul[aria-label="procedures"] > li {
                padding-right: 8px !important;
            }
            [data-section="flowsheet"] .tr-flex.tr-flex-wrap.tr-items-center.tr-gap-y-1 {
                gap: 2px !important;
            }
            [data-section="flowsheet"] [role="region"][aria-label$=" interventions"] {
                padding-left: 12px !important;
            }

            /* 4. Blue summary bar (Treatment Time / Timed / Untimed / Total
                  Units / Time in Clinic). Text inside is Body.Small.* -
                  untouched; only the container's own padding is trimmed,
                  identified via its data-tour attribute (stable, non-hash). */
            [data-tour="flowsheet-v2-summary-bar"] {
                padding: 4px !important;
            }

            /* 5. Notes/justification tiptap editors inside rows. The
                  surrounding wrapper divs are MuiBox-root with only
                  hash-generated classes (no stable non-hash hook to trim
                  their margins independently), so the only safe lever is the
                  editor itself - line-height and its <p> margins only, no
                  padding, per the v14 Mins-field lesson. */
            [data-section="flowsheet"] .tiptap.ProseMirror {
                line-height: 1.3 !important;
            }
            [data-section="flowsheet"] .tiptap.ProseMirror p {
                margin: 1px 0 !important;
            }

            /* 6. Checkboxes / icon buttons in rows (Add-to-HEP, Done, row
                  "more" menu): each sits in an already-fixed tr-h-7 (28px)
                  container, and the existing global rules
                  (.MuiIconButton-sizeSmall / .MuiCheckbox-root padding: 2px)
                  already keep the controls themselves within that 28px -
                  well under the ~40px input-driven row height from block 2
                  above. Not the row-height driver anywhere in the flowsheet;
                  no flowsheet-scoped tweak needed here. */
        `;

        // Inject the block that matches the CURRENT page, at most once per block.
        // Called at boot AND on every SPA navigation, so the right CSS lands even
        // when the tab first loaded on some other (non-matching) URL. Calendar and
        // other pages get nothing (both blocks stay un-injected there).
        const { isAppointments, isChartNote } = pageType();
        const wanted = [];
        if (isAppointments) wanted.push(['app', cssAppointments]);
        if (isChartNote) wanted.push(['chart', cssChartNote]);
        if (!wanted.length) { log.log('no CSS block applies for this URL'); return; }

        applyCompactCss._done = applyCompactCss._done || {};
        for (const [key, css] of wanted) {
            if (applyCompactCss._done[key]) continue;   // already injected this block
            applyCompactCss._done[key] = true;
            const styleId = 'athelas-compact-' + key;
            if (typeof GM_addStyle === 'function') {
                GM_addStyle(css);
                log.log(`applied ${key} via GM_addStyle (${css.length} chars)`);
            } else {
                const inject = () => {
                    if (document.getElementById(styleId)) return;
                    const style = document.createElement('style');
                    style.id = styleId;
                    style.textContent = css;
                    (document.head || document.documentElement).appendChild(style);
                    log.log(`applied ${key} via <style> injection (${css.length} chars)`);
                };
                if (document.head) inject();
                else new MutationObserver((_, obs) => {
                    if (document.head) { inject(); obs.disconnect(); }
                }).observe(document.documentElement, { childList: true });
            }
        }
    }


    // =====================================================================
    // MODULE 2: Scroll to Flowsheet section on chart-note load
    // (Independent. Doesn't depend on the autofill module.)
    // =====================================================================
    async function featureScrollToFlowsheet() {
        const log = makeLogger('scroll');
        log.log('module booted');

        // v15 Phase 2: nudged down slightly. The patient-banner/tabs region
        // above this sticky header shrank a lot (my-2 margins, tab heights)
        // but that region isn't sticky, so it doesn't count toward this
        // offset. Within the sticky header itself, row 2's height is floor-
        // limited by the untouched MuiInputBase-sizeSmall selects (~40px),
        // so the only real reduction here comes from tightening row 3's
        // (info-strip) gap/padding. This is an ESTIMATE, not a live
        // measurement (no authenticated browser session available while
        // writing this CSS) - re-check with Claude in Chrome per
        // redesign/PLAN.md and nudge again if jump-to-flowsheet lands off.
        const HEADER_OFFSET = 60;       // sticky app bar height + a bit of breathing room
        const SETTLE_MS     = 350;      // delay between scroll attempts
        const MAX_ATTEMPTS  = 5;
        const ACCEPT_PX     = 24;       // accept if target is within ±N px of HEADER_OFFSET

        /** Find the best scroll target, preferring the Interventions H1.
         *  Falls back to the Flowsheet section wrapper.
         *  (v14.15: dropped the .MuiDataGrid-root fallback - the grid was
         *  replaced by dnd-kit cards in the v14 site rework.) */
        function findTarget() {
            // 1. The Interventions H1 (or H2/H3/H4 if MUI ever changes the heading level)
            //    is the most-specific anchor the user actually wants to land on.
            const flowsheet = document.querySelector('[data-section="flowsheet"]');
            if (flowsheet) {
                const headings = flowsheet.querySelectorAll('h1, h2, h3, h4');
                for (const h of headings) {
                    if (/^\s*Interventions\s*$/i.test(h.textContent || '')) return h;
                }
            }
            // 2. Last resort: the flowsheet section wrapper.
            return flowsheet;
        }

        // Wait for at least one of the candidate anchors to exist.
        const anchor = await waitFor('[data-section="flowsheet"] h1, [data-section="flowsheet"] h2, [data-section="flowsheet"] h3, [data-section="flowsheet"]', { log });
        if (!anchor) { log.warn('no scroll anchor ever appeared - giving up'); return; }
        await sleep(300); // give React a tick to finish painting children

        /** Returns the vertical distance between the target's top and the
         *  intended position (HEADER_OFFSET below the viewport top). 0 = perfect. */
        function distanceFromIdeal(target) {
            return target.getBoundingClientRect().top - HEADER_OFFSET;
        }

        /** Multi-pass scroll: scroll, wait for layout to settle, check distance,
         *  re-scroll if the target drifted. This handles the case where sections
         *  ABOVE the Interventions area (Plan, Goals, etc.) render late and push
         *  the viewport content down after our initial scroll fires. */
        let lastDistance = Infinity;
        for (let i = 0; i < MAX_ATTEMPTS; i++) {
            const target = findTarget();
            if (!target) { log.warn(`attempt ${i+1}: no target found`); break; }
            const desc = target.tagName === 'H1' || target.tagName === 'H2' || target.tagName === 'H3'
                ? `${target.tagName} "${(target.textContent || '').trim()}"`
                : `[data-section="${target.getAttribute('data-section')}"]`;
            log.log(`scroll attempt ${i+1}/${MAX_ATTEMPTS}: target = ${desc}`);

            // First attempt smooth, subsequent ones instant so the user doesn't
            // see a long animation race.
            target.scrollIntoView({ behavior: i === 0 ? 'smooth' : 'auto', block: 'start' });
            // Nudge up to clear the sticky app bar.
            window.scrollBy({ top: -HEADER_OFFSET, behavior: 'auto' });
            await sleep(SETTLE_MS);

            const d = distanceFromIdeal(target);
            log.log(`  result: target.top is ${Math.round(d + HEADER_OFFSET)}px from viewport top (off by ${Math.round(d)}px)`);

            if (Math.abs(d) <= ACCEPT_PX) {
                log.log(`  within ±${ACCEPT_PX}px of ideal - DONE`);
                return;
            }
            if (Math.abs(d - lastDistance) < 2) {
                // Position stable but not at ideal - probably the page is shorter
                // than expected and we can't scroll any further. Accept.
                log.log(`  position stable but offset persists - accepting (likely page-bottom limit)`);
                return;
            }
            lastDistance = d;
        }
        log.warn(`scroll did not fully settle after ${MAX_ATTEMPTS} attempts (last offset ${Math.round(lastDistance)}px)`);
    }


    // =====================================================================
    // Disabled/legacy modules moved to companion file:
    //   athelas-appointments-compact.archive.js
    //
    // Includes featureAutofillInterventions, featureFocusInterventionsSearch,
    // featureMinsColumnHelpers, featureMoveToBottom, featureForceEditMode,
    // featureSimpleGridHeight (+ the DataGrid compact-mode dead-space
    // history/notes block), and featureFixMisplacedMET. All were built
    // against older Athelas Insights DOM formats and stopped working after
    // the v14 site rework.
    //
    // If any of them are worth reviving, copy the definition back into
    // this file above the Boot block below, and uncomment the call in
    // the boot dispatcher.
    // =====================================================================

    // =====================================================================
    // MODULE 9 (v14.9): "Fix MET" - move Muscle Energy Technique items from
    // 97140 (Manual Therapy) to 97112 (Neuromuscular Reeducation).
    //
    // IMPORTANT CORRECTION vs the archived v14.8 attempt: the intervention
    // list is driven by *dnd-kit*, NOT react-beautiful-dnd. The data-rfd-*
    // attributes on the page belong to a SEPARATE rbd widget (note-section
    // reordering + the sidebar) and are irrelevant here. Every intervention
    // drag handle carries dnd-kit's signature:
    //     role="button" aria-roledescription="sortable"
    //     aria-describedby="DndDescribedBy-0"
    // and the hidden DndDescribedBy-0 element literally says:
    //     "To pick up a draggable item, press the space bar. While dragging,
    //      use the arrow keys... Press space again to drop..."
    // So we drive dnd-kit's KEYBOARD SENSOR: focus handle -> Space (pick up)
    // -> ArrowDown xN (move down, crossing into the 97112 list) -> Space
    // (drop). This survives React re-render + Apply Scribe because the move
    // goes through dnd-kit's own onDragEnd, updating React state.
    //
    // DOM facts (from Melanie Weisert Chart Note_wtf.mhtml):
    //   scope           [data-section="flowsheet"]
    //   card code       <input aria-label="replace procedure" value="97140 - Manual Therapy">
    //   list region     <div role="region" aria-label="Manual Therapy interventions">
    //   list            <ul aria-label="Manual Therapy intervention list">  (absent when empty)
    //   item            <li aria-label="Intervention">
    //   drag handle     <div aria-label="Drag to reorder" role="button" tabindex="0" ...>
    //   item name       <input aria-label="Intervention name" value="MET">
    //   single DndContext (one DndLiveRegion + one DndDescribedBy-0 shared by
    //   all 32 handles = 28 items + 4 cards) => cross-card drag is supported.
    //
    // v14.11: the button uses the POINTER sensor (one continuous gesture -> fast,
    // and dropped at the TOP of 97112). If the pointer path can't confirm the item
    // is over 97112 it cancels cleanly (Escape) and the KEYBOARD path (v14.9-14.10,
    // slower but proven) takes over, so nothing is ever left misplaced.
    //
    // Debug hooks (DevTools console):
    //   __athelasFixMET()            full flow (ensure 97112, then move all MET)
    //   __athelasPointerDragFirstMET() pointer-drag the first misplaced MET (primary)
    //   __athelasKbdDragFirstMET()   keyboard-drag the first misplaced MET (fallback)
    //   __athelasDbgFlowsheet()      dump every card + its items + live region
    //   __athelasListProcedureCards()console.table of cards
    // =====================================================================
    function featureFixMisplacedMET() {
        const log = makeLogger('fix-met');
        const T0 = performance.now();
        const ts = () => `+${(performance.now() - T0).toFixed(0)}ms`;
        log.log(`${ts()} module booted, Fix Procedures (generalized from Fix MET; matcher = shared Proc engine)`);

        const HEADER_BTN_ID = 'athelas-fix-met-header-btn';   // id kept for continuity
        const KEY_DELAY_MS = 130;     // pause between simulated keystrokes (let React re-render + dnd-kit re-measure)
        const MAX_ARROW_STEPS = 45;   // safety cap on arrow presses (we normally stop on detection long before this)
        const metJustification = Proc.metJustification;   // shared, robust "MET - X" splicer

        function isMETText(text) {
            const t = (text || '').trim();
            return /\bMET\b/i.test(t) || /muscle\s*energy/i.test(t);
        }

        function getScope() { return document.querySelector('[data-section="flowsheet"]'); }

        function liveRegionEl() {
            return document.querySelector('[id^="DndLiveRegion"]')
                || document.querySelector('[aria-live][role="status"]');
        }
        function liveRegionText() {
            const lr = liveRegionEl();
            return lr ? (lr.textContent || '').trim() : '(no DndLiveRegion)';
        }

        // ---- card / item model ----------------------------------------------
        // A card = one CPT code. We map code + name from the "replace procedure"
        // input (value="97140 - Manual Therapy"), then locate its list region by
        // the "<Name> interventions" aria-label. Robust to the two sections
        // coexisting because everything is scoped to [data-section="flowsheet"].
        function findRegionByName(scope, name) {
            for (const r of scope.querySelectorAll('[role="region"][aria-label$=" interventions"]')) {
                if (r.getAttribute('aria-label') === `${name} interventions`) return r;
            }
            return null;
        }
        function getCards() {
            const scope = getScope();
            if (!scope) return [];
            const cards = [];
            for (const input of scope.querySelectorAll('input[aria-label="replace procedure"]')) {
                const val = input.value || input.getAttribute('value') || '';
                const m = val.match(/^(\d{5})\s*-\s*(.+?)\s*$/);
                if (!m) continue;
                const code = m[1];
                const name = m[2].trim();
                const region = findRegionByName(scope, name);
                const ul = region ? region.querySelector('ul[aria-label$=" intervention list"]') : null;
                cards.push({ code, name, input, region, ul });
            }
            return cards;
        }
        function countCards(code) { return getCards().filter((c) => c.code === code).length; }
        function itemName(li) {
            const inp = li.querySelector('input[aria-label="Intervention name"]');
            return inp ? (inp.value || inp.getAttribute('value') || '') : '';
        }
        function itemHandle(li) {
            return li.querySelector('[aria-label="Drag to reorder"][role="button"]')
                || li.querySelector('[aria-label="Drag to reorder"]');
        }
        function cardItems(card) {
            if (!card.region) return [];
            const ul = card.region.querySelector('ul[aria-label$=" intervention list"]');
            if (!ul) return [];
            return Array.from(ul.querySelectorAll(':scope > li[aria-label="Intervention"]'));
        }
        // Which region(s) currently hold an intervention whose name === `name`.
        function regionsContainingName(name) {
            const target = (name || '').trim();
            const hits = [];
            for (const card of getCards()) {
                const n = cardItems(card).map((li) => itemName(li).trim()).filter((x) => x === target).length;
                if (n) hits.push({ code: card.code, name: card.name, count: n });
            }
            return hits;
        }

        function dumpState(label) {
            const scope = getScope();
            log.log(`${ts()} STATE[${label}] scope=${!!scope} liveRegion="${liveRegionText()}"`);
            if (!scope) return;
            for (const card of getCards()) {
                const items = cardItems(card).map((li) => itemName(li).trim());
                log.log(`${ts()}    card ${card.code} "${card.name}" region=${!!card.region} ul=${!!card.ul} items[${items.length}]=${JSON.stringify(items)}`);
            }
        }

        // ---- synthetic keyboard --------------------------------------------
        // dnd-kit's KeyboardSensor reads event.code. Activation ("start") only
        // fires when the keydown's target IS the handle, so the pickup Space is
        // dispatched on the handle. Once dragging, dnd-kit listens on `document`
        // and the move/drop handlers do NOT check target, so ArrowDown/Space are
        // dispatched on `document` (survives focus loss across React re-renders).
        const KEYCODES = { Space: 32, ArrowDown: 40, ArrowUp: 38, Escape: 27, Enter: 13, KeyA: 65 };
        function dispatchKey(el, type, code, key, mods) {
            mods = mods || {};
            const ev = new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true, ctrlKey: !!mods.ctrlKey, metaKey: !!mods.metaKey, shiftKey: !!mods.shiftKey, altKey: !!mods.altKey });
            const kc = KEYCODES[code] || 0;
            try { Object.defineProperty(ev, 'keyCode', { get: () => kc }); } catch (e) {}
            try { Object.defineProperty(ev, 'which', { get: () => kc }); } catch (e) {}
            const notCancelled = el.dispatchEvent(ev);
            const tgtLabel = (el.getAttribute && el.getAttribute('aria-label')) || el.nodeName;
            log.log(`${ts()}    key ${type} code=${code} on <${(el.tagName || el.nodeName).toLowerCase()} "${tgtLabel}"> notCancelled=${notCancelled} defaultPrevented=${ev.defaultPrevented} isKbdEvent=${ev instanceof KeyboardEvent}`);
            return ev;
        }
        function pressKey(el, code, key) {
            dispatchKey(el, 'keydown', code, key);
            dispatchKey(el, 'keyup', code, key);
        }

        // ---- adaptive wait (v14.11 speed): poll until dnd-kit finishes a move
        // (its live-region text changes) or a short cap elapses, instead of a
        // blanket 130ms sleep. Never fires the next key before dnd-kit is ready.
        async function waitForLiveChange(prevLive, maxMs) {
            maxMs = maxMs || 220;
            const start = performance.now();
            while (performance.now() - start < maxMs) {
                if (liveRegionText() !== prevLive) return performance.now() - start;
                await sleep(6);
            }
            return -1;
        }
        function indexOfNameInCard(code, name) {
            const c = getCards().find((x) => x.code === code);
            if (!c) return -1;
            return cardItems(c).map((li) => itemName(li).trim()).indexOf((name || '').trim());
        }
        function codeForName(targetName) {
            const c = getCards().find((x) => x.name === targetName);
            return c ? c.code : undefined;
        }
        function viewportH() { return document.documentElement.clientHeight || window.innerHeight || 800; }
        function firstItemOfCard(code) {
            const c = getCards().find((x) => x.code === code);
            if (!c || !c.region) return null;
            const ul = c.region.querySelector('ul[aria-label$=" intervention list"]');
            return ul ? ul.querySelector(':scope > li[aria-label="Intervention"]') : null;
        }
        function ulOfCard(code) {
            const c = getCards().find((x) => x.code === code);
            if (!c || !c.region) return null;
            return c.region.querySelector('ul[aria-label$=" intervention list"]');
        }
        function lastItemOfCard(code) {
            const ul = ulOfCard(code);
            if (!ul) return null;
            const items = ul.querySelectorAll(':scope > li[aria-label="Intervention"]');
            return items.length ? items[items.length - 1] : null;
        }
        function itemCountInCard(code) {
            const c = getCards().find((x) => x.code === code);
            return c ? cardItems(c).length : 0;
        }
        // Is the moved item currently the LAST entry in its target card?
        function isAtBottomOfCard(code, name) {
            const idx = indexOfNameInCard(code, name);
            return idx >= 0 && idx === itemCountInCard(code) - 1;
        }

        // ---- KEYBOARD DRAG (reliable fallback) -----------------------------
        // Focus handle -> Space (pick up) -> Arrow toward target until the item
        // enters the target card -> then keep nudging so it lands at the BOTTOM
        // of that card -> Space (drop). Adaptive-timed (v14.11). Precise bottom
        // placement is confirmed by index (idx === lastIdx) after each key.
        async function keyboardDrag(li, targetName, opts) {
            opts = opts || {};
            const maxSteps = opts.maxSteps || MAX_ARROW_STEPS;
            const name = itemName(li).trim();
            const handle = itemHandle(li);
            log.log(`${ts()} ===== keyboardDrag "${name}" -> "${targetName}" =====`);
            if (!handle) { log.warn(`${ts()} no drag handle on li - abort`); return { ok: false, reason: 'no-handle' }; }
            const targetCode = codeForName(targetName);
            const targetRegion = findRegionByName(getScope(), targetName);
            const liRect = li.getBoundingClientRect();
            const trRect = targetRegion ? targetRegion.getBoundingClientRect() : null;
            const goUp = !!trRect && (trRect.top < liRect.top);
            const arrowKey = goUp ? 'ArrowUp' : 'ArrowDown';
            const baseline = (regionsContainingName(name).find((h) => h.name === targetName) || { count: 0 }).count;
            log.log(`${ts()} liTop=${Math.round(liRect.top)} targetTop=${trRect ? Math.round(trRect.top) : 'n/a'} dir=${arrowKey} baseline=${baseline} targetCode=${targetCode}`);

            handle.focus();
            let live = liveRegionText();
            pressKey(handle, 'Space', ' ');
            await waitForLiveChange(live, 320);
            const pressed = handle.getAttribute('aria-pressed');
            const pickedUp = pressed === 'true' || liveRegionText() !== live;
            log.log(`${ts()} pickup: aria-pressed=${pressed} pickedUp=${pickedUp} live="${liveRegionText()}"`);
            if (!pickedUp) {
                log.warn(`${ts()} PICKUP FAILED - aborting keyboard path`);
                pressKey(document, 'Escape', 'Escape');
                return { ok: false, reason: 'pickup-failed' };
            }

            let crossed = false, steps = 0;
            for (let i = 0; i < maxSteps; i++) {
                steps++;
                live = liveRegionText();
                pressKey(document, arrowKey, arrowKey);
                const waited = await waitForLiveChange(live, 240);
                const tc = (regionsContainingName(name).find((h) => h.name === targetName) || { count: 0 }).count;
                log.log(`${ts()} step ${steps} (${arrowKey}) waited=${Math.round(waited)}ms targetCount=${tc}/${baseline}`);
                if (tc > baseline) { crossed = true; log.log(`${ts()} entered target after ${steps} step(s)`); break; }
            }
            if (!crossed) log.warn(`${ts()} did NOT confirm crossing after ${steps} ${arrowKey} steps`);

            // ---- nudge to the BOTTOM of the target card ----
            // Coming from above (ArrowDown) the item lands near the TOP, so keep
            // pressing ArrowDown until it's the last entry. Coming from below
            // (ArrowUp) it already enters at the bottom. Stop the moment idx stops
            // advancing (guards against pushing it out into the next card).
            if (crossed && arrowKey === 'ArrowDown') {
                for (let j = 0; j < maxSteps; j++) {
                    if (isAtBottomOfCard(targetCode, name)) { log.log(`${ts()} at bottom after ${j} nudge(s)`); break; }
                    const before = indexOfNameInCard(targetCode, name);
                    live = liveRegionText();
                    pressKey(document, 'ArrowDown', 'ArrowDown');
                    await waitForLiveChange(live, 240);
                    const after = indexOfNameInCard(targetCode, name);
                    const stillIn = regionsContainingName(name).some((h) => h.name === targetName);
                    if (!stillIn || after <= before) {
                        // overshot out of the card or couldn't advance: step back if we left it
                        if (!stillIn) { pressKey(document, 'ArrowUp', 'ArrowUp'); await waitForLiveChange(liveRegionText(), 240); }
                        break;
                    }
                }
            }

            live = liveRegionText();
            pressKey(document, 'Space', ' ');
            await waitForLiveChange(live, 320);
            await sleep(50);
            const finalHits = regionsContainingName(name);
            const inTargetAtAll = finalHits.some((h) => h.name === targetName);
            const finalIdx = indexOfNameInCard(targetCode, name);
            log.log(`${ts()} keyboardDrag END "${name}" inTarget=${inTargetAtAll} finalIdx=${finalIdx} steps=${steps} finalRegions=${JSON.stringify(finalHits)}`);
            return { ok: inTargetAtAll, crossed, steps, finalIdx, finalHits };
        }

        // ---- POINTER DRAG (primary: one gesture => fast, drops at the BOTTOM) --
        // dnd-kit's PointerSensor + built-in auto-scroll. We grab the handle, push
        // the pointer toward the target list (riding auto-scroll if it's off-screen),
        // aim just below the last item so the insert lands at the END of the list,
        // and only settle once the moved item is confirmed to be the last entry. If
        // we can't confirm the item is over the target we CANCEL (Escape) so nothing
        // is ever dropped in the wrong place - the caller then falls back to keyboard.
        // v15.12 JUMP DRAG. Instead of riding dnd-kit's slow auto-scroll and
        // creeping the cursor 64px/frame (which timed out on far targets and
        // "vibrated" at the end), we: pick the item up, PROGRAMMATICALLY scroll the
        // target's drop point on-screen in one shot, then move the pointer straight
        // to a spot just BELOW the last item (clear of the last/2nd-last midpoint,
        // so no oscillation) and release the moment it's confirmed last. Cost is
        // O(1) in distance and independent of zoom/resolution (all geometry from
        // getBoundingClientRect). Keyboard drag stays as the fallback.
        const MAX_JUMPS = 26;        // safety cap on scroll+jump iterations
        const PTR_SETTLE_MS = 95;    // wait after a jump for dnd-kit to reorder
        function dispatchPointer(type, x, y, el) {
            const up = type === 'pointerup' || type === 'pointercancel';
            const down = type === 'pointerdown';
            const ev = new PointerEvent(type, {
                bubbles: true, cancelable: true, composed: true,
                pointerId: 1, pointerType: 'mouse', isPrimary: true,
                clientX: x, clientY: y,
                button: up ? 0 : (down ? 0 : -1),
                buttons: up ? 0 : 1,
                pressure: up ? 0 : 0.5,
            });
            (el || document).dispatchEvent(ev);
            return ev;
        }
        async function pointerDragToBottom(li, targetName, opts) {
            opts = opts || {};
            const name = itemName(li).trim();
            const handle = itemHandle(li);
            log.log(`${ts()} ===== pointerDragToBottom(jump) "${name}" -> "${targetName}" =====`);
            if (!handle) { log.warn(`${ts()} no handle`); return { ok: false, reason: 'no-handle' }; }
            const targetCode = codeForName(targetName);

            // ---- pick up ----
            try { li.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (e) { li.scrollIntoView({ block: 'center' }); }
            await sleep(55);
            const hr = handle.getBoundingClientRect();
            const px = Math.round(hr.left + hr.width / 2);
            const py = Math.round(hr.top + hr.height / 2);
            handle.focus();
            const liveStart = liveRegionText();
            dispatchPointer('pointerdown', px, py, handle);
            await sleep(30);
            dispatchPointer('pointermove', px, py + 8, document);   // exceed activation distance
            await sleep(45);
            const pickedUp = handle.getAttribute('aria-pressed') === 'true' || liveRegionText() !== liveStart;
            log.log(`${ts()} pickup: pickedUp=${pickedUp}`);
            if (!pickedUp) {
                dispatchPointer('pointerup', px, py + 8, document);
                log.warn(`${ts()} pointer PICKUP FAILED`);
                return { ok: false, reason: 'pointer-pickup-failed' };
            }

            // Drop anchor = the target's current last item (or its list / region).
            const dropAnchor = () => lastItemOfCard(targetCode) || ulOfCard(targetCode) || findRegionByName(getScope(), targetName);
            // Programmatically bring the drop anchor to ~60% of the viewport so the
            // spot below it is comfortably on-screen (no reliance on auto-scroll).
            function scrollTargetIntoView() {
                const a = dropAnchor(); if (!a) return;
                const sp = athFindScrollParent(a);
                const vh = viewportH();
                const delta = Math.round(a.getBoundingClientRect().bottom - vh * 0.6);
                if (Math.abs(delta) > 8) {
                    if (sp === document.scrollingElement || sp === document.documentElement) window.scrollBy(0, delta);
                    else sp.scrollTop += delta;
                }
            }
            // Y just below the last item's bottom -> inserts AFTER it (bottom slot),
            // clear of the midpoint that caused the flip-flop.
            function dropY() {
                const a = dropAnchor();
                const vh = viewportH();
                if (!a) return Math.round(vh / 2);
                return Math.max(16, Math.min(vh - 16, Math.round(a.getBoundingClientRect().bottom + 12)));
            }

            // ---- jump loop: send ONE decisive pointer-move into the bottom slot,
            //      then POLL for the landing WITHOUT sending any more moves. Every
            //      pointer-move makes dnd-kit re-sort (that's the flicker), so once the
            //      item is placed we just watch until it's confirmed last and drop.
            //      Only re-jump if that single move didn't land it. ----
            let curY = py, jumps = 0, inStreak = 0;
            for (let i = 0; i < MAX_JUMPS; i++) {
                jumps++;
                scrollTargetIntoView();
                await sleep(30);
                curY = dropY();
                dispatchPointer('pointermove', px, curY, document);   // one move; no re-jiggle
                let landed = false, inTarget = false;
                const t0 = performance.now();
                while (performance.now() - t0 < 500) {
                    await sleep(25);
                    inTarget = regionsContainingName(name).some((h) => h.name === targetName);
                    // dnd-kit's live sortable preview sits one slot high when aiming at the
                    // very bottom, so treat "last OR 2nd-last" as landed - it resolves to the
                    // bottom on release (confirmed by the DROP log's atBottom=true).
                    if (inTarget) {
                        const idx = indexOfNameInCard(targetCode, name), cnt = itemCountInCard(targetCode);
                        if (idx >= 0 && idx >= cnt - 2) { landed = true; break; }
                    }
                }
                log.log(`${ts()} jump ${jumps}: curY=${curY} inTarget=${inTarget} landed=${landed} idx=${indexOfNameInCard(targetCode, name)}/${itemCountInCard(targetCode)}`);
                if (landed) break;
                inStreak = inTarget ? inStreak + 1 : 0;
                if (inStreak >= 3) { log.log(`${ts()} in target, bottom unconfirmed - dropping here`); break; }
            }

            if (regionsContainingName(name).some((h) => h.name === targetName)) {
                dispatchPointer('pointerup', px, curY, document);
                await sleep(150);
                const stillIn = regionsContainingName(name).some((h) => h.name === targetName);
                const idx = indexOfNameInCard(targetCode, name);
                const finalBottom = isAtBottomOfCard(targetCode, name);
                log.log(`${ts()} DROP inTarget=${stillIn} finalIdx=${idx}/${itemCountInCard(targetCode)} atBottom=${finalBottom} jumps=${jumps}`);
                return { ok: stillIn, finalIdx: idx, atBottom: finalBottom, jumps };
            }
            log.warn(`${ts()} never reached target after ${jumps} jumps - CANCEL, fall back to keyboard`);
            pressKey(document, 'Escape', 'Escape');
            dispatchPointer('pointercancel', px, curY, document);
            await sleep(120);
            return { ok: false, reason: 'pointer-no-target' };
        }

        // ---- Subtask 2: ensure a 97112 card exists (single click, no dup) ---
        async function ensureCard(code) {
            const before = countCards(code);
            log.log(`${ts()} ensureCard: ${code} count before=${before}`);
            if (before > 0) { log.log(`${ts()} ${code} already present - skipping +CPT dialog`); return true; }
            const scope = getScope();
            let addBtn = scope.querySelector('button[jf-ext-button-ct$="cpt"]');
            if (!addBtn) {
                for (const b of scope.querySelectorAll('button')) {
                    if ((b.textContent || '').trim() === 'CPT') { addBtn = b; break; }
                }
            }
            if (!addBtn) { log.warn(`${ts()} no +CPT button in flowsheet`); return false; }
            log.log(`${ts()} +CPT button found (jf-ext-button-ct=${JSON.stringify(addBtn.getAttribute('jf-ext-button-ct'))}); single native click`);
            addBtn.click();
            const dialog = await waitFor('[role="dialog"]', { log, timeoutMs: 3000 });
            if (!dialog) { log.warn(`${ts()} CPT dialog never appeared after native click`); return false; }
            await sleep(200);
            let opt = null;
            const options = dialog.querySelectorAll('li[role="option"]');
            for (const o of options) { if ((o.textContent || '').includes(code)) { opt = o; break; } }
            if (!opt) { log.warn(`${ts()} no ${code} option among ${options.length} dialog options`); return false; }
            if (opt.getAttribute('aria-selected') !== 'true') {
                log.log(`${ts()} ticking ${code} option (single click)`);
                opt.click();
                await sleep(250);
            } else {
                log.log(`${ts()} ${code} option already selected`);
            }
            const addCodesBtn = dialog.querySelector('button[jf-ext-button-ct*="cpt code"]');
            if (!addCodesBtn) { log.warn(`${ts()} no "Add N CPT code" button in dialog`); return false; }
            if (addCodesBtn.disabled) { log.warn(`${ts()} Add button disabled (option not ticked?)`); return false; }
            const pre = countCards(code);
            log.log(`${ts()} clicking "${addCodesBtn.textContent.trim()}" (single click); ${code} count before add=${pre}`);
            addCodesBtn.click();
            for (let i = 0; i < 20; i++) {
                await sleep(150);
                if (countCards(code) > pre) { log.log(`${ts()} ${code} card appeared after ${(i + 1) * 150}ms`); break; }
            }
            const after = countCards(code);
            log.log(`${ts()} ensureCard done: ${code} count=${after} (added ${after - before})`);
            if (after - before > 1) log.warn(`${ts()} DUPLICATE: added ${after - before} cards - single click still double-added, investigate`);
            return after > before;
        }

        // ---- full flow ------------------------------------------------------
        // Resolve every intervention via the shared matcher. An item "needs a fix"
        // when it matches a rule (not excluded) AND either it is under the wrong CPT
        // code OR it needs a rename (e.g. Rib -> "MET - Rib"). Re-scanned every pass
        // because the DOM re-renders after each move.
        function resolveItem(li, cardCode) {
            const name = itemName(li).trim();
            if (!name) return null;
            const r = Proc.resolveProcedure(name);
            if (!r || r.exclude) return null;             // no rule, or "leave alone"
            const needsMove = r.code !== cardCode;
            const needsRename = !!r.rename && r.rename !== name;
            // Standardize the MET/Rib justification even when it's already in the right
            // card (this preserves the old Fix-MET behavior). We do NOT re-append the
            // canonical text to already-correct 'append' items (avoids surprise edits to
            // everything the scribe already placed & justified); those are fixed on move.
            let needsJust = false;
            if (!needsMove && !needsRename) {
                if (r.justMode === 'replace' && r.justification) {
                    const details = li.querySelector('[contenteditable="true"][aria-label="Intervention details"]');
                    const cur = details ? (details.textContent || '').trim() : '';
                    if (cur !== r.justification) needsJust = true;
                }
                if (!needsJust) return null;               // already correct, nothing to do
            }
            return { name, from: cardCode, to: r.code, justMode: r.justMode, justification: r.justification, rename: r.rename, needsMove, needsJust, label: r.label };
        }
        function findNextFix() {
            for (const card of getCards()) {
                for (const li of cardItems(card)) {
                    const fix = resolveItem(li, card.code);
                    if (fix) return { card, li, fix };
                }
            }
            return null;
        }
        function listFixes() {
            const out = [];
            for (const card of getCards()) {
                for (const li of cardItems(card)) {
                    const fix = resolveItem(li, card.code);
                    if (fix) out.push(fix);
                }
            }
            return out;
        }

        // ---- rename + justification: shared Fixer (self-contained; see top of file) ----
        const applyItemFix = (li, fix) => Fixer.applyItemFix(li, fix, log);

        function findItemInCardByName(code, name) {
            const c = getCards().find((x) => x.code === code);
            if (!c) return null;
            return cardItems(c).find((li) => itemName(li).trim() === name) || null;
        }

        // ---- display helpers for the confirmation dialog --------------------
        const CODE_NAMES = { '97110': 'Therapeutic Exercise', '97112': 'Neuromuscular Reeducation', '97530': 'Therapeutic Activity' };
        function cardLabel(code) {
            const c = getCards().find((x) => x.code === code);
            const nm = c ? c.name : (CODE_NAMES[code] || '');
            return nm ? (code + ' ' + nm) : code;
        }
        const currentDetailsText = Fixer.currentDetailsText;
        const computeNewJust = Fixer.computeNewJust;
        async function performFix() {
            log.log(`${ts()} ================= performFix START =================`);
            const scope = getScope();
            if (!scope) { log.warn(`${ts()} no [data-section="flowsheet"]`); return { reason: 'no-flowsheet', moved: 0, renamed: 0, justified: 0 }; }
            dumpState('performFix-start');

            const fixes = listFixes();
            log.log(`${ts()} items needing a fix: ${fixes.length}`);
            if (!fixes.length) { return { reason: 'nothing-to-fix', moved: 0, renamed: 0, justified: 0 }; }

            // ---- build review rows (read the current details for a real before/after) ----
            const rows = fixes.map((f) => {
                const li = findItemInCardByName(f.from, f.name);
                const cur = li ? currentDetailsText(li) : '';
                const curName = li ? itemName(li).trim() : f.name;
                const newJust = computeNewJust(f, cur);
                const renameChange = !!f.rename && curName !== f.rename;
                const justChange = f.justMode !== 'none' && !!f.justification && newJust !== cur;
                return {
                    name: f.name, fromLabel: cardLabel(f.from), toLabel: cardLabel(f.to),
                    willMove: f.needsMove, willJust: renameChange || justChange,
                    justMode: f.justMode,
                    oldJust: justChange ? cur : '', newJust: justChange ? newJust : '',
                    appendText: (justChange && f.justMode === 'append') ? f.justification : '',
                    renameTo: renameChange ? f.rename : '',
                };
            });

            // ---- confirmation dialog ----
            const { confirmed, decisions } = await athConfirmMoves('Fix Procedures — review changes', rows);
            if (!confirmed) { log.log(`${ts()} user cancelled`); return { reason: 'cancelled', moved: 0, renamed: 0, justified: 0 }; }
            const byName = {};
            decisions.forEach((d) => { byName[d.name] = d; });
            const toDo = fixes.filter((f) => { const d = byName[f.name]; return d && ((d.moveChecked && f.needsMove) || d.justChecked); });
            if (!toDo.length) { log.log(`${ts()} nothing checked`); return { reason: 'nothing-checked', moved: 0, renamed: 0, justified: 0 }; }

            // ---- execute the approved changes (with a live progress toast) ----
            const prog = athToast('Fixing procedures…', { ttl: 0 });
            let moved = 0, renamed = 0, justified = 0, usePointer = true;

            for (const f of toDo) {
                const d = byName[f.name];
                const doMove = d.moveChecked && f.needsMove;
                const doJust = d.justChecked;

                if (doMove) {
                    prog.update('Moving “' + f.name + '” → ' + cardLabel(f.to));
                    log.log(`${ts()} --- move "${f.name}" ${f.from} -> ${f.to} ---`);
                    let target = getCards().find((c) => c.code === f.to);
                    if (!target) {
                        const ok = await ensureCard(f.to);
                        if (!ok) { log.warn(`${ts()} could not add ${f.to}; skip`); continue; }
                        await sleep(400); target = getCards().find((c) => c.code === f.to);
                    }
                    if (!target) { log.warn(`${ts()} still no ${f.to}; skip`); continue; }
                    const targetName = target.name;
                    const srcLi = findItemInCardByName(f.from, f.name);
                    if (!srcLi) { log.warn(`${ts()} "${f.name}" not found in ${f.from}; skip`); continue; }
                    let res = usePointer ? await pointerDragToBottom(srcLi, targetName, {}) : await keyboardDrag(srcLi, targetName, {});
                    if (usePointer && (!res || !res.ok)) {
                        log.warn(`${ts()} pointer failed; keyboard for the remainder`);
                        usePointer = false; await sleep(150);
                        const again = findItemInCardByName(f.from, f.name);
                        if (again) res = await keyboardDrag(again, targetName, {});
                    }
                    if (!res || !res.ok) { log.warn(`${ts()} move of "${f.name}" failed; skipping it`); athToast('Could not move “' + f.name + '”', { ttl: 3200 }); continue; }
                    moved++; await sleep(170);
                    if (doJust) {
                        const movedLi = findItemInCardByName(f.to, f.name);
                        if (movedLi) { const r = await applyItemFix(movedLi, f); if (r.renamed) renamed++; if (r.justified) justified++; }
                    }
                } else if (doJust) {
                    prog.update('Updating “' + f.name + '”');
                    const li = findItemInCardByName(f.from, f.name);
                    if (li) { const r = await applyItemFix(li, f); if (r.renamed) renamed++; if (r.justified) justified++; }
                }
                await sleep(110);
            }

            prog.done(300);
            const summary = [moved ? 'moved ' + moved : '', renamed ? 'renamed ' + renamed : '', justified ? 'justified ' + justified : ''].filter(Boolean).join(', ') || 'no changes';
            athToast('Done: ' + summary + '. Click Apply Scribe to save.', { ttl: 4200 });
            log.log(`${ts()} ================= performFix END: ${summary} =================`);
            return { reason: 'ok', moved, renamed, justified };
        }

        // ---- Subtask 1: header button --------------------------------------
        function findFlowsheetHeaderRow() {
            const section = getScope();
            if (!section) return null;
            return section.querySelector(
                ':scope > div.tr-grid.tr-w-full.tr-py-2, :scope > div > div.tr-grid.tr-w-full.tr-py-2'
            );
        }
        function injectHeaderButton() {
            if (document.getElementById(HEADER_BTN_ID)) return;
            const row = findFlowsheetHeaderRow();
            if (!row) return;
            const btn = document.createElement('button');
            btn.id = HEADER_BTN_ID;
            btn.type = 'button';
            btn.textContent = 'Fix Procedures';
            btn.title = 'Move every intervention to its correct CPT code (97110/97112/97530) per the therapist\'s rules, via a real dnd-kit drag - including MET -> 97112. Renames Rib -> "MET - Rib" and appends the canonical justification. Excluded items (Bridges, TKE) are left alone. Click Apply Scribe afterwards to persist.';
            Object.assign(btn.style, {
                justifySelf: 'end', alignSelf: 'center', marginRight: '12px',
                padding: '4px 10px', background: '#c33', color: '#fff',
                border: '1px solid #a22', borderRadius: '4px',
                font: '500 12px/1.2 system-ui, sans-serif', cursor: 'pointer', whiteSpace: 'nowrap',
            });
            btn.addEventListener('mouseenter', () => { btn.style.background = '#a22'; });
            btn.addEventListener('mouseleave', () => { btn.style.background = '#c33'; });
            btn.addEventListener('click', async (ev) => {
                ev.preventDefault(); ev.stopPropagation();
                btn.disabled = true; btn.textContent = 'Working…'; btn.style.background = '#888';
                try {
                    const result = await performFix();
                    const parts = [];
                    if (result.moved) parts.push(`moved ${result.moved}`);
                    if (result.renamed) parts.push(`renamed ${result.renamed}`);
                    if (result.justified) parts.push(`just. ${result.justified}`);
                    const didSomething = result.moved || result.renamed || result.justified;
                    btn.textContent = didSomething ? parts.join(', ') : (result.reason || 'no-op');
                    btn.style.background = didSomething ? '#2a7' : '#888';
                } catch (err) {
                    log.error(`${ts()} performFix threw:`, err);
                    btn.textContent = 'error'; btn.style.background = '#888';
                } finally {
                    setTimeout(() => { btn.textContent = 'Fix Procedures'; btn.style.background = '#c33'; btn.disabled = false; }, 3500);
                }
            });
            row.appendChild(btn);
            log.log(`${ts()} injected Fix Procedures header button`);
        }

        injectHeaderButton();
        let pending = null;
        const obs = new MutationObserver(() => {
            if (pending) return;
            pending = setTimeout(() => { pending = null; injectHeaderButton(); }, 250);
        });
        const startObs = () => {
            obs.observe(document.body, { childList: true, subtree: true });
            log.log(`${ts()} MutationObserver attached (re-injects button on re-mount)`);
        };
        if (document.body) startObs();
        else new MutationObserver((_, o) => { if (document.body) { o.disconnect(); startObs(); } }).observe(document.documentElement, { childList: true });

        // ---- DevTools hooks -------------------------------------------------
        window.__athelasFixProcedures = performFix;
        window.__athelasFixMET = performFix;   // back-compat alias
        window.__athelasListFixes = () => { const r = listFixes(); console.table(r); return r; };
        window.__athelasDbgFlowsheet = () => { dumpState('manual'); return getCards().map((c) => ({ code: c.code, name: c.name, region: !!c.region, ul: !!c.ul, items: cardItems(c).map((li) => itemName(li).trim()) })); };
        window.__athelasListProcedureCards = () => { const r = getCards().map((c) => ({ code: c.code, name: c.name, items: cardItems(c).length })); console.table(r); return r; };
        window.__athelasKbdDragFirstFix = async () => {
            const next = findNextFix();
            if (!next) { log.warn('nothing to fix'); return; }
            const tgt = getCards().find((c) => c.code === next.fix.to);
            if (!tgt) { log.warn(`no ${next.fix.to} card present - create it first or run __athelasFixProcedures()`); return; }
            log.log(`kbd-drag test: "${next.fix.name}" from ${next.fix.from} -> ${next.fix.to}`);
            return keyboardDrag(next.li, tgt.name, {});
        };
        window.__athelasPointerDragFirstFix = async () => {
            const next = findNextFix();
            if (!next) { log.warn('nothing to fix'); return; }
            const tgt = getCards().find((c) => c.code === next.fix.to);
            if (!tgt) { log.warn(`no ${next.fix.to} card present`); return; }
            log.log(`pointer-drag test: "${next.fix.name}" from ${next.fix.from} -> ${next.fix.to}`);
            return pointerDragToBottom(next.li, tgt.name, {});
        };
        log.log(`${ts()} hooks ready: __athelasFixProcedures, __athelasListFixes, __athelasKbdDragFirstFix, __athelasPointerDragFirstFix, __athelasDbgFlowsheet, __athelasListProcedureCards`);
    }

    // =====================================================================
    // MODULE 11: Fix Private Pay.
    //
    // Private-pay ("selfpay") patients have a "PPVISIT - Visit-Private Pay"
    // CPT card in the flowsheet (their insurance policy # is 00000). Because
    // they pay in the clinic, their work does not need to be billed under the
    // real CPT codes - the therapist wants every procedure they actually did
    // (the ones check-marked "Done") collected into the private-pay section.
    //
    // This button scans every OTHER CPT card for interventions whose "Done"
    // checkbox is checked and drags each one down into the private-pay card,
    // reusing the same dnd-kit drag machinery proven by Fix MET (pointer path
    // first, keyboard path as fallback). It moves ONLY "Done" items and never
    // touches the private-pay card's own contents.
    //
    // The button only appears for private-pay patients (i.e. when a PPVISIT /
    // "Visit-Private Pay" card exists) and is placed just above that section.
    //
    // Run in DevTools:  window.__athelasFixPrivatePay()
    // =====================================================================
    function featureFixPrivatePay() {
        const log = makeLogger('fix-pp');
        const T0 = performance.now();
        const ts = () => `+${(performance.now() - T0).toFixed(0)}ms`;
        log.log(`${ts()} module booted, Fix Private Pay`);

        const BTN_ID = 'athelas-fix-privatepay-btn';
        const MAX_ARROW_STEPS = 60;

        const getScope = () => document.querySelector('[data-section="flowsheet"]');

        function liveRegionEl() {
            return document.querySelector('[id^="DndLiveRegion"]')
                || document.querySelector('[aria-live][role="status"]');
        }
        function liveRegionText() {
            const lr = liveRegionEl();
            return lr ? (lr.textContent || '').trim() : '(no DndLiveRegion)';
        }

        // ---- card / item model (handles numeric CPT codes AND non-numeric
        // codes like "PPVISIT"; the MET module's getCards only matched 5-digit
        // codes, so this one is deliberately separate). ----------------------
        function findRegionByName(scope, name) {
            for (const r of scope.querySelectorAll('[role="region"][aria-label$=" interventions"]')) {
                if (r.getAttribute('aria-label') === `${name} interventions`) return r;
            }
            return null;
        }
        function getCards() {
            const scope = getScope();
            if (!scope) return [];
            const cards = [];
            for (const input of scope.querySelectorAll('input[aria-label="replace procedure"]')) {
                const val = input.value || input.getAttribute('value') || '';
                const m = val.match(/^(\S+)\s*-\s*(.+?)\s*$/);   // "97110 - Therapeutic Exercise" | "PPVISIT - Visit-Private Pay"
                if (!m) continue;
                const code = m[1];
                const name = m[2].trim();
                const region = findRegionByName(scope, name);
                const ul = region ? region.querySelector('ul[aria-label$=" intervention list"]') : null;
                cards.push({ code, name, input, region, ul });
            }
            return cards;
        }
        const isPrivatePayCard = (c) => c.code.toUpperCase() === 'PPVISIT' || /private\s*pay/i.test(c.name);
        function targetCard() { return getCards().find(isPrivatePayCard) || null; }

        function cardItems(card) {
            if (!card || !card.region) return [];
            const ul = card.region.querySelector('ul[aria-label$=" intervention list"]');
            if (!ul) return [];
            return Array.from(ul.querySelectorAll(':scope > li[aria-label="Intervention"]'));
        }
        function itemName(li) {
            const i = li.querySelector('input[aria-label="Intervention name"]');
            return i ? (i.value || i.getAttribute('value') || '') : '';
        }
        function itemHandle(li) {
            return li.querySelector('[aria-label="Drag to reorder"][role="button"]')
                || li.querySelector('[aria-label="Drag to reorder"]');
        }
        // A procedure is "Done" when its Done checkbox is checked.
        function isDone(li) {
            const cb = li.querySelector('input[aria-label="Done"]');
            return !!(cb && cb.checked);
        }

        function regionsContainingName(name) {
            const target = (name || '').trim();
            const hits = [];
            for (const card of getCards()) {
                const n = cardItems(card).map((li) => itemName(li).trim()).filter((x) => x === target).length;
                if (n) hits.push({ code: card.code, name: card.name, count: n });
            }
            return hits;
        }
        function codeForName(nm) { const c = getCards().find((x) => x.name === nm); return c ? c.code : undefined; }
        function indexOfNameInCard(code, itemNm) {
            const c = getCards().find((x) => x.code === code);
            if (!c) return -1;
            return cardItems(c).map((li) => itemName(li).trim()).indexOf((itemNm || '').trim());
        }
        function viewportH() { return document.documentElement.clientHeight || window.innerHeight || 800; }
        function firstItemOfCard(code) {
            const c = getCards().find((x) => x.code === code);
            if (!c || !c.region) return null;
            const ul = c.region.querySelector('ul[aria-label$=" intervention list"]');
            return ul ? ul.querySelector(':scope > li[aria-label="Intervention"]') : null;
        }
        function ulOfCard(code) {
            const c = getCards().find((x) => x.code === code);
            if (!c || !c.region) return null;
            return c.region.querySelector('ul[aria-label$=" intervention list"]');
        }
        function lastItemOfCard(code) {
            const ul = ulOfCard(code);
            if (!ul) return null;
            const items = ul.querySelectorAll(':scope > li[aria-label="Intervention"]');
            return items.length ? items[items.length - 1] : null;
        }
        function itemCountInCard(code) {
            const c = getCards().find((x) => x.code === code);
            return c ? cardItems(c).length : 0;
        }
        function isAtBottomOfCard(code, name) {
            const idx = indexOfNameInCard(code, name);
            return idx >= 0 && idx === itemCountInCard(code) - 1;
        }

        // ---- synthetic keyboard (dnd-kit KeyboardSensor) --------------------
        const KEYCODES = { Space: 32, ArrowDown: 40, ArrowUp: 38, Escape: 27, Enter: 13 };
        function dispatchKey(el, type, code, key) {
            const ev = new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true });
            const kc = KEYCODES[code] || 0;
            try { Object.defineProperty(ev, 'keyCode', { get: () => kc }); } catch (e) {}
            try { Object.defineProperty(ev, 'which', { get: () => kc }); } catch (e) {}
            el.dispatchEvent(ev);
            return ev;
        }
        function pressKey(el, code, key) { dispatchKey(el, 'keydown', code, key); dispatchKey(el, 'keyup', code, key); }
        async function waitForLiveChange(prevLive, maxMs) {
            maxMs = maxMs || 220;
            const start = performance.now();
            while (performance.now() - start < maxMs) {
                if (liveRegionText() !== prevLive) return performance.now() - start;
                await sleep(6);
            }
            return -1;
        }

        // ---- KEYBOARD DRAG (reliable fallback) -----------------------------
        async function keyboardDrag(li, targetName, opts) {
            opts = opts || {};
            const maxSteps = opts.maxSteps || MAX_ARROW_STEPS;
            const name = itemName(li).trim();
            const handle = itemHandle(li);
            log.log(`${ts()} ===== keyboardDrag "${name}" -> "${targetName}" =====`);
            if (!handle) { log.warn(`${ts()} no drag handle on li - abort`); return { ok: false, reason: 'no-handle' }; }
            const targetCode = codeForName(targetName);
            const targetRegion = findRegionByName(getScope(), targetName);
            const liRect = li.getBoundingClientRect();
            const trRect = targetRegion ? targetRegion.getBoundingClientRect() : null;
            const goUp = !!trRect && (trRect.top < liRect.top);
            const arrowKey = goUp ? 'ArrowUp' : 'ArrowDown';
            const baseline = (regionsContainingName(name).find((h) => h.name === targetName) || { count: 0 }).count;

            handle.focus();
            let live = liveRegionText();
            pressKey(handle, 'Space', ' ');
            await waitForLiveChange(live, 320);
            const pickedUp = handle.getAttribute('aria-pressed') === 'true' || liveRegionText() !== live;
            if (!pickedUp) { log.warn(`${ts()} PICKUP FAILED`); pressKey(document, 'Escape', 'Escape'); return { ok: false, reason: 'pickup-failed' }; }

            let crossed = false, steps = 0;
            for (let i = 0; i < maxSteps; i++) {
                steps++;
                live = liveRegionText();
                pressKey(document, arrowKey, arrowKey);
                await waitForLiveChange(live, 240);
                const tc = (regionsContainingName(name).find((h) => h.name === targetName) || { count: 0 }).count;
                if (tc > baseline) { crossed = true; break; }
            }
            // nudge to the BOTTOM of the target card (see MODULE 9 for rationale)
            if (crossed && arrowKey === 'ArrowDown') {
                for (let j = 0; j < maxSteps; j++) {
                    if (isAtBottomOfCard(targetCode, name)) break;
                    const before = indexOfNameInCard(targetCode, name);
                    live = liveRegionText();
                    pressKey(document, 'ArrowDown', 'ArrowDown');
                    await waitForLiveChange(live, 240);
                    const after = indexOfNameInCard(targetCode, name);
                    const stillIn = regionsContainingName(name).some((h) => h.name === targetName);
                    if (!stillIn || after <= before) {
                        if (!stillIn) { pressKey(document, 'ArrowUp', 'ArrowUp'); await waitForLiveChange(liveRegionText(), 240); }
                        break;
                    }
                }
            }
            live = liveRegionText();
            pressKey(document, 'Space', ' ');
            await waitForLiveChange(live, 320);
            await sleep(50);
            const inTarget = regionsContainingName(name).some((h) => h.name === targetName);
            const finalIdx = indexOfNameInCard(targetCode, name);
            log.log(`${ts()} keyboardDrag END "${name}" inTarget=${inTarget} crossed=${crossed} steps=${steps} finalIdx=${finalIdx}`);
            return { ok: inTarget, crossed, steps, finalIdx };
        }

        // ---- POINTER DRAG (v15.12 JUMP: scroll target on-screen + single jump to
        //      the bottom slot; O(1) in distance, no end-vibration; see MODULE 9). --
        const MAX_JUMPS = 26, PTR_SETTLE_MS = 95;
        function dispatchPointer(type, x, y, el) {
            const up = type === 'pointerup' || type === 'pointercancel';
            const down = type === 'pointerdown';
            const ev = new PointerEvent(type, {
                bubbles: true, cancelable: true, composed: true,
                pointerId: 1, pointerType: 'mouse', isPrimary: true,
                clientX: x, clientY: y,
                button: up ? 0 : (down ? 0 : -1),
                buttons: up ? 0 : 1, pressure: up ? 0 : 0.5,
            });
            (el || document).dispatchEvent(ev);
            return ev;
        }
        async function pointerDragToBottom(li, targetName, opts) {
            opts = opts || {};
            const name = itemName(li).trim();
            const handle = itemHandle(li);
            log.log(`${ts()} ===== pointerDragToBottom(jump) "${name}" -> "${targetName}" =====`);
            if (!handle) { log.warn(`${ts()} no handle`); return { ok: false, reason: 'no-handle' }; }
            const targetCode = codeForName(targetName);

            try { li.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (e) { li.scrollIntoView({ block: 'center' }); }
            await sleep(55);
            const hr = handle.getBoundingClientRect();
            const px = Math.round(hr.left + hr.width / 2);
            const py = Math.round(hr.top + hr.height / 2);
            handle.focus();
            const liveStart = liveRegionText();
            dispatchPointer('pointerdown', px, py, handle);
            await sleep(30);
            dispatchPointer('pointermove', px, py + 8, document);
            await sleep(45);
            const pickedUp = handle.getAttribute('aria-pressed') === 'true' || liveRegionText() !== liveStart;
            if (!pickedUp) { dispatchPointer('pointerup', px, py + 8, document); log.warn(`${ts()} pointer PICKUP FAILED`); return { ok: false, reason: 'pointer-pickup-failed' }; }

            const dropAnchor = () => lastItemOfCard(targetCode) || ulOfCard(targetCode) || findRegionByName(getScope(), targetName);
            function scrollTargetIntoView() {
                const a = dropAnchor(); if (!a) return;
                const sp = athFindScrollParent(a);
                const vh = viewportH();
                const delta = Math.round(a.getBoundingClientRect().bottom - vh * 0.6);
                if (Math.abs(delta) > 8) {
                    if (sp === document.scrollingElement || sp === document.documentElement) window.scrollBy(0, delta);
                    else sp.scrollTop += delta;
                }
            }
            function dropY() {
                const a = dropAnchor();
                const vh = viewportH();
                if (!a) return Math.round(vh / 2);
                return Math.max(16, Math.min(vh - 16, Math.round(a.getBoundingClientRect().bottom + 12)));
            }

            let curY = py, jumps = 0, inStreak = 0;
            for (let i = 0; i < MAX_JUMPS; i++) {
                jumps++;
                scrollTargetIntoView();
                await sleep(30);
                curY = dropY();
                dispatchPointer('pointermove', px, curY, document);   // one move; then poll (no re-jiggle)
                let landed = false, inTarget = false;
                const t0 = performance.now();
                while (performance.now() - t0 < 500) {
                    await sleep(25);
                    inTarget = regionsContainingName(name).some((h) => h.name === targetName);
                    // dnd-kit's live sortable preview sits one slot high when aiming at the
                    // very bottom, so treat "last OR 2nd-last" as landed - it resolves to the
                    // bottom on release (confirmed by the DROP log's atBottom=true).
                    if (inTarget) {
                        const idx = indexOfNameInCard(targetCode, name), cnt = itemCountInCard(targetCode);
                        if (idx >= 0 && idx >= cnt - 2) { landed = true; break; }
                    }
                }
                log.log(`${ts()} jump ${jumps}: curY=${curY} inTarget=${inTarget} landed=${landed} idx=${indexOfNameInCard(targetCode, name)}/${itemCountInCard(targetCode)}`);
                if (landed) break;
                inStreak = inTarget ? inStreak + 1 : 0;
                if (inStreak >= 3) { log.log(`${ts()} in target, bottom unconfirmed - dropping here`); break; }
            }
            if (regionsContainingName(name).some((h) => h.name === targetName)) {
                dispatchPointer('pointerup', px, curY, document);
                await sleep(150);
                const stillIn = regionsContainingName(name).some((h) => h.name === targetName);
                const idx = indexOfNameInCard(targetCode, name);
                const finalBottom = isAtBottomOfCard(targetCode, name);
                log.log(`${ts()} DROP inTarget=${stillIn} finalIdx=${idx}/${itemCountInCard(targetCode)} atBottom=${finalBottom} jumps=${jumps}`);
                return { ok: stillIn, finalIdx: idx, atBottom: finalBottom, jumps };
            }
            log.warn(`${ts()} never reached target after ${jumps} jumps - CANCEL, fall back to keyboard`);
            pressKey(document, 'Escape', 'Escape');
            dispatchPointer('pointercancel', px, curY, document);
            await sleep(120);
            return { ok: false, reason: 'pointer-no-target' };
        }

        // ---- scan: Done items outside the private-pay card -----------------
        function findNextDone() {
            const tgt = targetCard();
            const tname = tgt ? tgt.name : null;
            for (const card of getCards()) {
                if (tname && card.name === tname) continue;   // never touch the private-pay card itself
                for (const li of cardItems(card)) {
                    if (isDone(li)) return { card, li, name: itemName(li).trim() };
                }
            }
            return null;
        }
        function listDone() {
            const out = [];
            const tgt = targetCard();
            const tname = tgt ? tgt.name : null;
            for (const card of getCards()) {
                if (tname && card.name === tname) continue;
                for (const li of cardItems(card)) {
                    if (isDone(li)) out.push({ code: card.code, name: itemName(li).trim() });
                }
            }
            return out;
        }

        function cardLabelPP(code) {
            const c = getCards().find((x) => x.code === code);
            return c ? (c.code + ' ' + c.name) : code;
        }
        function findSourceItem(name) {
            const t = targetCard(); const tn = t ? t.name : null;
            for (const card of getCards()) {
                if (tn && card.name === tn) continue;   // never touch the private-pay card
                const li = cardItems(card).find((x) => itemName(x).trim() === name);
                if (li) return li;
            }
            return null;
        }
        function findInTarget(name) {
            const t = targetCard(); if (!t) return null;
            return cardItems(t).find((li) => itemName(li).trim() === name) || null;
        }
        // The matched rule's justification/rename for a Done item. The DESTINATION is
        // always private pay (billing), but the fix-up is the SAME as Fix Procedures.
        function justFixFor(name) {
            const r = Proc.resolveProcedure(name);
            if (!r || r.exclude) return { justMode: 'none', justification: null, rename: null };
            return { justMode: r.justMode, justification: r.justification, rename: r.rename };
        }

        async function performFix() {
            log.log(`${ts()} ================= performFix START =================`);
            const scope = getScope();
            if (!scope) { log.warn(`${ts()} no [data-section="flowsheet"]`); return { moved: 0, reason: 'no-flowsheet' }; }
            const tgt = targetCard();
            if (!tgt) { log.warn(`${ts()} no private-pay (PPVISIT) card - not a private-pay chart`); return { moved: 0, reason: 'no-ppvisit-card' }; }
            if (!tgt.region) { log.warn(`${ts()} private-pay card has no region/list yet`); return { moved: 0, reason: 'no-ppvisit-region' }; }
            const targetName = tgt.name;
            const toLabel = cardLabelPP(tgt.code);

            const initial = listDone();
            log.log(`${ts()} Done items to move: ${initial.length}`);
            if (!initial.length) { log.log(`${ts()} nothing marked Done outside private pay`); return { moved: 0, reason: 'no-done-items' }; }

            // ---- review rows: movement -> private pay + the SAME justification/rename ----
            const rows = initial.map((it) => {
                const li = findSourceItem(it.name);
                const cur = li ? Fixer.currentDetailsText(li) : '';
                const curName = li ? itemName(li).trim() : it.name;
                const fx = justFixFor(it.name);
                const newJust = Fixer.computeNewJust(fx, cur);
                const renameChange = !!fx.rename && curName !== fx.rename;
                const justChange = fx.justMode !== 'none' && !!fx.justification && newJust !== cur;
                return {
                    name: it.name, fromLabel: cardLabelPP(it.code), toLabel: toLabel,
                    willMove: true, willJust: renameChange || justChange,
                    justMode: fx.justMode,
                    oldJust: justChange ? cur : '', newJust: justChange ? newJust : '',
                    appendText: (justChange && fx.justMode === 'append') ? fx.justification : '',
                    renameTo: renameChange ? fx.rename : '',
                };
            });

            const { confirmed, decisions } = await athConfirmMoves('Fix Private Pay — review changes', rows);
            if (!confirmed) { log.log(`${ts()} user cancelled`); return { moved: 0, reason: 'cancelled' }; }
            const byName = {};
            decisions.forEach((d) => { byName[d.name] = d; });
            const toDo = initial.filter((it) => { const d = byName[it.name]; return d && (d.moveChecked || d.justChecked); });
            if (!toDo.length) { log.log(`${ts()} nothing checked`); return { moved: 0, reason: 'nothing-checked' }; }

            // ---- execute (with a live progress toast) ----
            const prog = athToast('Moving to private pay…', { ttl: 0 });
            let moved = 0, renamed = 0, justified = 0, usePointer = true;

            for (const it of toDo) {
                const d = byName[it.name];
                const fx = justFixFor(it.name);
                const doMove = d.moveChecked;
                const doJust = d.justChecked;

                if (doMove) {
                    prog.update('Moving “' + it.name + '” → ' + toLabel);
                    log.log(`${ts()} --- moving Done "${it.name}" -> private pay (mode=${usePointer ? 'pointer' : 'keyboard'}) ---`);
                    const srcLi = findSourceItem(it.name);
                    if (!srcLi) { log.warn(`${ts()} "${it.name}" not found; skip`); continue; }
                    let res = usePointer ? await pointerDragToBottom(srcLi, targetName, {}) : await keyboardDrag(srcLi, targetName, {});
                    if (usePointer && (!res || !res.ok)) {
                        log.warn(`${ts()} pointer failed; keyboard for the remainder`);
                        usePointer = false; await sleep(150);
                        const again = findSourceItem(it.name);
                        if (again) res = await keyboardDrag(again, targetName, {});
                    }
                    if (!res || !res.ok) { log.warn(`${ts()} move of "${it.name}" failed; skip`); athToast('Could not move “' + it.name + '”', { ttl: 3200 }); continue; }
                    moved++; await sleep(170);
                    if (doJust) {
                        const movedLi = findInTarget(it.name);
                        if (movedLi) { const r = await Fixer.applyItemFix(movedLi, fx, log); if (r.renamed) renamed++; if (r.justified) justified++; }
                    }
                } else if (doJust) {
                    prog.update('Updating “' + it.name + '”');
                    const li = findSourceItem(it.name);
                    if (li) { const r = await Fixer.applyItemFix(li, fx, log); if (r.renamed) renamed++; if (r.justified) justified++; }
                }
                await sleep(110);
            }
            prog.done(300);
            const summary = [moved ? 'moved ' + moved : '', renamed ? 'renamed ' + renamed : '', justified ? 'justified ' + justified : ''].filter(Boolean).join(', ') || 'no changes';
            athToast('Done: ' + summary + '. Click Apply Scribe to save.', { ttl: 4200 });
            log.log(`${ts()} ================= performFix END: ${summary} =================`);
            return { moved, renamed, justified, reason: 'ok' };
        }
        // ---- button (above the private-pay section) ------------------------
        function injectButton() {
            if (document.getElementById(BTN_ID)) return;
            const scope = getScope();
            if (!scope) return;
            const tgt = targetCard();
            if (!tgt || !tgt.region) return;   // only private-pay patients get the button
            const region = tgt.region;

            const btn = document.createElement('button');
            btn.id = BTN_ID;
            btn.type = 'button';
            btn.textContent = 'Fix Private Pay';
            btn.title = 'Move every procedure check-marked "Done" from the CPT cards down into the Private Pay (PPVISIT) section via a real dnd-kit drag. Click Apply Scribe afterwards to persist.';
            Object.assign(btn.style, {
                display: 'block', margin: '8px 0', padding: '5px 12px',
                background: '#6b3fa0', color: '#fff', border: '1px solid #532f7d',
                borderRadius: '4px', font: '600 12px/1.2 system-ui, sans-serif',
                cursor: 'pointer', whiteSpace: 'nowrap',
            });
            btn.addEventListener('mouseenter', () => { btn.style.background = '#532f7d'; });
            btn.addEventListener('mouseleave', () => { btn.style.background = '#6b3fa0'; });
            btn.addEventListener('click', async (ev) => {
                ev.preventDefault(); ev.stopPropagation();
                btn.disabled = true; btn.textContent = 'Working…'; btn.style.background = '#888';
                try {
                    const result = await performFix();
                    const didSomething = !!result.moved;
                    btn.textContent = didSomething ? `moved ${result.moved}` : (result.reason || 'no-op');
                    btn.style.background = didSomething ? '#2a7' : '#888';
                } catch (err) {
                    log.error(`${ts()} performFix threw:`, err);
                    btn.textContent = 'error'; btn.style.background = '#888';
                } finally {
                    setTimeout(() => { btn.textContent = 'Fix Private Pay'; btn.style.background = '#6b3fa0'; btn.disabled = false; }, 3500);
                }
            });
            // Place the button just ABOVE the private-pay section.
            region.parentNode.insertBefore(btn, region);
            log.log(`${ts()} injected Fix Private Pay button above "${tgt.name}"`);
        }

        injectButton();
        let pending = null;
        const obs = new MutationObserver(() => {
            if (pending) return;
            pending = setTimeout(() => { pending = null; injectButton(); }, 250);
        });
        const startObs = () => { obs.observe(document.body, { childList: true, subtree: true }); };
        if (document.body) startObs();
        else new MutationObserver((_, o) => { if (document.body) { o.disconnect(); startObs(); } }).observe(document.documentElement, { childList: true });

        // ---- DevTools hooks -------------------------------------------------
        window.__athelasFixPrivatePay = performFix;
        window.__athelasListPrivatePayDone = () => { const r = listDone(); console.table(r); return r; };
        window.__athelasPrivatePayTarget = () => { const t = targetCard(); return t ? { code: t.code, name: t.name, region: !!t.region } : null; };
        log.log(`${ts()} hooks ready: __athelasFixPrivatePay, __athelasListPrivatePayDone, __athelasPrivatePayTarget`);
    }

    // =====================================================================
    // MODULE 10 (preview / read-only): generalized procedure matcher.
    //
    // Extends the Fix-MET idea to the therapist's full canonical list from
    // "Stuff for EMR.xlsx". THIS DOES NOT MOVE ANYTHING. It only scans the
    // flowsheet and reports, per intervention, which canonical procedure it
    // matched and whether it's currently under the wrong CPT code. Once the
    // edge-case questions in redesign/procedure-matching-QUESTIONS.md are
    // answered, the same table drives the real move (reusing the Fix-MET
    // drag machinery). Kept separate + read-only so it can't break the
    // working Fix-MET button while the matching is still being tuned.
    //
    // Run in DevTools:  window.__athelasScanProcedures()
    // The matching table here is a copy of redesign/procedure-matching.js -
    // keep the two in sync when tuning.
    // =====================================================================
    function featureProcedureMatchPreview() {
        const log = makeLogger('proc-match');

        const resolveProcedure = Proc.resolveProcedure;   // shared engine (see SHARED block near top)
        window.__athelasResolveProcedure = resolveProcedure;

        // Minimal, independent flowsheet scanner (mirrors the Fix-MET model).
        function scanFlowsheet() {
            const scope = document.querySelector('[data-section="flowsheet"]');
            if (!scope) return [];
            const cards = [];
            for (const input of scope.querySelectorAll('input[aria-label="replace procedure"]')) {
                const val = input.value || input.getAttribute('value') || '';
                const m = val.match(/^(\d{5})\s*-\s*(.+?)\s*$/);
                if (!m) continue;
                const code = m[1], name = m[2].trim();
                let region = null;
                for (const r of scope.querySelectorAll('[role="region"][aria-label$=" interventions"]')) {
                    if (r.getAttribute('aria-label') === name + ' interventions') { region = r; break; }
                }
                const ul = region ? region.querySelector('ul[aria-label$=" intervention list"]') : null;
                const items = ul ? Array.from(ul.querySelectorAll(':scope > li[aria-label="Intervention"]')) : [];
                cards.push({ code, name, items });
            }
            return cards;
        }
        const liName = (li) => { const i = li.querySelector('input[aria-label="Intervention name"]'); return i ? (i.value || i.getAttribute('value') || '') : ''; };

        function scanProcedures() {
            const cards = scanFlowsheet();
            log.log('scan: ' + cards.length + ' CPT card(s) in flowsheet');
            const rows = [];
            for (const card of cards) {
                for (const li of card.items) {
                    const name = liName(li).trim();
                    if (!name) continue;
                    const r = resolveProcedure(name);
                    let action = '(no match)';
                    if (r && r.exclude) action = 'leave alone';
                    else if (r) action = (r.code !== card.code ? 'MOVE -> ' + r.code : 'stay ' + r.code);
                    rows.push({
                        name,
                        now: card.code,
                        rule: r ? r.label : '',
                        action,
                        rename: r && r.rename ? r.rename : '',
                        just: r && !r.exclude ? r.justMode : '',
                        justPreview: r && r.justification ? r.justification.slice(0, 50) : '',
                    });
                }
            }
            const wouldMove = rows.filter((x) => x.action.startsWith('MOVE'));
            const wouldRename = rows.filter((x) => x.rename);
            log.log('%cscan: ' + rows.length + ' item(s) | ' + wouldMove.length + ' would MOVE | ' + wouldRename.length + ' would RENAME (read-only, nothing changed)', 'color:#2a7;font-weight:bold');
            if (console.table) console.table(rows);
            for (const r of wouldMove) log.log('  MOVE: "' + r.name + '"  ' + r.now + ' -> ' + r.action.replace('MOVE -> ', '') + '  (' + r.rule + ')' + (r.rename ? '  rename->"' + r.rename + '"' : ''));
            return rows;
        }
        window.__athelasScanProcedures = scanProcedures;
        log.log('proc-match preview ready (read-only, finalized rules). Run window.__athelasScanProcedures(). Nothing moves/renames yet.');
    }

    // =====================================================================
    // Boot: run each module in turn. They're independent.
    //
    // The button/preview features are observer-driven and self-heal, so we
    // initialize them ONCE regardless of the entry page - their MutationObservers
    // inject the buttons whenever a flowsheet / private-pay section appears, which
    // is exactly what makes them survive SPA navigation into a chart note. CSS and
    // jump-to-flowsheet are (re)applied per-navigation via onUrlChange.
    // Legacy modules disabled in the v14 site rework live in
    // athelas-appointments-compact.archive.js (see note above MODULE 9).
    // =====================================================================
    applyCompactCss();
    featureFixMisplacedMET();
    featureFixPrivatePay();
    featureProcedureMatchPreview();

    // Jump to the flowsheet only when we ENTER a new chart note (its patient +
    // appointment id changes) - NOT on same-note section clicks, which also change
    // the SPA URL and were making the page jump back down to the flowsheet (v15.10).
    function chartNoteKey() {
        const m = location.pathname.match(/^\/ehr\/v2\/patients\/([^/]+)\/appointments\/([^/]+)/);
        return m ? m[1] + '/' + m[2] : null;
    }
    let lastChartKey = null;
    let scrolling = false;
    async function jumpOnNewChartNote() {
        const key = chartNoteKey();
        if (!key || key === lastChartKey || scrolling) return;   // not a note, same note, or busy
        lastChartKey = key;
        scrolling = true;
        try { await featureScrollToFlowsheet(); } finally { scrolling = false; }
    }
    jumpOnNewChartNote();
    onUrlChange(() => {
        applyCompactCss();        // inject the now-relevant CSS block (if not already)
        jumpOnNewChartNote();     // only re-jump when switching to a DIFFERENT note
    });
})();
