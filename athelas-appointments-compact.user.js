// ==UserScript==
// @name         Athelas Insights - Compact Mode + Chart Note Helpers
// @namespace    https://insights.athelas.com/
// @version      14.8.0
// @description  Compact spacing for Appointments / Calendar / Chart Note, plus two Chart Note features: jump-to-Flowsheet on load, and auto-fill newly added interventions (justification, procedure, Done) from a lookup table. Verbose logging.
// @author       Ben
// @match        https://insights.athelas.com/v3/appointments*
// @match        https://insights.athelas.com/ehr/calendar*
// @match        https://insights.athelas.com/ehr/v2/patients/*/appointments/*
// @run-at       document-start
// @grant        GM_addStyle
// ==/UserScript==

(function () {
    'use strict';

    const path = location.pathname;
    const isAppointments = path.startsWith('/v3/appointments');
    const isCalendar     = path.startsWith('/ehr/calendar');
    const isChartNote    = /^\/ehr\/v2\/patients\/[^/]+\/appointments\//.test(path);

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

        const cssCalendar = `
            .fc .fc-timegrid-slot,
            .fc .fc-timegrid-slot-minor { height: 0.875rem !important; }

            .fc .fc-timegrid-axis-cushion,
            .fc .fc-timegrid-slot-label-cushion {
                padding: 0 4px !important;
                font-size: 11px !important;
                line-height: 1.1 !important;
            }

            .fc-timegrid-event .fc-event-main { padding: 1px 2px 0 !important; }
            .fc-timegrid-event .fc-event-time,
            .fc-timegrid-event .fc-event-title {
                font-size: 11px !important;
                line-height: 1.15 !important;
            }

            .fc .fc-col-header-cell-cushion { padding: 2px 4px !important; }

            .fc .fc-daygrid-day-events { padding: 1px !important; }
            .fc .fc-daygrid-block-event .fc-event-time,
            .fc .fc-daygrid-block-event .fc-event-title { padding: 0 1px !important; }

            .MuiPickersDay-root { width: 30px !important; height: 30px !important; margin: 0 !important; }
            .MuiDayCalendar-weekContainer { margin: 0 !important; }
        `;

        const cssChartNote = `
            .tr-gap-y-8 { row-gap: 0.375rem !important; }
            .tr-gap-y-6 { row-gap: 0.375rem !important; }
            .tr-gap-y-5 { row-gap: 0.25rem  !important; }
            .tr-gap-y-4 { row-gap: 0.25rem  !important; }
            .tr-gap-y-3 { row-gap: 0.25rem  !important; }
            .tr-gap-y-2 { row-gap: 0.125rem !important; }

            .tr-gap-8 { gap: 0.5rem !important; }
            .tr-gap-6 { gap: 0.375rem !important; }
            .tr-gap-5 { gap: 0.25rem !important; }
            .tr-gap-4 { gap: 0.25rem !important; }
            .tr-gap-3 { gap: 0.25rem !important; }
            .tr-gap-2 { gap: 0.25rem !important; }

            .tr-py-8 { padding-top: 0.25rem !important; padding-bottom: 0.25rem !important; }
            .tr-py-6 { padding-top: 0.25rem !important; padding-bottom: 0.25rem !important; }
            .tr-py-5 { padding-top: 0.25rem !important; padding-bottom: 0.25rem !important; }
            .tr-py-4 { padding-top: 0.25rem !important; padding-bottom: 0.25rem !important; }
            .tr-py-3 { padding-top: 0.125rem !important; padding-bottom: 0.125rem !important; }
            .tr-py-2 { padding-top: 0.125rem !important; padding-bottom: 0.125rem !important; }
            .tr-py-2\\.5 { padding-top: 0.125rem !important; padding-bottom: 0.125rem !important; }
            .tr-py-1\\.5 { padding-top: 0.0625rem !important; padding-bottom: 0.0625rem !important; }
            .tr-py-1 { padding-top: 0.0625rem !important; padding-bottom: 0.0625rem !important; }

            .tr-mb-8 { margin-bottom: 0.5rem !important; }
            .tr-mb-7 { margin-bottom: 0.5rem !important; }
            .tr-mb-6 { margin-bottom: 0.375rem !important; }
            .tr-mb-5 { margin-bottom: 0.25rem !important; }
            .tr-mb-4 { margin-bottom: 0.25rem !important; }
            .tr-mb-3 { margin-bottom: 0.125rem !important; }
            .tr-mb-2 { margin-bottom: 0.125rem !important; }
            .tr-mb-2\\.5 { margin-bottom: 0.125rem !important; }
            .tr-mb-1\\.5 { margin-bottom: 0 !important; }
            .tr-mb-1 { margin-bottom: 0 !important; }

            .tr-mt-8 { margin-top: 0.5rem !important; }
            .tr-mt-7 { margin-top: 0.5rem !important; }
            .tr-mt-6 { margin-top: 0.375rem !important; }
            .tr-mt-5 { margin-top: 0.25rem !important; }
            .tr-mt-4 { margin-top: 0.25rem !important; }
            .tr-mt-3 { margin-top: 0.125rem !important; }
            .tr-mt-2 { margin-top: 0.125rem !important; }
            .tr-mt-1\\.5 { margin-top: 0 !important; }
            .tr-mt-1 { margin-top: 0 !important; }

            .tr-space-y-8 > :not([hidden]) ~ :not([hidden]) { margin-top: 0.5rem !important; }
            .tr-space-y-6 > :not([hidden]) ~ :not([hidden]) { margin-top: 0.375rem !important; }
            .tr-space-y-4 > :not([hidden]) ~ :not([hidden]) { margin-top: 0.25rem !important; }
            .tr-space-y-3 > :not([hidden]) ~ :not([hidden]) { margin-top: 0.125rem !important; }
            .tr-space-y-2 > :not([hidden]) ~ :not([hidden]) { margin-top: 0.125rem !important; }
            .tr-space-y-1 > :not([hidden]) ~ :not([hidden]) { margin-top: 0 !important; }

            .tr-min-h-12 { min-height: 1.5rem !important; }
            .tr-min-h-10 { min-height: 1.5rem !important; }
            .tr-min-h-9  { min-height: 1.25rem !important; }
            .tr-min-h-7  { min-height: 0 !important; }
            .tr-min-h-6  { min-height: 0 !important; }

            .tr-p-6 { padding: 0.25rem !important; }
            .tr-p-5 { padding: 0.25rem !important; }
            .tr-p-4 { padding: 0.25rem !important; }
            .tr-p-3 { padding: 0.25rem !important; }
            .tr-p-2 { padding: 0.125rem !important; }
            .tr-pt-6 { padding-top: 0.25rem !important; }
            .tr-pt-5 { padding-top: 0.25rem !important; }
            .tr-pt-4 { padding-top: 0.25rem !important; }
            .tr-pt-3 { padding-top: 0.125rem !important; }
            .tr-pt-2 { padding-top: 0.125rem !important; }
            .tr-pb-6 { padding-bottom: 0.25rem !important; }
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

            .MuiListItem-root.MuiListItem-gutters { padding-top: 0 !important; padding-bottom: 0 !important; min-height: 0 !important; }
            .MuiFormControlLabel-root { margin-top: 0 !important; margin-bottom: 0 !important; min-height: 0 !important; }
            .MuiCheckbox-root, .MuiRadio-root { padding: 2px !important; }

            .MuiCollapse-wrapperInner { padding-top: 0 !important; padding-bottom: 0 !important; }

            .MuiIconButton-sizeSmall { padding: 2px !important; }
            .MuiIconButton-sizeMedium { padding: 4px !important; }
            .MuiButton-sizeMedium { padding: 2px 8px !important; min-height: 0 !important; }

            .MuiToggleButton-root { padding: 1px 6px !important; min-height: 0 !important; }

            .MuiDataGrid-cell { padding: 0 6px !important; }

            .MuiTypography-Body\\.Normal\\.Regular,
            .MuiTypography-Body\\.Normal\\.Medium,
            .MuiTypography-Body\\.Small\\.Regular,
            .MuiTypography-Body\\.Small\\.Medium,
            .MuiTypography-Body\\.Small\\.SemiBold,
            .MuiTypography-Body\\.Large\\.Regular,
            .MuiTypography-Body\\.Large\\.SemiBold {
                line-height: 1.25 !important;
            }

            header.MuiAppBar-root { min-height: 0 !important; }
            header.MuiAppBar-root .MuiToolbar-root { min-height: 0 !important; padding-top: 2px !important; padding-bottom: 2px !important; }

            [data-section] > .tr-grid { padding-top: 1px !important; padding-bottom: 1px !important; }

            .tr-pb-20, .tr-pb-16, .tr-pb-14, .tr-pb-12 { padding-bottom: 0.5rem !important; }
            .tr-mb-20, .tr-mb-10 { margin-bottom: 0.5rem !important; }
            .tr-pt-16 { padding-top: 0.5rem !important; }

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

            /* ============================================================
               5. DataGrid CSS DISABLED (v12.1).
               ============================================================
               These rules shrink the interventions DataGrid rows to 22px so
               more rows fit on screen. They worked visually but caused
               persistent dead space inside the grid because MUI X
               DataGrid's virtualization JS still uses its
               configured rowHeight prop (48px) for its internal math - it
               renders only the rows it thinks fit in the viewport at 48px,
               leaving ~330px+ of empty space below the rendered rows.

               Many fixes were attempted in v10-v12. See the long notes
               block on featureSimpleGridHeight in MODULE 8 (search for
               "MODULE 8: DataGrid compact mode") for the complete history
               of attempts and the most promising unexplored avenues.

               The rules are commented out below rather than deleted so a
               future attempt can re-enable them once a working JS-side
               fix for MUI's virtualization is in place. Don't re-enable
               in isolation: you'll get the dead-space problem back.
               ============================================================ */
            /*
            .MuiDataGrid-root { --rowHeight: 22px !important; --DataGrid-rowHeight: 22px !important; }
            .MuiDataGrid-row { min-height: 22px !important; max-height: 22px !important; --height: 22px !important; height: 22px !important; }
            .MuiDataGrid-row > .MuiDataGrid-cell { min-height: 22px !important; max-height: 22px !important; height: 22px !important; line-height: 20px !important; padding: 0 4px !important; }
            .MuiDataGrid-row [data-field="intervention_name"] svg { width: 14px !important; height: 14px !important; }
            .MuiDataGrid-row .MuiCheckbox-root { padding: 0 !important; width: 18px !important; height: 18px !important; }
            .MuiDataGrid-row .MuiCheckbox-root svg { width: 18px !important; height: 18px !important; }
            .MuiDataGrid-row .MuiIconButton-sizeSmall,
            .MuiDataGrid-row .MuiIconButton-sizeMedium { padding: 0 !important; width: 20px !important; height: 20px !important; }
            .MuiDataGrid-row .MuiIconButton-sizeSmall svg,
            .MuiDataGrid-row .MuiIconButton-sizeMedium svg { width: 14px !important; height: 14px !important; }
            .MuiDataGrid-row .MuiDataGrid-detailPanelToggleCell { width: 20px !important; height: 20px !important; padding: 0 !important; }
            .MuiDataGrid-row .MuiDataGrid-detailPanelToggleCell svg { width: 16px !important; height: 16px !important; }
            .MuiDataGrid-virtualScrollerContent > div { padding-top: 0 !important; padding-bottom: 0 !important; }
            .MuiDataGrid-columnHeaders, .MuiDataGrid-columnHeader { height: 28px !important; min-height: 28px !important; max-height: 28px !important; line-height: 26px !important; }
            */
        `;

        let css = '';
        if (isAppointments) css = cssAppointments;
        // Calendar compact mode intentionally NOT applied here in v11+ -
        // the page already ships an in-product compact toggle. cssCalendar
        // is kept defined above for reference / re-enabling later.
        else if (isChartNote) css = cssChartNote;
        // (intentionally skip isCalendar branch)
        void isCalendar; // suppress "unused" lint without removing the var

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
         *  Falls back to the DataGrid or the Flowsheet section wrapper. */
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
            // 2. The intervention DataGrid itself is a fine alternative - it's right
            //    below the Interventions heading and is the actionable area.
            const grid = document.querySelector('.MuiDataGrid-root');
            if (grid) return grid;
            // 3. Last resort: the flowsheet section wrapper.
            return flowsheet;
        }

        // Wait for at least one of the candidate anchors to exist.
        const anchor = await waitFor('[data-section="flowsheet"] h1, [data-section="flowsheet"] h2, [data-section="flowsheet"] h3, .MuiDataGrid-root, [data-section="flowsheet"]', { log });
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
                : (target.matches('.MuiDataGrid-root') ? 'MuiDataGrid-root' : `[data-section="${target.getAttribute('data-section')}"]`);
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
    // MODULE 3: Auto-fill newly added interventions
    //
    // Intervention rows live inside an MUI DataGrid. Each row is a
    // <div role="row" data-id="<id>"> with cells indexed by data-field.
    // After a row, an MUI "detail panel" is rendered as a sibling when
    // expanded, containing the justification, notes, and Procedure fields.
    //
    // Strategy:
    //   1. On boot: snapshot all existing row data-ids as the "baseline".
    //   2. Watch the DataGrid root for new rows.
    //   3. For each row whose data-id is NOT in the baseline, run the
    //      5-step procedure (scroll, expand, justification, procedure, Done).
    //   4. Track processed ids so React re-renders don't reprocess.
    // =====================================================================
    function featureAutofillInterventions() {
        const log = makeLogger('autofill');
        log.log('module booted, version 7.0.0');

        // ============================================================
        // Lookup data, derived from "Stuff for EMR.xlsx" + reference_interventions.txt.
        //
        // The xlsx has 8 "template" rows (FRS R/L, ERS R/L, MET-*); the page
        // shows region-specific variants (FRS Left Lumbar, ERS Right Cervical,
        // etc.). The reference file enumerates the page-visible names per
        // template; this table fans them out so an exact name match still
        // works.
        //
        // The "<    >" placeholder in the FRS/ERS Procedure_text is intentional -
        // per the xlsx notes, you choose "sitting" or "sidelying" by hand after
        // the auto-fill drops in the template. If you'd prefer the script
        // substitute a default, change PLACEHOLDER_POSITION below.
        // ============================================================
        const PLACEHOLDER_POSITION = "sitting"; // <- swap for "sidelying" or "sitting" if you want auto-fill to commit a default

        // Shared template bodies. All carry procedure 97112.
        const FRS_TEMPLATE = {
            justification: `Positioning in ${PLACEHOLDER_POSITION} with active contraction of multifidi to gain proprioceptive input for reciprocal inhibition and improved postural alignment.`,
            procedureNumber: "97112"
        };
        const ERS_TEMPLATE = {
            justification: `Positioning in ${PLACEHOLDER_POSITION} with active contraction of multifidi to gain proprioceptive input for reciprocal inhibition and improved postural alignment.`,
            procedureNumber: "97112"
        };
        const MET_TORSIONAL_BACKWARD = {
            justification: "Positioning in sidelying with active contraction of piriformis to gain proprioceptive input for reciprocal inhibition and improved postural alignment.",
            procedureNumber: "97112"
        };
        const MET_TORSIONAL_FORWARD = {
            justification: "Positioning in sidelying with active contraction of paraspinals to gain proprioceptive input for reciprocal inhibition and improved postural alignment.",
            procedureNumber: "97112"
        };
        const MET_LE = {
            justification: "Improve rotation of L/E for improved gait",
            procedureNumber: "97112"
        };
        const MET_UE = {
            justification: "Improve rotation of U/E for improved overhead reach",
            procedureNumber: "97112"
        };

        // ---- Therapeutic Activities (97530), per updated xlsx ----
        const SIT_TO_STAND_DATA  = { justification: "Improve toilet transfers",                 procedureNumber: "97530" };
        const SIT_TO_SUPINE_DATA = { justification: "Improved transfers on and off the bed",    procedureNumber: "97530" };
        const STAIR_CLIMB_DATA   = { justification: "Improve stair climbing ability",           procedureNumber: "97530" };
        const SQUAT_RECOVER_DATA = { justification: "Improve ablity to squat and recover",      procedureNumber: "97530" };
        const FUNCTIONAL_YARD    = { justification: "Functional training for yard/house work ", procedureNumber: "97530" };

        // ---- Balance / Neuromuscular Reeducation (97112), per updated xlsx ----
        const GLUTE_MED_BALANCE  = { justification: "Verbal and tactile cues to glute med  for upright posture", procedureNumber: "97112" };

        const interventionData = {
            // ---- FRS variants (6) ----
            "FRS Left Lumbar":     FRS_TEMPLATE,
            "FRS Right Lumbar":    FRS_TEMPLATE,
            "FRS Left Thoracic":   FRS_TEMPLATE,
            "FRS Left Cervical":   FRS_TEMPLATE,
            "FRS Right Thoracic":  FRS_TEMPLATE,
            "FRS Right Cervical":  FRS_TEMPLATE,

            // ---- ERS variants (6) ----
            "ERS Left Lumbar":     ERS_TEMPLATE,
            "ERS Right Lumbar":    ERS_TEMPLATE,
            "ERS Left Thoracic":   ERS_TEMPLATE,
            "ERS Left Cervical":   ERS_TEMPLATE,
            "ERS Right Thoracic":  ERS_TEMPLATE,
            "ERS Right Cervical":  ERS_TEMPLATE,

            // ---- MET torsional motion (the page suffixes "(R/R correction)" etc.;
            // the prefix-fallback below catches those without needing every variant) ----
            "MET to restore left/right backward torsional motion":  MET_TORSIONAL_BACKWARD,
            "MET to restore right/right forward torsional motion":  MET_TORSIONAL_FORWARD,
            "MET to restore right/left backward torsional motion":  MET_TORSIONAL_BACKWARD,
            "MET to restore left/left forward torsional motion":    MET_TORSIONAL_FORWARD,

            // ---- MET generic L/E and U/E patterns from the xlsx.
            // The literal "*" key would never match a real intervention name,
            // so I'm leaving them keyed under unique sentinel strings; if you
            // want to apply MET_LE / MET_UE to specific MET-* interventions,
            // add explicit entries below (e.g. "MET-Tibial IR": MET_LE).
            "MET * (L/E)": MET_LE,
            "MET * (U/E)": MET_UE,

            // ---- Therapeutic Activities (97530) ----
            "Sit to Stand":      SIT_TO_STAND_DATA,
            "Sit to Supine":     SIT_TO_SUPINE_DATA,
            "Step up":           STAIR_CLIMB_DATA,
            "Step down":         STAIR_CLIMB_DATA,
            "Forward lunges":    SQUAT_RECOVER_DATA,
            "Reverse lunges":    SQUAT_RECOVER_DATA,
            "Side lunges":       SQUAT_RECOVER_DATA,
            "Squat":             SQUAT_RECOVER_DATA,
            "Push cable column": FUNCTIONAL_YARD,
            "Pull cable column": FUNCTIONAL_YARD,

            // ---- Balance / Single-leg / Tandem / Airex (97112) ----
            // xlsx had "Semi Tandem " with a trailing space; prefix-match catches either form.
            "Semi Tandem":       GLUTE_MED_BALANCE,
            "Tandem stand":      GLUTE_MED_BALANCE,
            "Single leg stand":  GLUTE_MED_BALANCE,
            "Airex":             GLUTE_MED_BALANCE,
            "Airex tandem":      GLUTE_MED_BALANCE,
            "Airex semi-tandem": GLUTE_MED_BALANCE,
        };
        log.log(`interventionData loaded with ${Object.keys(interventionData).length} keys:`, Object.keys(interventionData));

        /** Lookup with two-pass matching:
         *    1. Exact match on the row's visible name.
         *    2. If no exact, longest-prefix match (so e.g. the page's
         *       "MET to restore left/right backward torsional motion (R/R correction)"
         *       still finds the data key without the suffix).
         */
        function findEntry(name) {
            if (interventionData[name]) return { entry: interventionData[name], key: name, exact: true };
            let bestKey = null;
            for (const k of Object.keys(interventionData)) {
                if (name.startsWith(k) && (!bestKey || k.length > bestKey.length)) bestKey = k;
            }
            if (bestKey) return { entry: interventionData[bestKey], key: bestKey, exact: false };
            return null;
        }

        // Real selectors derived from Example_Chart_Note_expanded.mhtml.
        const SEL = {
            grid: '.MuiDataGrid-root',
            row: '.MuiDataGrid-row[data-id]',
            expandToggle: 'button.MuiDataGrid-detailPanelToggleCell',
            nameSpan: '[data-field="intervention_name"] span[title]',
            doneCheckbox: 'input[type="checkbox"][aria-label$=" done state"]',
            detailPanel: '.MuiDataGrid-detailPanel',
            justificationTextarea: 'textarea[placeholder="Add justification"]',
            procedureInput: 'input[aria-label="Procedure"]',
        };
        log.log('selector map:', SEL);

        // Internal state
        const processedIds = new Set();
        let baselineIds = null;          // null until baseline is locked in
        let baselineLocked = false;
        let dryRun = false;              // when true, the script LOGS what it would do but doesn't actually fill

        // Expose toggles + helpers for DevTools (declared early so we can mention them in boot log).
        window.__athelasDryRunOn  = () => { dryRun = true;  log.warn('dry-run ENABLED - subsequent fills will only LOG, not modify'); };
        window.__athelasDryRunOff = () => { dryRun = false; log.warn('dry-run DISABLED - fills will modify the DOM'); };
        window.__athelasResetBaseline = () => {
            log.warn('manually resetting baseline - next sweep will treat EVERY row as new');
            baselineIds = null;
            baselineLocked = false;
            processedIds.clear();
            tryLockBaseline(true);
        };
        window.__athelasSweep = () => sweep();
        window.__athelasInterventionData = interventionData;

        // ---- Helper: find an intervention row by data-id ----
        function findRow(id) {
            const row = document.querySelector(`${SEL.row}[data-id="${id}"]`);
            if (!row) log.warn(`findRow: no row with data-id="${id}"`);
            return row;
        }

        // ---- Inspect helper: dump everything we can see about a row ----
        window.__athelasInspectRow = function (id) {
            const row = findRow(id);
            if (!row) return;
            console.group(`[athelas:inspect] row data-id=${id}`);
            console.log('row element:', row);
            console.log('row classes:', row.className);
            console.log('row attrs:', Array.from(row.attributes).map(a => `${a.name}="${a.value}"`).join(' '));

            const name = getRowName(row);
            console.log(`getRowName -> "${name}"`);

            const toggle = row.querySelector(SEL.expandToggle);
            console.log(`expand toggle:`, toggle, toggle ? `(aria-label="${toggle.getAttribute('aria-label')}", expanded=${toggle.classList.contains('MuiDataGrid-detailPanelToggleCell--expanded')})` : '(not found)');

            const done = row.querySelector(SEL.doneCheckbox);
            console.log(`done checkbox:`, done, done ? `(checked=${done.checked}, aria-label="${done.getAttribute('aria-label')}")` : '(not found)');

            const panel = findDetailPanel(row);
            console.log(`detail panel:`, panel);
            if (panel) {
                console.log(`  justification textarea:`, panel.querySelector(SEL.justificationTextarea));
                console.log(`  procedure input:`, panel.querySelector(SEL.procedureInput));
                console.log(`  ALL inputs in panel:`);
                panel.querySelectorAll('input, textarea').forEach((el, i) => {
                    console.log(`    [${i}] <${el.tagName.toLowerCase()}> aria-label="${el.getAttribute('aria-label')}" placeholder="${el.placeholder || ''}" id="${el.id}" type="${el.type || ''}"`);
                });
            }

            const dataEntry = interventionData[name];
            console.log(`interventionData["${name}"]:`, dataEntry);
            console.log('processedIds includes this id?', processedIds.has(id));
            console.log('baselineIds includes this id?', baselineIds ? baselineIds.has(id) : '(baseline not locked yet)');
            console.groupEnd();
        };

        // ---- Detail panel lookup ----
        function findDetailPanel(row) {
            const id = row.getAttribute('data-id');
            const byId = document.querySelector(`${SEL.detailPanel}[data-id="${id}"]`);
            if (byId) return byId;
            let n = row.nextElementSibling;
            while (n) {
                if (n.matches && n.matches(SEL.detailPanel)) return n;
                n = n.nextElementSibling;
            }
            // Geometry fallback
            const rect = row.getBoundingClientRect();
            const candidates = document.querySelectorAll(SEL.detailPanel);
            for (const c of candidates) {
                const cr = c.getBoundingClientRect();
                if (Math.abs(cr.top - rect.bottom) < 20) return c;
            }
            return null;
        }

        // ---- Name extraction ----
        function getRowName(row) {
            const span = row.querySelector(SEL.nameSpan);
            if (span) {
                const t = (span.getAttribute('title') || span.textContent || '').trim();
                if (t) return t;
            }
            const wrapper = row.querySelector('[aria-label$=" name"]');
            if (wrapper) {
                const t = wrapper.getAttribute('aria-label').replace(/\s+name$/, '').trim();
                if (t) return t;
            }
            return null;
        }

        // ---- Expand a row's detail panel ----
        async function expandRow(row) {
            const toggle = row.querySelector(SEL.expandToggle);
            if (!toggle) { log.warn('  expand: no toggle button in row', row); return false; }
            const expanded = toggle.classList.contains('MuiDataGrid-detailPanelToggleCell--expanded')
                          || toggle.getAttribute('aria-label') === 'Collapse';
            log.log(`  expand: toggle aria-label="${toggle.getAttribute('aria-label')}", currently expanded=${expanded}`);
            if (!expanded) {
                if (dryRun) {
                    log.log('  expand: [DRY RUN] would click toggle');
                } else {
                    simulateClick(toggle, log);
                }
                await sleep(450);
            }
            return true;
        }

        // ---- Step 3: justification ----
        function fillJustification(detailPanel, value) {
            const ta = detailPanel.querySelector(SEL.justificationTextarea);
            if (!ta) {
                log.warn('  [step 3] justification textarea not found. Listing all textareas in panel:');
                detailPanel.querySelectorAll('textarea').forEach((t, i) => log.log(`    textarea[${i}]: placeholder="${t.placeholder}", aria-label="${t.getAttribute('aria-label')}", id=${t.id}`));
                return false;
            }
            log.log(`  [step 3] justification textarea found (id=${ta.id}, current="${ta.value.slice(0,40)}...")`);
            if (dryRun) { log.log(`  [step 3] [DRY RUN] would set value to "${value.slice(0,60)}..."`); return true; }
            return setReactValue(ta, value, log);
        }

        // ---- Step 4: procedure ----
        async function fillProcedure(detailPanel, value) {
            const input = detailPanel.querySelector(SEL.procedureInput);
            if (!input) {
                log.warn('  [step 4] procedure input not found. Listing all inputs in panel:');
                detailPanel.querySelectorAll('input').forEach((el, i) => log.log(`    input[${i}]: aria-label="${el.getAttribute('aria-label')}", role="${el.getAttribute('role')}", type="${el.type}", id="${el.id}"`));
                return false;
            }
            log.log(`  [step 4] procedure input found (id=${input.id}, current="${input.value}")`);
            if (dryRun) { log.log(`  [step 4] [DRY RUN] would set value to "${value}"`); return true; }

            // Open the dropdown so MUI Autocomplete commits the choice cleanly.
            input.focus();
            const popupBtn = input.closest('.MuiAutocomplete-root')?.querySelector('button[aria-label="Open"]');
            if (popupBtn) { log.log('  [step 4] clicking Open button to expand autocomplete'); simulateClick(popupBtn, log); await sleep(200); }

            const ok = setReactValue(input, value, log);
            await sleep(300);

            const popup = document.querySelector('.MuiAutocomplete-popper');
            if (popup) {
                const options = popup.querySelectorAll('li[role="option"]');
                log.log(`  [step 4] autocomplete popup has ${options.length} options`);
                const match = Array.from(options).find(o => {
                    const t = o.textContent.trim();
                    return t === value || t.startsWith(value + ' ') || t.startsWith(value + '—') || t.includes(value);
                });
                if (match) {
                    log.log(`  [step 4] clicking matching option: "${match.textContent.trim().slice(0,60)}"`);
                    simulateClick(match, log);
                } else {
                    log.warn(`  [step 4] no popup option contains "${value}" - dispatching Enter to commit typed value`);
                    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
                }
            } else {
                log.log('  [step 4] no autocomplete popup appeared - dispatching Enter to commit value');
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
            }
            return ok;
        }

        // ---- Step 5: Done checkbox ----
        async function tickDone(row) {
            const cb = row.querySelector(SEL.doneCheckbox);
            if (!cb) { log.warn('  [step 5] done checkbox not in row'); return false; }
            log.log(`  [step 5] done checkbox aria-label="${cb.getAttribute('aria-label')}", currently checked=${cb.checked}`);
            if (dryRun) { log.log(`  [step 5] [DRY RUN] would ${cb.checked ? 'skip (already checked)' : 'click to check'}`); return true; }
            return await ensureChecked(cb, true, log);
        }

        // ---- The 5-step procedure ----
        async function processRow(row) {
            const id = row.getAttribute('data-id');
            if (processedIds.has(id)) {
                // Top-level skip log (no group) — quieter than groupCollapsed.
                return;
            }
            processedIds.add(id);

            const name = getRowName(row);
            if (!name) {
                log.warn(`processRow: row data-id=${id} has no readable name yet - will retry on next sweep`);
                processedIds.delete(id);
                return;
            }

            const match = findEntry(name);

            // ALWAYS log the top-level summary so misses are visible without expanding.
            if (!match) {
                log.warn(`SKIP - no data entry for "${name}" (id=${id}). Available keys:`, Object.keys(interventionData));
                log.warn(`  -> add an entry to interventionData with key "${name}" to auto-fill this intervention.`);
                return;
            }
            const entry = match.entry;
            if (!match.exact) {
                log.warn(`PREFIX MATCH - row name "${name}" matched data key "${match.key}" (page suffix ignored).`);
            }

            log.log(`FILL - "${name}" (id=${id})${dryRun ? ' [DRY RUN]' : ''}`);

            // Now an OPEN group with the per-step detail (so it's expanded by default).
            console.group(`[athelas:autofill] details for "${name}" (id=${id})`);
            try {
                log.log('[step 1/5] scrollIntoView');
                row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                await sleep(350);

                log.log('[step 2/5] expand row');
                await expandRow(row);

                const panel = findDetailPanel(row);
                if (!panel) {
                    log.error('  detail panel NOT FOUND after expand - aborting remaining steps');
                    console.groupEnd();
                    return;
                }
                log.log('  detail panel located:', panel);

                log.log('[step 3/5] fill justification');
                const ok3 = fillJustification(panel, entry.justification);
                log.log(`  [step 3] result: ${ok3 ? 'OK' : 'FAILED'}`);

                log.log('[step 4/5] fill procedure');
                const ok4 = await fillProcedure(panel, entry.procedureNumber);
                log.log(`  [step 4] result: ${ok4 ? 'OK' : 'FAILED'}`);

                log.log('[step 5/5] tick Done');
                const ok5 = await tickDone(row);
                log.log(`  [step 5] result: ${ok5 ? 'OK' : 'FAILED'}`);


                // Persistent yellow highlight so the user can see at a glance
                // which rows the script auto-filled (in addition to whatever
                // they queued from the dialog).
                markRowHighlighted(id, `autofilled: ${name}`);

                log.log(`done with "${name}"`);
            } catch (err) {
                log.error('processRow threw:', err);
            } finally {
                console.groupEnd();
            }
        }

        // ---- Baseline + sweep ----
        function lockBaseline() {
            if (baselineLocked) return;
            const grid = document.querySelector(SEL.grid);
            if (!grid) return;
            const rows = grid.querySelectorAll(SEL.row);
            baselineIds = new Set(Array.from(rows).map(r => r.getAttribute('data-id')));
            baselineLocked = true;
            log.log(`%cBASELINE LOCKED with ${baselineIds.size} pre-existing rows:`, 'color: #2a7; font-weight: bold;', [...baselineIds]);
        }
        function tryLockBaseline(forceImmediate = false) {
            const quietMs = 1500;
            const maxWaitMs = 12000;
            const startedAt = Date.now();
            let lastCount = -1;
            let stableSince = null;
            if (forceImmediate) { lockBaseline(); return; }
            const interval = setInterval(() => {
                const grid = document.querySelector(SEL.grid);
                if (!grid) return;
                const rows = grid.querySelectorAll(SEL.row);
                const count = rows.length;
                if (count !== lastCount) {
                    log.log(`  grid row count: ${lastCount} -> ${count} (resetting stable clock)`);
                    lastCount = count;
                    stableSince = Date.now();
                    return;
                }
                const stableFor = Date.now() - stableSince;
                const elapsedTotal = Date.now() - startedAt;
                if ((count > 0 && stableFor >= quietMs) || elapsedTotal >= maxWaitMs) {
                    clearInterval(interval);
                    log.log(`grid settled: count=${count}, stable for ${stableFor}ms, total wait ${elapsedTotal}ms`);
                    lockBaseline();
                }
            }, 250);
        }
        function sweep() {
            const grid = document.querySelector(SEL.grid);
            if (!grid) return;
            if (!baselineLocked) return;
            const rows = Array.from(grid.querySelectorAll(SEL.row));
            const newRows = rows.filter(r => !baselineIds.has(r.getAttribute('data-id')) && !processedIds.has(r.getAttribute('data-id')));
            if (newRows.length === 0) return;
            log.log(`sweep: ${newRows.length} truly-new row(s) detected:`, newRows.map(r => r.getAttribute('data-id')));
            newRows.forEach(processRow);
        }

        (async () => {
            log.log('waiting for MuiDataGrid...');
            const grid = await waitFor(SEL.grid, { log });
            if (!grid) { log.error('grid never appeared - autofill disabled'); return; }
            tryLockBaseline();
            const flowsheet = document.querySelector('[data-section="flowsheet"]') || document.body;
            let pending = null;
            const obs = new MutationObserver(() => {
                if (pending) return;
                pending = setTimeout(() => { pending = null; sweep(); }, 250);
            });
            obs.observe(flowsheet, { childList: true, subtree: true });
            const POLL_MS = 1500;
            setInterval(() => sweep(), POLL_MS);
            log.log('observer + 1.5s backup poll attached');
        })();

        window.__athelasResetBaseline = () => {
            log.warn('manually resetting baseline');
            baselineIds = null;
            baselineLocked = false;
            processedIds.clear();
            tryLockBaseline(true);
        };
        window.__athelasSweep = () => sweep();
        window.__athelasInterventionData = interventionData;
    }


    // =====================================================================
    // MODULE 4: Focus + clear the Add Interventions search bar on dialog open.
    // =====================================================================
    function featureFocusInterventionsSearch() {
        const log = makeLogger('focus-search');
        log.log('module booted');
        const seenDialogs = new WeakSet();

        function handleDialog(dialog) {
            if (seenDialogs.has(dialog)) return;
            const title = dialog.querySelector('h2');
            const titleText = title ? title.textContent.trim() : '';
            if (!/Add Interventions/i.test(titleText)) return;
            seenDialogs.add(dialog);
            log.log('Add Interventions dialog detected, will focus + clear search');
            setTimeout(() => {
                // Prefer "Search" (left-rail filter); fall back to "Search Treatments".
                const search = dialog.querySelector('input[placeholder="Search"]')
                            || dialog.querySelector('input[placeholder="Search Treatments"]');
                if (!search) {
                    log.warn('no search input found in dialog. All inputs:');
                    dialog.querySelectorAll('input').forEach((el, i) => {
                        log.log(`  input[${i}] placeholder="${el.placeholder}" aria-label="${el.getAttribute('aria-label')}" id="${el.id}"`);
                    });
                    return;
                }
                log.log(`found search input: placeholder="${search.placeholder}", current value="${search.value}"`);
                if (search.value) setReactValue(search, '', log);
                search.focus();
                log.log(`focused. activeElement matches? ${document.activeElement === search}`);
            }, 200);
        }

        function scan() {
            document.querySelectorAll('[role="dialog"], .MuiDialog-paper').forEach(handleDialog);
        }
        scan();
        let pending = null;
        const obs = new MutationObserver(() => {
            if (pending) return;
            pending = setTimeout(() => { pending = null; scan(); }, 150);
        });
        const startObserving = () => {
            obs.observe(document.body, { childList: true, subtree: true });
            log.log('MutationObserver attached for dialog mounts');
        };
        if (document.body) startObserving();
        else new MutationObserver((_, o) => { if (document.body) { o.disconnect(); startObserving(); } })
                .observe(document.documentElement, { childList: true });
    }


    // =====================================================================
    // MODULE 5: Mins-column helpers - select-all on focus, blank-out button.
    // =====================================================================
    function featureMinsColumnHelpers() {
        const log = makeLogger('mins');
        log.log('module booted');

        // ---- Feature A: select-all on Mins cell focus ----------------------
        document.addEventListener('focusin', (ev) => {
            const input = ev.target;
            if (!(input instanceof HTMLInputElement)) return;
            if (!input.closest('.MuiDataGrid-editInputCell')) return;
            if (!input.closest('[data-field="minutes"]')) return;
            setTimeout(() => {
                try {
                    input.select();
                    log.log(`select-all fired on Mins input (value="${input.value}")`);
                } catch (err) { log.warn('select() threw', err); }
            }, 0);
        }, true);
        log.log('Feature A wired: focusin handler will select-all on Mins cell activation');

        // ---- Feature B: "Blank out undone minutes" button ------------------
        const BUTTON_ID = 'athelas-blank-undone-mins-btn';

        async function blankUndoneMinutes() {
            const grid = document.querySelector('.MuiDataGrid-root');
            if (!grid) { log.warn('blankUndoneMinutes: no grid'); return; }
            const rows = Array.from(grid.querySelectorAll('.MuiDataGrid-row[data-id]'));
            log.log(`blankUndoneMinutes: scanning ${rows.length} rows`);
            let cleared = 0, skippedDone = 0, skippedEmpty = 0, failed = 0;
            for (const row of rows) {
                const id = row.getAttribute('data-id');
                const done = row.querySelector('input[type="checkbox"][aria-label$=" done state"]');
                if (done && done.checked) { skippedDone++; continue; }
                const cell = row.querySelector('[data-field="minutes"]');
                if (!cell) { failed++; continue; }
                const currentText = cell.textContent.trim();
                if (!currentText) { skippedEmpty++; continue; }
                log.log(`row ${id}: clearing minutes (was "${currentText}")`);
                simulateClick(cell, log);
                await sleep(120);
                const input = cell.querySelector('.MuiDataGrid-editInputCell input, input[type="text"]');
                if (!input) { failed++; continue; }
                setReactValue(input, '', log);
                await sleep(60);
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
                input.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', code: 'Enter', bubbles: true }));
                input.blur();
                await sleep(100);
                cleared++;
            }
            log.log(`%cblankUndoneMinutes done: cleared=${cleared}, skipped done=${skippedDone}, skipped empty=${skippedEmpty}, failed=${failed}`, 'color: #2a7; font-weight: bold;');
        }
        window.__athelasBlankUndoneMinutes = blankUndoneMinutes;

        function positionButton() {
            const btn = document.getElementById(BUTTON_ID);
            if (!btn) return;
            const grid = document.querySelector('.MuiDataGrid-root');
            const minsHeader = document.querySelector('[role="columnheader"][data-field="minutes"]');
            if (!grid || !minsHeader) return;
            const gridRect = grid.getBoundingClientRect();
            const colRect  = minsHeader.getBoundingClientRect();
            const left = Math.max(0, colRect.left - gridRect.left);
            btn.style.marginLeft = `${left}px`;
            btn.style.width      = `${colRect.width}px`;
        }

        function ensureButton() {
            const grid = document.querySelector('.MuiDataGrid-root');
            if (!grid) return;
            const existing = document.getElementById(BUTTON_ID);
            if (existing) {
                // Edit-mode toggle wraps the grid in a new MuiBox-root container
                // and replaces the grid element, which leaves our button
                // stranded ABOVE the new grid. If the button is no longer the
                // grid's immediate next-sibling, re-anchor it.
                if (existing.previousElementSibling !== grid) {
                    grid.insertAdjacentElement('afterend', existing);
                    log.log('button re-anchored below grid (grid was re-mounted, likely by edit-mode toggle)');
                }
                positionButton();
                return;
            }
            const btn = document.createElement('button');
            btn.id = BUTTON_ID;
            btn.type = 'button';
            btn.textContent = 'Blank out undone minutes';
            Object.assign(btn.style, {
                display: 'block',
                boxSizing: 'border-box',
                margin: '6px 0 8px',
                padding: '6px 6px',
                background: '#c33',
                border: '1px solid #a22',
                borderRadius: '4px',
                color: '#fff',
                font: '500 12px/1.2 system-ui, sans-serif',
                textAlign: 'center',
                cursor: 'pointer',
                whiteSpace: 'normal',
            });
            btn.addEventListener('mouseenter', () => { btn.style.background = '#a22'; });
            btn.addEventListener('mouseleave', () => { btn.style.background = btn.disabled ? '#888' : '#c33'; });
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                btn.textContent = 'Clearing...';
                btn.style.background = '#888';
                try { await blankUndoneMinutes(); }
                finally {
                    btn.textContent = 'Blank out undone minutes';
                    btn.style.background = '#c33';
                    btn.disabled = false;
                }
            });
            grid.insertAdjacentElement('afterend', btn);
            positionButton();
            log.log('Blank-out button inserted under Mins column');
        }

        ensureButton();
        setInterval(ensureButton, 2000);
        window.addEventListener('resize', positionButton);
    }


    // =====================================================================
    // MODULE 6: "↓ Highlight" buttons in Add Interventions dialog + persistent
    // highlight applied when the dialog closes.
    // =====================================================================
    function featureMoveToBottom() {
        const log = makeLogger('highlight-queue');
        log.log('module booted');

        const MARK_BTN_ATTR = 'data-athelas-move-btn';
        const toMoveSet = new Set();
        window.__athelasMoveQueue = toMoveSet;

        function styleButton(btn, queued) {
            btn.textContent = queued ? '✓ queued' : '↓ Highlight';
            btn.title = queued
                ? 'Will be highlighted yellow in the intervention grid when this dialog closes. Click again to un-queue.'
                : 'Queue this intervention to be highlighted yellow in the intervention grid after this dialog closes, so you can find it.';
            Object.assign(btn.style, {
                position: 'absolute',
                top: '4px',
                right: '46px',
                zIndex: '5',
                padding: '2px 6px',
                background: queued ? '#cf9' : '#fff',
                border: '1px solid #888',
                borderRadius: '4px',
                color: queued ? '#262' : '#222',
                font: '500 11px/1.1 system-ui, sans-serif',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
            });
        }

        function rowIsChecked(li) {
            const cb = li.querySelector('input[type="checkbox"]');
            return !!(cb && cb.checked);
        }

        function injectButtonInRow(li) {
            if (li.getAttribute(MARK_BTN_ATTR) === '1') return;
            if (!rowIsChecked(li)) return;
            const name = li.getAttribute('aria-label');
            if (!name) return;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.setAttribute(MARK_BTN_ATTR, '1');
            styleButton(btn, toMoveSet.has(name));
            const handler = (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                if (toMoveSet.has(name)) {
                    toMoveSet.delete(name);
                    log.log(`un-queued: "${name}"`);
                } else {
                    toMoveSet.add(name);
                    log.log(`queued: "${name}"`);
                }
                styleButton(btn, toMoveSet.has(name));
            };
            btn.addEventListener('click',     handler, true);
            btn.addEventListener('mousedown', (e) => { e.stopPropagation(); }, true);
            const cs = getComputedStyle(li);
            if (cs.position === 'static') li.style.position = 'relative';
            li.appendChild(btn);
            li.setAttribute(MARK_BTN_ATTR, '1');
        }

        function scanDialog(dialog) {
            const rows = dialog.querySelectorAll('li[aria-label]');
            rows.forEach((li) => {
                if (li.getAttribute(MARK_BTN_ATTR) !== '1' && rowIsChecked(li)) injectButtonInRow(li);
            });
        }

        function findGridRow(name) {
            const wrapper = document.querySelector(`[aria-label="${CSS.escape(name)} name"]`);
            if (!wrapper) return null;
            return wrapper.closest('.MuiDataGrid-row[data-id]');
        }

        async function processQueue() {
            if (toMoveSet.size === 0) return;
            const names = [...toMoveSet];
            log.log(`processQueue: highlighting ${names.length} rows:`, names);
            await sleep(400);
            const finds = [];
            for (const name of names) {
                const row = findGridRow(name);
                if (!row) { log.warn(`no grid row for "${name}"`); continue; }
                const id = row.dataset.id;
                log.log(`  found "${name}" (data-id=${id}) - persistent highlight`);
                markRowHighlighted(id, `queued from dialog: ${name}`);
                finds.push({ name, row, id });
            }
            toMoveSet.clear();
            if (finds.length === 0) return;
            const last = finds[finds.length - 1].row;
            last.scrollIntoView({ behavior: 'smooth', block: 'center' });
            log.log(`${finds.length} row(s) persistently highlighted. Call __athelasClearHighlights() to clear.`);
        }

        let activeDialog = null;
        let innerObs = null;
        function onDialogOpen(dialog) {
            activeDialog = dialog;
            log.log('Add Interventions dialog OPEN');
            scanDialog(dialog);
            innerObs = new MutationObserver(() => scanDialog(dialog));
            innerObs.observe(dialog, { childList: true, subtree: true });
        }
        function onDialogClose() {
            log.log('Add Interventions dialog CLOSE');
            if (innerObs) { innerObs.disconnect(); innerObs = null; }
            activeDialog = null;
            processQueue();
        }
        function isInterventionsDialog(dialog) {
            const title = dialog && dialog.querySelector('h2');
            return !!(title && /Add Interventions/i.test(title.textContent || ''));
        }
        function checkDialogs() {
            const dlg = document.querySelector('[role="dialog"]');
            const isOurs = dlg && isInterventionsDialog(dlg);
            if (isOurs && dlg !== activeDialog) {
                if (activeDialog) onDialogClose();
                onDialogOpen(dlg);
            } else if (!isOurs && activeDialog) {
                onDialogClose();
            }
        }
        const obs = new MutationObserver(() => checkDialogs());
        const startObserving = () => {
            obs.observe(document.body, { childList: true, subtree: true });
            checkDialogs();
        };
        if (document.body) startObserving();
        else new MutationObserver((_, o) => { if (document.body) { o.disconnect(); startObserving(); } })
                .observe(document.documentElement, { childList: true });
        window.__athelasProcessMoveQueue = processQueue;
    }


    // =====================================================================
    // MODULE 7 (v13): Force "edit mode" on the interventions grid on load.
    //
    // Two important things we learned the hard way (v12 broke on these):
    //
    //  (a) The page renders TWO Flowsheet Edit buttons - a full text
    //      button (aria-label="Flowsheet Edit") for wide screens and an
    //      icon-only button (aria-label="Flowsheet Edit Icon Button")
    //      for narrow screens. Only one is interactable at any given
    //      viewport width. We try both.
    //
    //  (b) The button's data-selected attribute is NOT a reliable
    //      indicator of state - in the snapshot we have where edit mode
    //      is provably ON, data-selected still reads "false". So we
    //      detect edit-mode state by the presence of the columns it
    //      reveals: [role="columnheader"][data-field="removeExerciseButton"]
    //      (the trash-bin column) and [data-field="__dragHandle__"].
    //
    // Flow:
    //  1. Wait for the grid (so we have something to check column state on).
    //  2. Check if removeExerciseButton column is already present -> done.
    //  3. Find an interactable edit button.
    //  4. Click it. Wait. Re-check the column.
    //  5. If still missing, click again (up to 3 attempts).
    // =====================================================================
    function featureForceEditMode() {
        const log = makeLogger('force-edit');
        const T0 = Date.now();
        const ts = () => `+${Date.now() - T0}ms`;
        log.log(`${ts()} module booted, v13`);

        const REMOVE_COL_SELECTOR = '[role="columnheader"][data-field="removeExerciseButton"]';
        const DRAG_COL_SELECTOR   = '[role="columnheader"][data-field="__dragHandle__"]';

        function editModeIsOn() {
            const removeCol = document.querySelector(REMOVE_COL_SELECTOR);
            const dragCol   = document.querySelector(DRAG_COL_SELECTOR);
            return !!(removeCol || dragCol);
        }

        function findEditButton() {
            // Try both variants. Filter for ones that are actually in the
            // viewport (not display:none) and not disabled.
            const candidates = document.querySelectorAll(
                'button[aria-label="Flowsheet Edit"], button[aria-label="Flowsheet Edit Icon Button"]'
            );
            log.log(`${ts()} findEditButton: ${candidates.length} candidate(s)`);
            for (const btn of candidates) {
                const label = btn.getAttribute('aria-label');
                const sel   = btn.getAttribute('data-selected');
                const dis   = btn.getAttribute('disabled') !== null || btn.getAttribute('aria-disabled') === 'true';
                const rect  = btn.getBoundingClientRect();
                const cs    = getComputedStyle(btn);
                const visible = rect.width > 0 && rect.height > 0 &&
                                cs.display !== 'none' && cs.visibility !== 'hidden';
                log.log(`  candidate: aria-label="${label}", data-selected="${sel}", disabled=${dis}, rect=${Math.round(rect.width)}x${Math.round(rect.height)}, visible=${visible}`);
                if (visible && !dis) {
                    log.log(`  -> PICKED this one`);
                    return btn;
                }
            }
            log.warn(`${ts()} findEditButton: no interactable button found`);
            return null;
        }

        // ---- React Fiber introspection helpers (v13.1) ----
        // When dispatching synthetic click events isn't enough (some MUI
        // builds check event.isTrusted, or ripple handlers consume the
        // event before onClick can fire), we can walk into React's
        // internals and call the onClick prop directly. This bypasses the
        // DOM event system entirely. Fragile across React versions but
        // works when nothing else does.
        function findReactProps(el) {
            const key = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
            return key ? el[key] : null;
        }
        function findReactFiber(el) {
            const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
            return key ? el[key] : null;
        }
        function inspectButtonForReact(btn) {
            const props = findReactProps(btn);
            const fiber = findReactFiber(btn);
            const lines = [];
            lines.push(`  React props found: ${!!props}, fiber found: ${!!fiber}`);
            if (props) {
                const handlerKeys = Object.keys(props).filter((k) => /^on[A-Z]/.test(k));
                lines.push(`  React on* handlers on button: [${handlerKeys.join(', ')}]`);
            }
            // Walk up the fiber tree looking for handlers
            if (fiber) {
                let f = fiber;
                let depth = 0;
                while (f && depth < 5) {
                    const t = f.type ? (typeof f.type === 'function' ? (f.type.displayName || f.type.name || '?') : String(f.type).slice(0, 40)) : 'host';
                    const p = f.memoizedProps || {};
                    const hKeys = Object.keys(p).filter((k) => /^on[A-Z]/.test(k));
                    lines.push(`  fiber depth ${depth} (${t}): on* = [${hKeys.join(', ')}]`);
                    f = f.return;
                    depth++;
                }
            }
            return lines;
        }

        // Strategy 2: call the React onClick prop directly. Walks the
        // fiber tree if the immediate props don't carry an onClick (e.g.
        // when MUI's ButtonBase wraps the native button - the actual
        // handler may live on the ButtonBase fiber a few levels up).
        function clickViaReactProps(btn) {
            // Build a "good enough" synthetic event React handlers usually
            // tolerate. Most handlers just touch preventDefault and the
            // target.
            const makeEvent = () => ({
                type: 'click',
                target: btn,
                currentTarget: btn,
                nativeEvent: new MouseEvent('click', { bubbles: true, cancelable: true }),
                preventDefault: () => {},
                stopPropagation: () => {},
                isDefaultPrevented: () => false,
                isPropagationStopped: () => false,
                isTrusted: false,
                bubbles: true,
                cancelable: true,
                button: 0,
                buttons: 0,
                clientX: 0,
                clientY: 0,
                pageX: 0,
                pageY: 0,
            });

            // Look on the element itself first.
            const props = findReactProps(btn);
            if (props && typeof props.onClick === 'function') {
                log.log('  strategy 2: calling props.onClick on the button element directly');
                try { props.onClick(makeEvent()); return true; }
                catch (err) { log.error('  props.onClick threw:', err); return false; }
            }
            // Walk up the fiber to find an onClick handler.
            const fiber = findReactFiber(btn);
            let f = fiber;
            let depth = 0;
            while (f && depth < 6) {
                const p = f.memoizedProps || {};
                if (typeof p.onClick === 'function') {
                    log.log(`  strategy 2: calling onClick from fiber depth ${depth}`);
                    try { p.onClick(makeEvent()); return true; }
                    catch (err) { log.error(`  fiber.onClick threw at depth ${depth}:`, err); return false; }
                }
                f = f.return;
                depth++;
            }
            log.warn('  strategy 2: no onClick found on element or up 6 fiber levels');
            return false;
        }

        // Strategy 3: keyboard activation. MUI Button responds to Enter
        // and Space. Dispatch a full key sequence.
        function clickViaKeyboard(btn) {
            btn.focus();
            const opts = { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 };
            btn.dispatchEvent(new KeyboardEvent('keydown', opts));
            btn.dispatchEvent(new KeyboardEvent('keypress', opts));
            btn.dispatchEvent(new KeyboardEvent('keyup', opts));
            log.log('  strategy 3: focus() + Enter keydown/keypress/keyup dispatched');
        }

        async function tryEnable(attempt) {
            log.log(`%c${ts()} tryEnable attempt #${attempt}`, 'color: #58c; font-weight: bold;');
            log.log(`  editModeIsOn() = ${editModeIsOn()}`);
            log.log(`  removeExerciseButton column: ${document.querySelector(REMOVE_COL_SELECTOR) ? 'PRESENT' : 'missing'}`);
            log.log(`  __dragHandle__ column:       ${document.querySelector(DRAG_COL_SELECTOR) ? 'PRESENT' : 'missing'}`);

            if (editModeIsOn()) {
                log.log(`${ts()} edit mode IS ALREADY ON - done`);
                return true;
            }

            const btn = findEditButton();
            if (!btn) {
                log.warn(`${ts()} no edit button to click on attempt #${attempt}`);
                return false;
            }

            // Dump React introspection ONCE on attempt 1 so we can see what
            // handlers the button actually exposes if everything fails.
            if (attempt === 1) {
                log.log(`${ts()} React introspection on button:`);
                for (const line of inspectButtonForReact(btn)) log.log(line);
            }

            // Strategy 1: regular simulateClick (native + dispatched MouseEvent).
            log.log(`${ts()} strategy 1: simulateClick`);
            btn.focus();
            simulateClick(btn, log);
            await sleep(600);
            if (editModeIsOn()) {
                log.log(`%c${ts()} strategy 1 worked!`, 'color: #2a7; font-weight: bold;');
                return true;
            }
            log.log(`  strategy 1 did not flip state. removeExerciseButton column: ${document.querySelector(REMOVE_COL_SELECTOR) ? 'PRESENT' : 'missing'}`);

            // Strategy 2: call React onClick prop directly.
            log.log(`${ts()} strategy 2: React-prop direct call`);
            const handled = clickViaReactProps(btn);
            log.log(`  strategy 2 reported handled=${handled}`);
            await sleep(600);
            if (editModeIsOn()) {
                log.log(`%c${ts()} strategy 2 worked!`, 'color: #2a7; font-weight: bold;');
                return true;
            }
            log.log(`  strategy 2 did not flip state.`);

            // Strategy 3: keyboard Enter.
            log.log(`${ts()} strategy 3: keyboard Enter`);
            clickViaKeyboard(btn);
            await sleep(600);
            if (editModeIsOn()) {
                log.log(`%c${ts()} strategy 3 worked!`, 'color: #2a7; font-weight: bold;');
                return true;
            }

            log.warn(`${ts()} all 3 strategies failed on attempt #${attempt}`);
            return false;
        }

        (async () => {
            // Wait for the grid so we have something to check column state on.
            log.log(`${ts()} waiting for .MuiDataGrid-root`);
            const grid = await waitFor('.MuiDataGrid-root', { log, timeoutMs: 20000 });
            if (!grid) { log.error(`${ts()} grid never appeared - abort`); return; }
            log.log(`${ts()} grid appeared`);

            // Tiny settle so column headers exist before we measure.
            await sleep(800);

            // Up to 3 attempts. If first doesn't take, sometimes React's
            // onClick handler hadn't fully wired up yet - retry.
            for (let i = 1; i <= 3; i++) {
                const ok = await tryEnable(i);
                if (ok) {
                    log.log(`%c${ts()} edit mode enabled on attempt ${i}`, 'color: #2a7; font-weight: bold;');
                    return;
                }
                // Slightly longer backoff between attempts
                if (i < 3) {
                    log.warn(`${ts()} attempt ${i} failed, will retry after backoff`);
                    await sleep(1000 + i * 500);
                }
            }
            log.error(`${ts()} edit mode could not be enabled after 3 attempts`);
            log.error(`final state: editModeIsOn=${editModeIsOn()}, edit buttons in DOM=${document.querySelectorAll('button[aria-label^="Flowsheet Edit"]').length}`);
        })();

        // Expose for manual debugging
        window.__athelasForceEditMode = async () => {
            log.log('manual trigger from DevTools');
            const ok = await tryEnable('manual');
            log.log(`manual trigger result: ${ok}`);
            return ok;
        };
        window.__athelasEditModeIsOn = editModeIsOn;
    }


    // =====================================================================
    // MODULE 8: DataGrid compact mode (DISABLED in v12.1).
    //
    // ---------------------------------------------------------------
    // BACKGROUND - for a future AI / contributor picking this up:
    // ---------------------------------------------------------------
    //
    // GOAL: shrink the interventions list (an MUI X DataGrid) so rows are
    // ~22px tall (just enough for an 18px checkbox + ~2px padding either
    // side) instead of MUI's configured 48px. The page can't expose enough
    // interventions on one screen at the default 48px - therapists scroll
    // a lot.
    //
    // THE CORE PROBLEM:
    //
    // MUI X DataGrid uses a configured `rowHeight={48}` PROP for its
    // virtualization JS - i.e. the code that decides how many rows to
    // render in the DOM at any moment. CSS can shrink the rows visually
    // (and does, via .MuiDataGrid-row { min-height: 22px !important }
    // type rules elsewhere in cssChartNote - also DISABLED in v12.1, see
    // the other notes block below). But MUI's virtualization JS keeps
    // using its 48px assumption, so:
    //
    //   - MUI reserves space as if each row were 48px tall.
    //     With 35 rows, that's 35 * 48 = 1680px of "content area".
    //     This gets written inline as flex-basis on
    //     .MuiDataGrid-virtualScrollerContent.
    //   - MUI also writes a 1680-ish px height onto
    //     .MuiDataGrid-scrollbarContent (the dummy that drives the
    //     scrollbar's scroll range).
    //   - The CSS shrinks each row visually to 22px.
    //   - Net result: 35 rows render at 22px (total 770px) but the
    //     container reserves 1680px - leaving ~910px of dead space
    //     below the rendered rows.
    //   - To worsen things: MUI's virtualization only renders rows it
    //     thinks fit in the visible viewport, computed against the 48px
    //     assumption. So even when the data WOULD fit visually at 22px,
    //     MUI may render only e.g. 6-20 rows of the 35 available.
    //
    // We can't change `rowHeight={48}` from a userscript - it's a React
    // prop set inside the page's bundle.
    //
    // APPROACHES TRIED (chronologically), with notes on why each failed:
    //
    // v10:   CSS-only - shrink .MuiDataGrid-row to 22px via !important.
    //        Visually rows are 22px. MUI's virtualization still uses 48.
    //        Result: dead space below rendered rows.
    //
    // v10.2: CSS - also override --DataGrid-rowHeight / --rowHeight
    //        CSS variables on the root, plus
    //        .MuiDataGrid-virtualScrollerContent { flex-basis: auto !important }
    //        and .MuiDataGrid-virtualScroller { min-height: 0 !important }.
    //        BROKE virtualization entirely: scroller measured 0 viewport
    //        height, MUI rendered 0 rows. Reverted.
    //
    // v11.1: JS - observe the grid, set inline flex-basis on
    //        virtualScrollerContent to renderZone.offsetHeight (the
    //        actual rendered total).
    //        BUG: when virtualization is active, renderZone reflects only
    //        the rendered window (~7 rows out of 35). Wrote 7*22=154px as
    //        the total content height. MUI then saw a scroll mismatch and
    //        showed a scrollbar.
    //
    // v11.2: Fixed v11.1: use aria-rowcount * actualRowHeight, so the
    //        FULL data height (35 * 22 = 770px) gets written.
    //        Reduced dead space INSIDE the content area but didn't
    //        eliminate visible dead space below the rendered rows - MUI's
    //        render zone still only filled with the rows it thought fit
    //        at its assumed 48px.
    //
    // v11.3: Also mirror desired height onto .MuiDataGrid-scrollbarContent
    //        (the dummy element behind the scrollbar that drives its
    //        scroll range). Fixed scroll range but visible dead space
    //        remained.
    //
    // v11.4: Added extensive debug logging. Confirmed every prior
    //        assumption but the dead space inside the grid persisted.
    //
    // v11.5: JS - shrink the OUTER .MuiDataGrid-root max-height to
    //        (header + renderZone.offsetHeight). Run once.
    //        BROKE: at the moment of clip MUI had only rendered 6 rows,
    //        so the grid was clamped to ~168px and never recovered.
    //
    // v11.6: Fixed v11.5 formula to use aria-rowcount * rowHeight, not
    //        renderZone.offsetHeight. Computed ~828px instead of 168px.
    //        Almost worked but the user reported it was "still resizing
    //        constantly even for a list of the same length" - in some
    //        cases the same dead space recurred during re-renders.
    //
    // v12:   Stripped all observers/polls. Simple one-shot:
    //        max-height = dataRowCount * 22 + 100. Still didn't behave
    //        right for the user. Disabled the feature.
    //
    // PROMISING UNEXPLORED AVENUES:
    //
    //   (1) Reach into MUI X DataGrid's apiRef via React Fiber. Walk the
    //       internal `__reactFiber$xxx` keys on .MuiDataGrid-root up to
    //       the component that owns the grid's apiRef, then call
    //       apiRef.current.unstable_setRowHeight(id, 22) or whatever the
    //       version-specific API is. This would change MUI's internal
    //       virtualization model so it matches our CSS visual. Fragile
    //       across MUI versions but the "right" fix. (Note: v13.1's
    //       force-edit-mode uses similar React-fiber introspection -
    //       see findReactProps / findReactFiber - so the pattern is
    //       already in the codebase.)
    //
    //   (2) Page-wide React DevTools-style instrumentation: hook
    //       React.createElement to intercept DataGrid creation and inject
    //       our own rowHeight prop. Requires injecting before React loads
    //       (document-start) and identifying the right component reliably.
    //
    //   (3) MutationObserver that watches for the `flex-basis: <very
    //       large>px` write event and uses CSS scale() / transform to
    //       visually compress the area to 22/48 of its computed size.
    //       Would distort interactions; impractical.
    //
    //   (4) Negotiate with the page vendor (Athelas) to expose rowHeight
    //       as a user-configurable setting. They've been receptive to
    //       compact-mode feedback before per the user's earlier note.
    //
    // CURRENT STATE: feature DISABLED. The function below is preserved so
    // a future attempt can re-enable + iterate. Also see the "DataGrid CSS
    // DISABLED" block inside cssChartNote (search for it) for the related
    // CSS rules that were commented out.
    // =====================================================================
    /* DISABLED in v12.1 - kept commented for future reference.

    function featureSimpleGridHeight() {
        // ---- TUNABLE CONSTANTS ----
        const GRID_ROW_HEIGHT_PX  = 22;   // height per intervention row
        const GRID_WIGGLE_ROOM_PX = 100;  // extra space (header, scrollbar, padding)
        // ----------------------------

        const log = makeLogger('grid-size');
        log.log('module booted');

        let didOnce = false;

        function resizeOnce() {
            if (didOnce) { log.log('already sized once - skipping'); return; }
            const grid = document.querySelector('.MuiDataGrid-root');
            if (!grid) { log.log('no grid yet'); return; }
            const gridRole = grid.querySelector('[role="grid"]') || grid;
            const totalAriaRows = parseInt(gridRole.getAttribute('aria-rowcount') || '0', 10);
            if (totalAriaRows < 2) { log.log(`aria-rowcount=${totalAriaRows}, waiting`); return; }
            const dataRowCount = totalAriaRows - 1;
            const desired = (dataRowCount * GRID_ROW_HEIGHT_PX) + GRID_WIGGLE_ROOM_PX;
            grid.style.maxHeight = `${desired}px`;
            grid.style.height    = `${desired}px`;
            log.log(`SIZED grid: ${dataRowCount} rows x ${GRID_ROW_HEIGHT_PX}px + ${GRID_WIGGLE_ROOM_PX}px = ${desired}px max-height. LOCKED.`);
            didOnce = true;
        }

        (async () => {
            const grid = await waitFor('.MuiDataGrid-root', { log });
            if (!grid) { log.warn('grid never appeared'); return; }
            for (const delay of [100, 500, 1500, 3000, 6000]) {
                setTimeout(() => resizeOnce(), delay);
            }
        })();

        window.__athelasResizeGridOnce = () => {
            didOnce = false;
            resizeOnce();
        };
    }

    END DISABLED v12.1 */


    // =====================================================================
    // MODULE 9 (v14.2): "Fix MET" button next to the Flowsheet section header.
    //
    // The AI scribe misclassifies Muscle Energy Techniques (MET) under
    // CPT 97140 (Manual Therapy) when they belong under 97112
    // (Neuromuscular Reeducation). We add ONE button in the flowsheet
    // section header row - on the right side, in line with the h3
    // "Flowsheet" heading. Clicking it scans every MET item under 97140
    // and moves them all to the top of the 97112 card.
    //
    // Scribe preview cards live in `data-section="flowsheet"` (each is a
    // `div.tr-rounded-lg.tr-border...` with a header span containing the
    // 5-digit CPT code and a body container of item blocks). Items are
    // NOT wired to react-beautiful-dnd, so we just insertBefore the DOM
    // node. Persistence still requires clicking Apply Scribe afterwards.
    //
    // Per user note: the button is placed as a child of the flowsheet
    // section's grid header row (grid-cols-[1fr_auto]), NOT inline on
    // the h3 element itself.
    // =====================================================================
    function featureFixMisplacedMET() {
        const log = makeLogger('fix-met');
        log.log('module booted, v14.8 (scoped to flowsheet section)');

        const HEADER_BTN_ID = 'athelas-fix-met-header-btn';
        const SOURCE_CODE = '97140';
        const TARGET_CODE = '97112';

        function isMETText(text) {
            const t = (text || '').trim();
            return /\bMET\b/i.test(t) || /muscle\s+energy/i.test(t);
        }

        // ---- React fiber onClick fallback (v14.5) ----
        // For buttons whose React onClick handler doesn't fire on synthetic
        // events. Walks the element's Fiber internals (React 16+ keys are
        // `__reactFiber$xxx` / `__reactProps$xxx`) up to 6 levels looking
        // for an onClick prop, then calls it with a synthetic-event-like
        // object. Bypasses the DOM event system entirely.
        function findReactProps(el) {
            const key = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
            return key ? el[key] : null;
        }
        function findReactFiber(el) {
            const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
            return key ? el[key] : null;
        }
        function clickViaReactFiber(btn, logger) {
            const makeEvent = () => ({
                type: 'click', target: btn, currentTarget: btn,
                nativeEvent: new MouseEvent('click', { bubbles: true, cancelable: true }),
                preventDefault: () => {}, stopPropagation: () => {},
                isDefaultPrevented: () => false, isPropagationStopped: () => false,
                isTrusted: false, bubbles: true, cancelable: true,
                button: 0, buttons: 0, clientX: 0, clientY: 0, pageX: 0, pageY: 0,
            });
            const propsOnEl = findReactProps(btn);
            if (propsOnEl && typeof propsOnEl.onClick === 'function') {
                logger.log('  fiber: calling onClick on the button element directly');
                try { propsOnEl.onClick(makeEvent()); return true; }
                catch (err) { logger.error('  onClick on element threw:', err); return false; }
            }
            const fiber = findReactFiber(btn);
            let f = fiber, depth = 0;
            while (f && depth < 6) {
                const p = f.memoizedProps || {};
                if (typeof p.onClick === 'function') {
                    logger.log(`  fiber: calling onClick at depth ${depth}`);
                    try { p.onClick(makeEvent()); return true; }
                    catch (err) { logger.error(`  fiber onClick at depth ${depth} threw:`, err); return false; }
                }
                f = f.return;
                depth++;
            }
            logger.warn('  fiber: no onClick handler found on element or up 6 levels');
            return false;
        }

        /** Return all procedure-code cards on the page. Cards can be in one
         *  of TWO different DOM formats depending on page mode:
         *
         *  Format A - "PREVIEW": rounded-lg bordered card with
         *    <span class="Body.Small.SemiBold">97140</span> header and
         *    items in <div class="tr-flex tr-flex-col tr-gap-2 tr-px-3 tr-py-2">.
         *    Items themselves are <div class="tr-flex tr-flex-col tr-gap-0.5">
         *    with a Body.Small.SemiBold name span.
         *
         *  Format B - "EDIT" (post +CPT click, or when user enters edit mode):
         *    autocomplete <input aria-label="replace procedure"
         *    value="97140 - Manual Therapy"> for the code header, items in
         *    <ul aria-label="X intervention list"> with items as
         *    <li aria-label="Intervention"> having an <input aria-label="Intervention name">.
         *
         *  We check both. Returns {code, card, itemsContainer, format,
         *  itemSelector, itemNameGetter}.
         */
        function getAllProcedureCards() {
            const results = [];

            // v14.8: scope everything to the FLOWSHEET section so we don't
            // accidentally pick up cards in the scribe-preview section
            // ("data-section=services") - those have their own 97140 in
            // preview format and would mislead the search.
            const scope = document.querySelector('[data-section="flowsheet"]');
            if (!scope) return results;

            // --- Format A: preview cards (still used inside flowsheet if the
            // page ever renders one there) ---
            const rounded = scope.querySelectorAll(
                'div.tr-rounded-lg.tr-border.tr-border-Shape-OnSurface-Outlines.tr-bg-Surface-Neutral-Lighter-Surface'
            );
            for (const card of rounded) {
                let code = null;
                for (const s of card.querySelectorAll(':scope > div span, :scope > div > div span')) {
                    const t = (s.textContent || '').trim();
                    if (/^\d{5}$/.test(t)) { code = t; break; }
                }
                if (!code) continue;
                const itemsContainer = card.querySelector('div.tr-flex.tr-flex-col.tr-gap-2.tr-px-3.tr-py-2');
                results.push({
                    code,
                    card,
                    itemsContainer,
                    format: 'A-preview',
                    itemSelector: ':scope > div.tr-flex.tr-flex-col',
                    itemNameGetter: (item) => {
                        const s = item.querySelector('span');
                        return (s && s.textContent) || '';
                    },
                });
            }

            // --- Format B: edit-mode cards ---
            const replaceInputs = scope.querySelectorAll('input[aria-label="replace procedure"]');
            for (const input of replaceInputs) {
                const val = input.value || input.getAttribute('value') || '';
                const m = val.match(/^(\d{5})\b/);
                if (!m) continue;
                const code = m[1];
                // Walk up looking for the ancestor that contains the sibling
                // items list (aria-label="X interventions"). This is the "card".
                let el = input.parentElement;
                let itemsWrapper = null;
                let card = null;
                for (let d = 0; d < 12 && el && el !== document.body; d++, el = el.parentElement) {
                    itemsWrapper = el.querySelector(':scope [aria-label$=" interventions"]');
                    if (itemsWrapper) { card = el; break; }
                }
                // The <ul aria-label="X intervention list"> is inside itemsWrapper.
                // It may or may not exist yet (empty sections have no ul).
                const ul = itemsWrapper && itemsWrapper.querySelector('ul[aria-label$=" intervention list"]');
                results.push({
                    code,
                    card,
                    itemsContainer: ul || itemsWrapper,   // fall back to the wrapper if no ul yet
                    format: 'B-edit',
                    itemSelector: ':scope > li[aria-label="Intervention"]',
                    itemNameGetter: (item) => {
                        const inp = item.querySelector('input[aria-label="Intervention name"]');
                        return (inp && (inp.value || inp.getAttribute('value'))) || '';
                    },
                });
            }
            return results;
        }

        /** How many cards on the page have the given code? Used to detect
         *  runaway duplicate-add. Sums across both formats. */
        function countCardsByCode(code) {
            let n = 0;
            for (const rec of getAllProcedureCards()) {
                if (rec.code === code) n++;
            }
            return n;
        }

        function findCardByCode(code) {
            for (const rec of getAllProcedureCards()) {
                if (rec.code === code) return rec;
            }
            return null;
        }

        /** Find the Flowsheet section's header grid row. Anchored to
         *  [data-section="flowsheet"] so it doesn't pick up any of the
         *  other h3 headings on the page (there are 13). */
        function findFlowsheetHeaderRow() {
            const section = document.querySelector('[data-section="flowsheet"]');
            if (!section) return null;
            // The header row is a direct-child grid row. Search 2 levels
            // deep in case there's an intermediate wrapper.
            const row = section.querySelector(
                ':scope > div.tr-grid.tr-w-full.tr-py-2, :scope > div > div.tr-grid.tr-w-full.tr-py-2'
            );
            return row;
        }

        /** Open the +CPT dialog, tick 97112, click "Add 1 CPT code". */
        async function ensureTargetCard() {
            if (findCardByCode(TARGET_CODE)) return true;

            // v14.4: the button's jf-ext-button-ct value is literally
            // "add\ncpt" (a newline separator, because the button text
            // wraps across two source lines). Using an exact-match
            // selector [jf-ext-button-ct="add cpt"] misses this. Use
            // ends-with instead, which also excludes the bottom
            // "add 0 cpt codes" button (ends with "codes"). Fall back to
            // finding a button whose visible text is "CPT" if the attribute
            // ever changes.
            let addCptBtn = document.querySelector('button[jf-ext-button-ct$="cpt"]');
            if (!addCptBtn) {
                // Fallback: find a button whose trimmed textContent equals "CPT"
                for (const b of document.querySelectorAll('button')) {
                    if ((b.textContent || '').trim() === 'CPT') { addCptBtn = b; break; }
                }
            }
            if (!addCptBtn) { log.warn('no +CPT button on the page (tried [jf-ext-button-ct$="cpt"] and text="CPT")'); return false; }
            log.log(`clicking +CPT button to open the dialog (jf-ext-button-ct=${JSON.stringify(addCptBtn.getAttribute('jf-ext-button-ct'))})`);
            simulateClick(addCptBtn, log);

            // v14.5: some MUI buttons ignore synthetic click events (React's
            // onClick handler is wired via delegation and sometimes filters
            // on event.isTrusted). If the dialog doesn't appear quickly,
            // fall back to calling the button's React onClick prop directly
            // by walking its Fiber. Same technique as the disabled v13.1
            // force-edit-mode module.
            let dialog = await waitFor('[role="dialog"]', { log, timeoutMs: 500 });
            if (!dialog) {
                log.warn('dialog did not appear after synthetic click; trying React-fiber onClick fallback');
                const handled = clickViaReactFiber(addCptBtn, log);
                log.log(`React-fiber click handled=${handled}`);
                dialog = await waitFor('[role="dialog"]', { log, timeoutMs: 2500 });
            }
            if (!dialog) { log.warn('CPT dialog never appeared even after fallback'); return false; }

            // Give the option list a beat to render inside the dialog
            await sleep(200);

            // Find the 97112 option by its label text. Options are <li role="option">
            // with a label div containing "97112 · Neuromuscular Reeducation".
            const options = dialog.querySelectorAll('li[role="option"]');
            let targetOption = null;
            for (const opt of options) {
                if ((opt.textContent || '').includes(TARGET_CODE)) {
                    targetOption = opt;
                    break;
                }
            }
            if (!targetOption) {
                log.warn(`no ${TARGET_CODE} option in dialog (found ${options.length} options)`);
                return false;
            }
            const wasSelected = targetOption.getAttribute('aria-selected') === 'true';
            if (!wasSelected) {
                log.log(`clicking ${TARGET_CODE} option to tick its checkbox`);
                simulateClick(targetOption, log);
                await sleep(300);
                // If aria-selected didn't flip, fall back to React fiber onClick.
                if (targetOption.getAttribute('aria-selected') !== 'true') {
                    log.warn('option didn\'t tick after synthetic click; trying React-fiber onClick');
                    clickViaReactFiber(targetOption, log);
                    await sleep(300);
                }
            } else {
                log.log(`${TARGET_CODE} option was already selected`);
            }

            // Click the "Add N CPT code(s)" button (now enabled after tick).
            // The jf-ext-button-ct is "add 0 cpt codes" initially, "add 1 cpt code"
            // after selecting one. Match on the "cpt code" substring.
            const addCodesBtn = dialog.querySelector('button[jf-ext-button-ct*="cpt code"]');
            if (!addCodesBtn) { log.warn('no "Add N CPT code" button in dialog'); return false; }
            if (addCodesBtn.disabled) {
                log.warn(`Add CPT button still disabled (jf-ext-button-ct="${addCodesBtn.getAttribute('jf-ext-button-ct')}") - option may not have been ticked`);
                return false;
            }
            const preAddCount = countCardsByCode(TARGET_CODE);
            log.log(`clicking bottom button: "${addCodesBtn.textContent.trim()}" (${TARGET_CODE} card count BEFORE = ${preAddCount})`);
            simulateClick(addCodesBtn, log);

            // v14.6: strict duplicate-prevention. simulateClick fires both
            // native .click() AND a dispatched MouseEvent, which for the
            // Add button (which DOES respond to synthetic clicks) adds
            // TWO cards. Then the React-fiber fallback fires a 3rd. To
            // prevent this, poll for the card count to change and abort
            // the fallback immediately if any card was added.
            let addedByFirstClick = false;
            for (let i = 0; i < 10; i++) {
                await sleep(100);
                const count = countCardsByCode(TARGET_CODE);
                if (count > preAddCount) {
                    addedByFirstClick = true;
                    log.log(`  synthetic click added ${count - preAddCount} ${TARGET_CODE} card(s) after ${(i+1)*100}ms - skipping fiber fallback`);
                    break;
                }
            }
            if (!addedByFirstClick) {
                log.warn(`Add synthetic click didn't add a card in 1000ms; trying React-fiber onClick`);
                clickViaReactFiber(addCodesBtn, log);
                // Poll again for card appearance
                for (let i = 0; i < 15; i++) {
                    await sleep(200);
                    if (countCardsByCode(TARGET_CODE) > preAddCount) break;
                }
            }
            const finalCount = countCardsByCode(TARGET_CODE);
            log.log(`  post-Add: ${TARGET_CODE} card count = ${finalCount} (was ${preAddCount})`);
            if (finalCount > preAddCount) {
                if (finalCount - preAddCount > 1) {
                    log.warn(`DUPLICATE CARDS: ${finalCount - preAddCount} ${TARGET_CODE} cards were added. You may want to remove the extras manually.`);
                }
                return true;
            }
            log.warn(`${TARGET_CODE} card did not appear after clicking Add`);
            return false;
        }

        /** Full flow: verify MET items exist, ensure 97112 exists (create if
         *  needed), then move all MET items to the top of 97112. */
        async function performFix() {
            log.log('%c=== performFix START ===', 'color: #58c; font-weight: bold;');
            const scope = document.querySelector('[data-section="flowsheet"]');
            log.log(`scope: [data-section="flowsheet"] found=${!!scope}`);
            // Also count the cards OUTSIDE the flowsheet scope for context
            const previewCards = document.querySelectorAll('[data-section="services"] div.tr-rounded-lg.tr-border.tr-border-Shape-OnSurface-Outlines.tr-bg-Surface-Neutral-Lighter-Surface').length;
            if (previewCards > 0) log.log(`  (ignoring ${previewCards} card(s) in the scribe-preview / services section)`);
            const initialCards = getAllProcedureCards();
            log.log(`procedure cards inside flowsheet: ${initialCards.length}`);
            for (const rec of initialCards) {
                const itemCount = rec.itemsContainer
                    ? rec.itemsContainer.querySelectorAll(rec.itemSelector).length
                    : 0;
                log.log(`  card code=${rec.code}, format=${rec.format}, has itemsContainer=${!!rec.itemsContainer}, itemCount=${itemCount}`);
            }

            const source = findCardByCode(SOURCE_CODE);
            if (!source || !source.itemsContainer) {
                log.warn(`no ${SOURCE_CODE} section - aborting`);
                return { moved: 0, reason: 'no 97140 section' };
            }
            log.log(`${SOURCE_CODE} card found (format=${source.format}); scanning items with selector "${source.itemSelector}"`);
            const allItems = Array.from(source.itemsContainer.querySelectorAll(source.itemSelector));
            const metItems = allItems.filter((it) => isMETText(source.itemNameGetter(it)));
            log.log(`  items under ${SOURCE_CODE}: ${allItems.length} total, ${metItems.length} match MET`);
            for (const item of metItems) {
                log.log(`    MET item: "${source.itemNameGetter(item).trim()}"`);
            }
            if (metItems.length === 0) {
                return { moved: 0, reason: 'no MET items under 97140' };
            }

            const preCount = countCardsByCode(TARGET_CODE);
            log.log(`${TARGET_CODE} card count BEFORE ensureTargetCard: ${preCount}`);
            if (preCount === 0) {
                log.log(`no ${TARGET_CODE} section yet - opening +CPT dialog to add it`);
                const ok = await ensureTargetCard();
                log.log(`ensureTargetCard returned: ${ok}`);
                if (!ok) return { moved: 0, reason: 'could not add 97112 section' };
                // Give React a beat to finish mounting the new card
                await sleep(300);
            } else {
                log.log(`${TARGET_CODE} already exists (${preCount} card(s)), skipping dialog dance`);
            }

            const postCount = countCardsByCode(TARGET_CODE);
            log.log(`${TARGET_CODE} card count AFTER ensureTargetCard: ${postCount}`);

            const target = findCardByCode(TARGET_CODE);
            if (!target || !target.itemsContainer) {
                log.warn(`no ${TARGET_CODE} items container after add - can't move`);
                log.warn(`  target found: ${!!target}, itemsContainer: ${!!(target && target.itemsContainer)}, format: ${target && target.format}`);
                return { moved: 0, reason: 'no 97112 items container after add' };
            }
            log.log(`will move ${metItems.length} MET item(s) into target (format=${target.format}, container tag=${target.itemsContainer.tagName})`);

            let moved = 0;
            // Reverse iteration so the FIRST MET item under 97140 ends up
            // at the TOP of 97112 (insertBefore always goes to the front).
            for (const item of metItems.reverse()) {
                const name = source.itemNameGetter(item).trim() || '(unnamed)';
                try {
                    target.itemsContainer.insertBefore(item, target.itemsContainer.firstChild);
                    log.log(`  moved "${name}" -> top of ${TARGET_CODE}`);
                    moved++;
                } catch (err) {
                    log.error(`  failed to move "${name}":`, err);
                }
            }
            log.log('%c=== performFix END: ' + moved + ' moved ===', 'color: #2a7; font-weight: bold;');
            return { moved, reason: 'ok' };
        }

        function injectHeaderButton() {
            if (document.getElementById(HEADER_BTN_ID)) return;
            const row = findFlowsheetHeaderRow();
            if (!row) return;
            const btn = document.createElement('button');
            btn.id = HEADER_BTN_ID;
            btn.type = 'button';
            btn.textContent = 'Fix MET → 97112';
            btn.title = 'Move all Muscle Energy Technique (MET) items from 97140 (Manual Therapy) to the start of 97112 (Neuromuscular Reeducation). Click "Apply Scribe" afterwards to persist.';
            Object.assign(btn.style, {
                justifySelf: 'end',
                alignSelf: 'center',
                marginRight: '12px',
                padding: '4px 10px',
                background: '#c33',
                color: '#fff',
                border: '1px solid #a22',
                borderRadius: '4px',
                font: '500 12px/1.2 system-ui, sans-serif',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
            });
            btn.addEventListener('mouseenter', () => { btn.style.background = '#a22'; });
            btn.addEventListener('mouseleave', () => { btn.style.background = '#c33'; });
            btn.addEventListener('click', async (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                const original = 'Fix MET → 97112';
                btn.disabled = true;
                btn.textContent = 'Working...';
                btn.style.background = '#888';
                try {
                    const result = await performFix();
                    if (result.moved > 0) {
                        btn.textContent = `Moved ${result.moved}`;
                        btn.style.background = '#2a7';
                    } else {
                        btn.textContent = result.reason;
                        btn.style.background = '#888';
                    }
                } catch (err) {
                    log.error('performFix threw:', err);
                    btn.textContent = 'error';
                    btn.style.background = '#888';
                } finally {
                    setTimeout(() => {
                        btn.textContent = original;
                        btn.style.background = '#c33';
                        btn.disabled = false;
                    }, 3000);
                }
            });
            row.appendChild(btn);
            log.log('injected Fix MET header button next to Flowsheet heading');
        }

        injectHeaderButton();
        let pending = null;
        const obs = new MutationObserver(() => {
            if (pending) return;
            pending = setTimeout(() => { pending = null; injectHeaderButton(); }, 250);
        });
        const startObs = () => {
            obs.observe(document.body, { childList: true, subtree: true });
            log.log('MutationObserver attached; will re-inject button if flowsheet section re-mounts');
        };
        if (document.body) startObs();
        else new MutationObserver((_, o) => { if (document.body) { o.disconnect(); startObs(); } })
                .observe(document.documentElement, { childList: true });

        window.__athelasFixMET = performFix;
        window.__athelasListProcedureCards = () => {
            const rows = getAllProcedureCards().map(r => ({
                code: r.code,
                format: r.format,
                hasItemsContainer: !!r.itemsContainer,
                itemsContainerTag: r.itemsContainer ? r.itemsContainer.tagName : '-',
                itemCount: r.itemsContainer
                    ? r.itemsContainer.querySelectorAll(r.itemSelector).length
                    : 0,
            }));
            console.table(rows);
            return rows;
        };
    }


    // =====================================================================
    // Boot: run each module in turn. They're independent.
    // =====================================================================
    applyCompactCss();
    if (isChartNote) {
        featureScrollToFlowsheet();
        // featureFixMisplacedMET();
        // v14 (site rework): the following five modules targeted selectors
        // that no longer exist or behave differently after the Athelas UI
        // update. Kept defined above for reference; disabled in the boot.
        // featureAutofillInterventions();
        // featureFocusInterventionsSearch();
        // featureMinsColumnHelpers();
        // featureMoveToBottom();
        // featureForceEditMode();
        // featureSimpleGridHeight();   // disabled in v12.1 - see "DataGrid compact mode" notes block above
    }
})();
