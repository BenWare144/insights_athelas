// ==UserScript==
// @name         Athelas Insights - Compact Mode + Chart Note Helpers
// @namespace    https://insights.athelas.com/
// @version      7.2.0
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
        `;

        let css = '';
        if (isAppointments) css = cssAppointments;
        else if (isCalendar) css = cssCalendar;
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
        const flowsheet = await waitFor('[data-section="flowsheet"]', { log });
        if (!flowsheet) { log.warn('flowsheet section never appeared - giving up'); return; }
        await sleep(300); // let React finish painting children so offsetTop stabilizes
        log.log('scrolling flowsheet section into view');
        flowsheet.scrollIntoView({ behavior: 'smooth', block: 'start' });
        await sleep(450);
        log.log('nudging up 64px to clear the sticky app bar');
        window.scrollBy({ top: -64, behavior: 'smooth' });
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

                log.log(`done with "${name}"`);
            } catch (err) {
                log.error('processRow threw:', err);
            } finally {
                console.groupEnd();
            }
        }

        // ---- Baseline + sweep ----

        /** Lock the baseline to whatever rows are currently in the grid. */
        function lockBaseline() {
            if (baselineLocked) return;
            const grid = document.querySelector(SEL.grid);
            if (!grid) return;
            const rows = grid.querySelectorAll(SEL.row);
            baselineIds = new Set(Array.from(rows).map(r => r.getAttribute('data-id')));
            baselineLocked = true;
            log.log(`%cBASELINE LOCKED with ${baselineIds.size} pre-existing rows:`, 'color: #2a7; font-weight: bold;', [...baselineIds]);
            log.log('From this point on, only rows whose data-id is NOT in the baseline will be auto-filled.');
        }

        /** Wait for the grid to "settle": at least one row exists AND row count hasn't
         *  changed for `quietMs`. If the chart note genuinely has 0 rows, wait up to
         *  `maxWaitMs` then lock baseline at 0. */
        function tryLockBaseline(forceImmediate = false) {
            const quietMs = 1500;
            const maxWaitMs = 12000;
            const startedAt = Date.now();
            let lastCount = -1;
            let stableSince = null;

            if (forceImmediate) { lockBaseline(); return; }

            log.log(`watching grid for settle (quiet period ${quietMs}ms, hard cap ${maxWaitMs}ms)...`);
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

                if ((count > 0 && stableFor >= quietMs) ||
                    (elapsedTotal >= maxWaitMs)) {
                    clearInterval(interval);
                    lockBaseline();
                }
            }, 250);
        }

        function sweep() {
            const grid = document.querySelector(SEL.grid);
            if (!grid) { log.log('sweep: grid gone'); return; }

            if (!baselineLocked) {
                log.log('sweep: baseline not locked yet - skipping (waiting for grid to settle)');
                return;
            }

            const rows = Array.from(grid.querySelectorAll(SEL.row));
            const newRows = rows.filter(r => !baselineIds.has(r.getAttribute('data-id')) && !processedIds.has(r.getAttribute('data-id')));

            if (newRows.length === 0) return;
            log.log(`sweep: ${newRows.length} truly-new row(s) detected:`, newRows.map(r => r.getAttribute('data-id')));
            newRows.forEach(processRow);
        }

        // Boot
        (async () => {
            log.log('waiting for MuiDataGrid to appear...');
            const grid = await waitFor(SEL.grid, { log });
            if (!grid) { log.error('grid never appeared - autofill disabled'); return; }
            log.log('grid found. Now waiting for it to settle before locking baseline.');

            tryLockBaseline();

            // Observe a STABLE ancestor of the grid, not the grid itself. The grid
            // element can be swapped out by MUI when modals/popovers open or close,
            // which leaves an observer bound to the grid watching a detached node.
            // The flowsheet section wrapper persists across those re-renders.
            const flowsheet = document.querySelector('[data-section="flowsheet"]') || document.body;
            log.log(`MutationObserver target:`, flowsheet, '(stable ancestor of the grid)');

            let pending = null;
            const obs = new MutationObserver(() => {
                if (pending) return;
                pending = setTimeout(() => { pending = null; sweep(); }, 250);
            });
            obs.observe(flowsheet, { childList: true, subtree: true });
            log.log('MutationObserver attached to flowsheet section.');

            // Belt + suspenders: a low-frequency poll catches anything the observer
            // ever misses (e.g. if MUI swaps the flowsheet wrapper itself, or if a
            // popover transition interferes with mutation delivery).
            const POLL_MS = 1500;
            setInterval(() => sweep(), POLL_MS);
            log.log(`backup poll: re-checking every ${POLL_MS}ms in case of observer misses`);

            log.log('%cDevTools helpers exposed:', 'color: #58c; font-weight: bold;');
            log.log('  window.__athelasResetBaseline()  - re-snapshot baseline (any row not in old baseline becomes "new" again)');
            log.log('  window.__athelasSweep()          - manual sweep right now');
            log.log('  window.__athelasInspectRow(id)   - dump everything we know about row data-id=<id>');
            log.log('  window.__athelasDryRunOn() / Off - simulate fills (log-only) vs really fill');
            log.log('  window.__athelasInterventionData - the lookup table object (mutable from DevTools)');
        })();
    }


    // =====================================================================
    // Boot: run each module in turn. They're independent.
    // =====================================================================
    applyCompactCss();
    if (isChartNote) {
        featureScrollToFlowsheet();
        featureAutofillInterventions();
    }
})();
