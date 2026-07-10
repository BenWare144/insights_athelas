// ==UserScript==
// @name         Athelas Insights - Compact Mode + Chart Note Helpers
// @namespace    https://insights.athelas.com/
// @version      14.15.0
// @description  Compact spacing for Appointments / Chart Note, plus two Chart Note features: jump-to-Flowsheet on load, and Fix MET (move Muscle Energy Technique items to 97112). Verbose logging.
// @author       Ben
// @match        https://insights.athelas.com/v3/appointments*
// @match        https://insights.athelas.com/ehr/v2/patients/*/appointments/*
// @run-at       document-start
// @grant        GM_addStyle
// ==/UserScript==

(function () {
    'use strict';

    const path = location.pathname;
    const isAppointments = path.startsWith('/v3/appointments');
    const isChartNote    = /^\/ehr\/v2\/patients\/[^/]+\/appointments\//.test(path);
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
        `;

        let css = '';
        if (isAppointments) css = cssAppointments;
        else if (isChartNote) css = cssChartNote;

        if (!css) { log.log('no CSS block applies for this URL'); return; }

        if (typeof GM_addStyle === 'function') {
            GM_addStyle(css);
            log.log(`applied via GM_addStyle (${css.length} chars)`);
        } else {
            const inject = () => {
                const style = document.createElement('style');
                style.id = 'athelas-compact-mode';
                style.textContent = css;
                (document.head || document.documentElement).appendChild(style);
                log.log(`applied via <style> injection (${css.length} chars)`);
            };
            if (document.head) inject();
            else new MutationObserver((_, obs) => {
                if (document.head) { inject(); obs.disconnect(); }
            }).observe(document.documentElement, { childList: true });
        }

    }


    // =====================================================================
    // MODULE 2: Scroll to Flowsheet section on chart-note load
    // (Independent. Doesn't depend on the autofill module.)
    // =====================================================================
    async function featureScrollToFlowsheet() {
        const log = makeLogger('scroll');
        log.log('module booted');

        const HEADER_OFFSET = 64;       // sticky app bar height + a bit of breathing room
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
        log.log(`${ts()} module booted, v14.14 (justify via Tiptap editor API - true replace, no revert/newline)`);

        const HEADER_BTN_ID = 'athelas-fix-met-header-btn';
        const TARGET_CODE = '97112';   // Neuromuscular Reeducation - where MET belongs
        const KEY_DELAY_MS = 130;     // pause between simulated keystrokes (let React re-render + dnd-kit re-measure)
        const MAX_ARROW_STEPS = 45;   // safety cap on arrow presses (we normally stop on detection long before this)

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

        // ---- KEYBOARD DRAG (reliable fallback) -----------------------------
        // Focus handle -> Space (pick up) -> Arrow toward target until the item
        // enters the target card -> Space (drop). Directional (v14.10) and now
        // adaptive-timed (v14.11). Lands where it crosses in (top when coming from
        // above, bottom when coming from below); precise "top" is the pointer path.
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

        // ---- POINTER DRAG (primary: one gesture => fast, and drops at the TOP) --
        // dnd-kit's PointerSensor + built-in auto-scroll. We grab the handle, push
        // the pointer toward the 97112 list (riding auto-scroll if it's off-screen),
        // aim at the first item so the insert lands at the top, then release. If we
        // can't confirm the item is over the target we CANCEL (Escape) so nothing is
        // ever dropped in the wrong place - the caller then falls back to keyboard.
        const PTR_STEP_PX = 64;      // pointer move increment per iteration
        const PTR_MAX_ITERS = 90;    // safety cap
        const PTR_MOVE_DELAY = 28;   // ms between pointer moves (autoscroll needs a beat)
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
        async function pointerDragToTop(li, targetName, opts) {
            opts = opts || {};
            const name = itemName(li).trim();
            const handle = itemHandle(li);
            log.log(`${ts()} ===== pointerDragToTop "${name}" -> "${targetName}" =====`);
            if (!handle) { log.warn(`${ts()} no handle`); return { ok: false, reason: 'no-handle' }; }
            const targetCode = codeForName(targetName);

            // Bring the source item to the middle of the viewport first so the grab
            // coordinate is on-screen (an off-screen handle can't ride auto-scroll)
            // and there's room above/below to drag either way. 'instant' avoids the
            // page's smooth-scroll (Chrome).
            try { li.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (e) { li.scrollIntoView({ block: 'center' }); }
            await sleep(70);
            const hr = handle.getBoundingClientRect();
            const px = Math.round(hr.left + hr.width / 2);
            let py = Math.round(hr.top + hr.height / 2);
            log.log(`${ts()} grab handle @(${px},${py}) targetCode=${targetCode}`);
            handle.focus();
            const liveStart = liveRegionText();
            dispatchPointer('pointerdown', px, py, handle);
            await sleep(30);
            py += 10;
            dispatchPointer('pointermove', px, py, document);   // exceed activation distance
            await sleep(50);
            const pressed = handle.getAttribute('aria-pressed');
            const pickedUp = pressed === 'true' || liveRegionText() !== liveStart;
            log.log(`${ts()} pointer pickup: aria-pressed=${pressed} pickedUp=${pickedUp} live="${liveRegionText()}"`);
            if (!pickedUp) {
                dispatchPointer('pointerup', px, py, document);
                log.warn(`${ts()} pointer PICKUP FAILED`);
                return { ok: false, reason: 'pointer-pickup-failed' };
            }

            const vh = viewportH();
            let curY = py, iters = 0, inTarget = false, settledAtAim = false;
            for (let i = 0; i < PTR_MAX_ITERS; i++) {
                iters++;
                const region = findRegionByName(getScope(), targetName);
                const rr = region ? region.getBoundingClientRect() : null;
                const first = firstItemOfCard(targetCode);
                const aimRaw = first ? (first.getBoundingClientRect().top + first.getBoundingClientRect().height / 2)
                                     : (rr ? rr.top + 30 : vh / 2);
                const aimY = Math.max(10, Math.min(vh - 10, Math.round(aimRaw)));
                let goalY;
                if (rr && rr.top > vh - 28) goalY = vh - 18;         // target below viewport -> autoscroll down
                else if (rr && rr.bottom < 28) goalY = 18;           // target above viewport -> autoscroll up
                else goalY = aimY;                                   // in view -> aim at the top item
                if (curY < goalY) curY = Math.min(goalY, curY + PTR_STEP_PX);
                else if (curY > goalY) curY = Math.max(goalY, curY - PTR_STEP_PX);
                dispatchPointer('pointermove', px, curY, document);
                await sleep(PTR_MOVE_DELAY);
                inTarget = regionsContainingName(name).some((h) => h.name === targetName);
                const aiming = (goalY === aimY);
                if (i % 4 === 0 || inTarget) {
                    log.log(`${ts()} ptr ${iters}: curY=${curY} goalY=${goalY} aimY=${aimY} rTop=${rr ? Math.round(rr.top) : 'n/a'} inTarget=${inTarget} live="${liveRegionText()}"`);
                }
                if (inTarget && aiming && Math.abs(curY - aimY) <= PTR_STEP_PX) {
                    dispatchPointer('pointermove', px, aimY, document);
                    await sleep(70);
                    settledAtAim = true;
                    log.log(`${ts()} settled over target top (aimY=${aimY}) after ${iters} iters`);
                    break;
                }
            }

            if (regionsContainingName(name).some((h) => h.name === targetName)) {
                dispatchPointer('pointerup', px, curY, document);
                await sleep(180);
                const stillIn = regionsContainingName(name).some((h) => h.name === targetName);
                const idx = indexOfNameInCard(targetCode, name);
                log.log(`${ts()} pointerDrag DROP settledAtAim=${settledAtAim} inTarget=${stillIn} finalIdx=${idx} iters=${iters}`);
                return { ok: stillIn, finalIdx: idx, iters };
            }
            log.warn(`${ts()} pointer never reached target after ${iters} iters - CANCEL (item returns home), will fall back to keyboard`);
            pressKey(document, 'Escape', 'Escape');
            dispatchPointer('pointercancel', px, curY, document);
            await sleep(140);
            return { ok: false, reason: 'pointer-no-target' };
        }

        // ---- Subtask 2: ensure a 97112 card exists (single click, no dup) ---
        async function ensureTargetCard() {
            const before = countCards(TARGET_CODE);
            log.log(`${ts()} ensureTargetCard: ${TARGET_CODE} count before=${before}`);
            if (before > 0) { log.log(`${ts()} 97112 already present - skipping +CPT dialog`); return true; }
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
            for (const o of options) { if ((o.textContent || '').includes(TARGET_CODE)) { opt = o; break; } }
            if (!opt) { log.warn(`${ts()} no ${TARGET_CODE} option among ${options.length} dialog options`); return false; }
            if (opt.getAttribute('aria-selected') !== 'true') {
                log.log(`${ts()} ticking ${TARGET_CODE} option (single click)`);
                opt.click();
                await sleep(250);
            } else {
                log.log(`${ts()} ${TARGET_CODE} option already selected`);
            }
            const addCodesBtn = dialog.querySelector('button[jf-ext-button-ct*="cpt code"]');
            if (!addCodesBtn) { log.warn(`${ts()} no "Add N CPT code" button in dialog`); return false; }
            if (addCodesBtn.disabled) { log.warn(`${ts()} Add button disabled (option not ticked?)`); return false; }
            const pre = countCards(TARGET_CODE);
            log.log(`${ts()} clicking "${addCodesBtn.textContent.trim()}" (single click); ${TARGET_CODE} count before add=${pre}`);
            addCodesBtn.click();
            for (let i = 0; i < 20; i++) {
                await sleep(150);
                if (countCards(TARGET_CODE) > pre) { log.log(`${ts()} 97112 card appeared after ${(i + 1) * 150}ms`); break; }
            }
            const after = countCards(TARGET_CODE);
            log.log(`${ts()} ensureTargetCard done: ${TARGET_CODE} count=${after} (added ${after - before})`);
            if (after - before > 1) log.warn(`${ts()} DUPLICATE: added ${after - before} cards - single click still double-added, investigate`);
            return after > before;
        }

        // ---- full flow ------------------------------------------------------
        // Return the first MET item that is NOT already in the target card, scanned
        // across EVERY card (not just 97140 - the scribe misfiles MET under 97110
        // too). Re-scanned every pass because the DOM re-renders after each move.
        function findNextMisplacedMET() {
            for (const card of getCards()) {
                if (card.code === TARGET_CODE) continue;   // already where we want it
                for (const li of cardItems(card)) {
                    if (isMETText(itemName(li))) return { card, li, name: itemName(li).trim() };
                }
            }
            return null;
        }
        function listMisplacedMET() {
            const out = [];
            for (const card of getCards()) {
                if (card.code === TARGET_CODE) continue;
                for (const li of cardItems(card)) {
                    if (isMETText(itemName(li))) out.push({ code: card.code, name: itemName(li).trim() });
                }
            }
            return out;
        }

        // ---- Justification text (v14.12) -----------------------------------
        // Names shaped "MET - X" get X spliced into the sentence; anything else
        // (e.g. a bare "MET") gets the generic form.
        function metJustification(name) {
            const m = (name || '').trim().match(/^MET\s*-\s*(.+)$/i);
            const tail = 'with tactile and vc to help facilitate proper proprioception and posture.';
            return m
                ? `Muscle energy technique applied to ${m[1].trim()}, ${tail}`
                : `Muscle energy technique applied, ${tail}`;
        }
        // ---- Set a Tiptap/ProseMirror field reliably (v14.14) ---------------
        // The old approach (set DOM selection + execCommand insertText) did NOT work:
        // ProseMirror ignores an externally-set DOM selection, so the text was
        // inserted at the caret (prepended) rather than replacing, and the Enter we
        // sent to "commit" only added blank paragraphs. Instead we drive Tiptap's own
        // Editor instance, located by walking the React fiber up from the
        // contenteditable node. selectAll()+insertContent() replaces the whole field
        // in one real transaction that persists (fires the app's onUpdate) with no
        // stray Enter/newline.
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
        function setViaTiptap(el, value) {
            const editor = findTiptapEditor(el);
            if (!editor) { log.log(`${ts()}   setViaTiptap: no editor on fiber`); return false; }
            try { editor.chain().focus().selectAll().insertContent(value).run(); return true; }
            catch (e) { log.error(`${ts()}   setViaTiptap threw`, e); return false; }
        }
        // Fallback: select-all through ProseMirror's own keymap (Ctrl+A), delete, then
        // insert. Verifies the field actually emptied first, so a failed select can
        // never duplicate content.
        async function setViaExecCommand(el, value) {
            el.focus();
            for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, { bubbles: true }));
            await sleep(30);
            dispatchKey(el, 'keydown', 'KeyA', 'a', { ctrlKey: true });
            dispatchKey(el, 'keyup', 'KeyA', 'a', { ctrlKey: true });
            await sleep(20);
            document.execCommand('delete', false);
            await sleep(20);
            if ((el.textContent || '').trim() !== '') {
                log.warn(`${ts()}   setViaExecCommand: Ctrl+A+delete did not clear ("${(el.textContent || '').trim().slice(0, 30)}") - aborting to avoid duplication`);
                return false;
            }
            const ok = document.execCommand('insertText', false, value);
            await sleep(20);
            return ok;
        }
        // Rewrite the "Intervention details" field for EVERY MET item now in 97112.
        // Verifies the field ends up EXACTLY equal to the target text and retries if a
        // controlled re-render reverts it. Idempotent.
        async function applyMETJustifications() {
            const target = getCards().find((c) => c.code === TARGET_CODE);
            if (!target) { log.warn(`${ts()} applyMETJustifications: no ${TARGET_CODE} card`); return 0; }
            const metItems = cardItems(target).filter((li) => isMETText(itemName(li)));
            log.log(`${ts()} applyMETJustifications: ${metItems.length} MET item(s) in ${TARGET_CODE}`);
            let edited = 0;
            for (const li of metItems) {
                const nm = itemName(li).trim();
                const details = li.querySelector('[contenteditable="true"][aria-label="Intervention details"]');
                if (!details) { log.warn(`${ts()} no "Intervention details" field for "${nm}"`); continue; }
                const just = metJustification(nm);
                if ((details.textContent || '').trim() === just) { log.log(`${ts()} justification "${nm}": already set, skip`); continue; }
                let done = false;
                for (let attempt = 1; attempt <= 3 && !done; attempt++) {
                    const before = (details.textContent || '').trim();
                    const usedTiptap = setViaTiptap(details, just);
                    if (!usedTiptap) await setViaExecCommand(details, just);
                    await sleep(150);
                    let now = (details.textContent || '').trim();
                    if (now === just) { await sleep(150); now = (details.textContent || '').trim(); } // catch a fast revert
                    log.log(`${ts()} justification "${nm}" attempt ${attempt} (${usedTiptap ? 'tiptap' : 'execCommand'}): "${before.slice(0, 30)}" -> "${now.slice(0, 70)}"`);
                    if (now === just) done = true;
                }
                if (done) edited++;
                else log.warn(`${ts()} justification "${nm}" did NOT stick after 3 attempts`);
            }
            return edited;
        }

        async function performFix() {
            log.log(`${ts()} ================= performFix START =================`);
            const scope = getScope();
            if (!scope) { log.warn(`${ts()} no [data-section="flowsheet"]`); return { moved: 0, reason: 'no-flowsheet' }; }
            dumpState('performFix-start');

            const initial = listMisplacedMET();
            const tgt0 = getCards().find((c) => c.code === TARGET_CODE);
            const metInTarget0 = tgt0 ? cardItems(tgt0).filter((li) => isMETText(itemName(li))).length : 0;
            log.log(`${ts()} misplaced MET (outside ${TARGET_CODE}): ${initial.length} -> ${JSON.stringify(initial)}; MET already in ${TARGET_CODE}: ${metInTarget0}`);
            if (!initial.length && metInTarget0 === 0) {
                log.log(`${ts()} no MET items anywhere - nothing to do`);
                return { moved: 0, justified: 0, reason: 'no-MET' };
            }

            let target = getCards().find((c) => c.code === TARGET_CODE);
            if (!target) {
                log.log(`${ts()} no ${TARGET_CODE} card - creating via +CPT`);
                const ok = await ensureTargetCard();
                if (!ok) return { moved: 0, justified: 0, reason: 'could-not-add-97112' };
                await sleep(400);
                target = getCards().find((c) => c.code === TARGET_CODE);
            }
            if (!target) { log.warn(`${ts()} still no ${TARGET_CODE} after ensure`); return { moved: 0, justified: 0, reason: 'no-97112-after-ensure' }; }
            const targetName = target.name;
            log.log(`${ts()} target "${targetName}" region=${!!target.region}`);

            // ---- move any misplaced MET into 97112 ----
            let moved = 0;
            if (initial.length) {
                let usePointer = true;   // pointer path is fast + lands at top; falls back to keyboard on any miss
                const maxPasses = initial.length + 2;   // safety against an infinite loop
                for (let pass = 0; pass < maxPasses; pass++) {
                    const next = findNextMisplacedMET();
                    if (!next) { log.log(`${ts()} no more misplaced MET - done moving`); break; }
                    log.log(`${ts()} --- MET pass ${pass + 1}: moving "${next.name}" from ${next.code} -> ${TARGET_CODE} (mode=${usePointer ? 'pointer' : 'keyboard'}) ---`);
                    let res;
                    if (usePointer) {
                        res = await pointerDragToTop(next.li, targetName, {});
                        if (!res.ok) {
                            // Pointer cancelled cleanly (item back home) - drop to keyboard for
                            // this item AND the rest (don't keep paying for pointer misses).
                            log.warn(`${ts()} pointer path failed (${res.reason || 'no-target'}); switching to keyboard for the remainder.`);
                            usePointer = false;
                            await sleep(150);
                            const again = findNextMisplacedMET();
                            if (again) res = await keyboardDrag(again.li, targetName, {});
                        }
                    } else {
                        res = await keyboardDrag(next.li, targetName, {});
                    }
                    if (res && res.ok) { moved++; }
                    else { log.warn(`${ts()} drag of "${next.name}" failed (${(res && res.reason) || 'not-in-target'}); stopping to avoid a mess.`); break; }
                    await sleep(200);
                }
            } else {
                log.log(`${ts()} no misplaced MET to move; justification-only run`);
            }

            // ---- standardize the justification of EVERY MET item now in 97112 ----
            const justified = await applyMETJustifications();
            log.log(`${ts()} ================= performFix END: moved=${moved}, justified=${justified} =================`);
            return { moved, justified, reason: 'ok' };
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
            btn.textContent = 'Fix MET → 97112';
            btn.title = 'Move Muscle Energy Technique (MET) items from 97140 to 97112 via a real dnd-kit drag. Click Apply Scribe afterwards to persist.';
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
                    if (result.justified) parts.push(`just. ${result.justified}`);
                    const didSomething = result.moved || result.justified;
                    btn.textContent = didSomething ? parts.join(', ') : (result.reason || 'no-op');
                    btn.style.background = didSomething ? '#2a7' : '#888';
                } catch (err) {
                    log.error(`${ts()} performFix threw:`, err);
                    btn.textContent = 'error'; btn.style.background = '#888';
                } finally {
                    setTimeout(() => { btn.textContent = 'Fix MET → 97112'; btn.style.background = '#c33'; btn.disabled = false; }, 3500);
                }
            });
            row.appendChild(btn);
            log.log(`${ts()} injected Fix MET header button`);
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
        window.__athelasFixMET = performFix;
        window.__athelasDbgFlowsheet = () => { dumpState('manual'); return getCards().map((c) => ({ code: c.code, name: c.name, region: !!c.region, ul: !!c.ul, items: cardItems(c).map((li) => itemName(li).trim()) })); };
        window.__athelasListProcedureCards = () => { const r = getCards().map((c) => ({ code: c.code, name: c.name, items: cardItems(c).length })); console.table(r); return r; };
        // Apply the standardized justification to every MET item in 97112 (same as
        // what the button does after moving) - handy to test the field edit alone.
        window.__athelasApplyJustifications = async () => applyMETJustifications();
        window.__athelasKbdDragFirstMET = async () => {
            const next = findNextMisplacedMET();
            if (!next) { log.warn('no misplaced MET item (nothing outside 97112)'); return; }
            const tgt = getCards().find((c) => c.code === TARGET_CODE);
            if (!tgt) { log.warn('no 97112 card present - create it first (click the button) or run __athelasFixMET()'); return; }
            log.log(`kbd-drag test: "${next.name}" from ${next.code} -> ${TARGET_CODE}`);
            return keyboardDrag(next.li, tgt.name, {});
        };
        window.__athelasPointerDragFirstMET = async () => {
            const next = findNextMisplacedMET();
            if (!next) { log.warn('no misplaced MET item (nothing outside 97112)'); return; }
            const tgt = getCards().find((c) => c.code === TARGET_CODE);
            if (!tgt) { log.warn('no 97112 card present'); return; }
            log.log(`pointer-drag test: "${next.name}" from ${next.code} -> ${TARGET_CODE}`);
            return pointerDragToTop(next.li, tgt.name, {});
        };
        log.log(`${ts()} hooks ready: __athelasFixMET, __athelasApplyJustifications, __athelasKbdDragFirstMET, __athelasPointerDragFirstMET, __athelasDbgFlowsheet, __athelasListProcedureCards`);
    }

    // =====================================================================
    // Boot: run each module in turn. They're independent.
    // =====================================================================
    applyCompactCss();
    if (isChartNote) {
        featureScrollToFlowsheet();
        featureFixMisplacedMET();
        // Legacy modules disabled in the v14 site rework live in
        // athelas-appointments-compact.archive.js (see note above MODULE 9).
    }
})();
