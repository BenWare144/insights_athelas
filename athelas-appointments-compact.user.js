// ==UserScript==
// @name         Athelas Insights - Compact Mode + Chart Note Helpers
// @namespace    https://insights.athelas.com/
// @version      5.0.0
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
            const obs = new MutationObserver(() => {
                const el = root.querySelector(selector);
                if (el) {
                    obs.disconnect();
                    log && log.log(`waitFor("${selector}") -> resolved`);
                    resolve(el);
                }
            });
            obs.observe(root === document ? document.documentElement : root, { childList: true, subtree: true });
            setTimeout(() => {
                obs.disconnect();
                log && log.warn(`waitFor("${selector}") -> TIMEOUT`);
                resolve(null);
            }, timeoutMs);
        });
    }

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    /** Click via a dispatched MouseEvent with simulated=true (same pattern as Ben's Hippo
     *  script). Falls back to native .click() if dispatch returns false. */
    function simulateClick(el, log) {
        if (!el) { log && log.warn('simulateClick: element is null'); return false; }
        try {
            const ev = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
            ev.simulated = true; // React15 used this; harmless otherwise
            const dispatched = el.dispatchEvent(ev);
            log && log.log(`simulateClick: dispatched MouseEvent -> defaultPrevented=${ev.defaultPrevented}, dispatched=${dispatched}`, el);
            // Belt + suspenders: also call native .click() for elements that only listen to click().
            if (typeof el.click === 'function') {
                el.click();
                log && log.log('simulateClick: native .click() also called');
            }
            return true;
        } catch (err) {
            log && log.error('simulateClick: threw', err);
            return false;
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

    /** Toggle an MUI Checkbox to a target state. MUI checkbox = the visible button +
     *  the hidden <input type="checkbox"> sibling that holds the real state. Either
     *  is clickable but the <input> is the most predictable target. */
    function ensureChecked(input, shouldBeChecked, log) {
        if (!input) { log && log.warn('ensureChecked: input is null'); return false; }
        const before = !!input.checked;
        if (before === !!shouldBeChecked) {
            log && log.log(`ensureChecked: already ${shouldBeChecked}, no action`);
            return true;
        }
        log && log.log(`ensureChecked: ${before} -> ${shouldBeChecked}, clicking`);
        simulateClick(input, log);
        log && log.log(`ensureChecked: state after click = ${input.checked}`);
        return input.checked === !!shouldBeChecked;
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
        log.log('module booted, version 5.0.0');

        // ---- Lookup data. Replace with real data once CSV is finalized. ----
        // Keys are matched against the intervention's visible name text
        // (e.g. "Prone Crawl", "FRS: Resisted hip flexion").
        const interventionData = {
            // ---- TEMPLATE EXAMPLES ----
            "Prone Crawl": {
                justification: "improve coordination of muscles and ROM of the hip",
                procedureNumber: "97110"
            },
            "FRS: Resisted hip flexion": {
                justification: "Patient demonstrates 3+/5 strength with decreased neuromuscular control during functional hip flexion. Resisted hip flexion exercises to improve strength and motor control for gait and stair negotiation.",
                procedureNumber: "97110"
            },
            "FRS: Standing balance with perturbation": {
                justification: "Pt presents with impaired static and dynamic standing balance, increasing fall risk. Perturbation training targets reactive postural control.",
                procedureNumber: "97112"
            },
            // ---- end TEMPLATE EXAMPLES ----
        };
        log.log(`interventionData has ${Object.keys(interventionData).length} entries:`, Object.keys(interventionData));

        // Selectors derived from real Example_Chart_Note_expanded.mhtml DOM:
        const SEL = {
            // MUI DataGrid root - presence indicates we're in the right area.
            grid: '.MuiDataGrid-root',
            // A single intervention row.
            row: '.MuiDataGrid-row[data-id]',
            // Expand toggle - first cell of each row.
            expandToggle: 'button.MuiDataGrid-detailPanelToggleCell',
            // intervention_name cell -> the visible name span has title="<name>"
            nameSpan: '[data-field="intervention_name"] span[title]',
            // Done checkbox (aria-label is "<Name> done state")
            doneCheckbox: 'input[type="checkbox"][aria-label$=" done state"]',
            // Detail panel sibling that appears after the row when expanded.
            detailPanel: '.MuiDataGrid-detailPanel',
            // Justification textarea inside the detail panel.
            justificationTextarea: 'textarea[placeholder="Add justification"]',
            // Procedure Autocomplete input inside the detail panel.
            procedureInput: 'input[aria-label="Procedure"]',
        };
        log.log('selector map:', SEL);

        // State: rows we've processed (by data-id), and the baseline that existed at boot.
        const processedIds = new Set();
        let baselineIds = null; // null until first grid sweep

        /** Find the detail panel associated with a given row. MUI DataGrid renders
         *  detail panels in a separate container, but they share the row's data-id
         *  on the wrapper. Otherwise we fall back to "next .MuiDataGrid-detailPanel
         *  in document order whose offsetTop is just below the row". */
        function findDetailPanel(row) {
            // Preferred: any descendant or sibling with same data-id
            const id = row.getAttribute('data-id');
            const byId = document.querySelector(`.MuiDataGrid-detailPanel[data-id="${id}"]`);
            if (byId) { log.log(`detail panel found by data-id="${id}"`, byId); return byId; }
            // Fallback: nearest detailPanel after this row in the DOM
            let n = row.nextElementSibling;
            while (n) {
                if (n.matches && n.matches(SEL.detailPanel)) { log.log('detail panel found via nextElementSibling fallback', n); return n; }
                n = n.nextElementSibling;
            }
            // Final fallback: any detail panel whose top is within ~10px below row's bottom
            const rect = row.getBoundingClientRect();
            const candidates = document.querySelectorAll(SEL.detailPanel);
            for (const c of candidates) {
                const cr = c.getBoundingClientRect();
                if (Math.abs(cr.top - rect.bottom) < 20) { log.log('detail panel found via geometry fallback', c); return c; }
            }
            log.warn(`no detail panel found for row data-id="${id}"`);
            return null;
        }

        /** Read the visible intervention name from a row. */
        function getRowName(row) {
            const span = row.querySelector(SEL.nameSpan);
            if (span) {
                const t = (span.getAttribute('title') || span.textContent || '').trim();
                if (t) return t;
            }
            // Fallback: the aria-label on the wrapper "Prone Crawl name"
            const wrapper = row.querySelector('[aria-label$=" name"]');
            if (wrapper) {
                const t = wrapper.getAttribute('aria-label').replace(/\s+name$/, '').trim();
                if (t) return t;
            }
            return null;
        }

        /** Expand a row's detail panel if not already expanded. */
        async function expandRow(row) {
            const toggle = row.querySelector(SEL.expandToggle);
            if (!toggle) { log.warn('expandRow: no expand toggle found', row); return false; }
            const expanded = toggle.classList.contains('MuiDataGrid-detailPanelToggleCell--expanded')
                          || toggle.getAttribute('aria-label') === 'Collapse';
            log.log(`expandRow: toggle found, currently expanded=${expanded}, aria-label="${toggle.getAttribute('aria-label')}"`);
            if (!expanded) {
                simulateClick(toggle, log);
                // Let MUI render the detail panel
                await sleep(400);
            } else {
                log.log('expandRow: already expanded, skipping click');
            }
            return true;
        }

        /** Fill the justification field. The chart note uses a regular <textarea>
         *  with placeholder="Add justification". If a future change swaps in a
         *  Tiptap editor here we'd branch on isContentEditable. */
        function fillJustification(detailPanel, value) {
            const ta = detailPanel.querySelector(SEL.justificationTextarea);
            if (!ta) {
                log.warn('fillJustification: textarea not found. Looking for any textarea in panel:');
                const all = detailPanel.querySelectorAll('textarea');
                all.forEach((t, i) => log.log(`  textarea[${i}]: placeholder="${t.placeholder}", aria-label="${t.getAttribute('aria-label')}", id=${t.id}`));
                return false;
            }
            log.log('fillJustification: textarea found, setting value');
            return setReactValue(ta, value, log);
        }

        /** Fill the Procedure Autocomplete. */
        async function fillProcedure(detailPanel, value) {
            const input = detailPanel.querySelector(SEL.procedureInput);
            if (!input) {
                log.warn('fillProcedure: input not found. Listing all inputs in panel for debug:');
                detailPanel.querySelectorAll('input').forEach((el, i) => log.log(`  input[${i}]: aria-label="${el.getAttribute('aria-label')}", role="${el.getAttribute('role')}", type="${el.type}"`));
                return false;
            }
            log.log(`fillProcedure: input found, current value="${input.value}", setting to "${value}"`);
            const ok = setReactValue(input, value, log);
            // MUI Autocomplete may need the dropdown to open + an option click to
            // commit the selection. Try opening the popup and clicking a matching
            // option; if there's no popup (freeSolo), just leave the typed value.
            await sleep(200);
            const popup = document.querySelector('.MuiAutocomplete-popper[role="presentation"], .MuiAutocomplete-popper');
            if (popup) {
                log.log('fillProcedure: autocomplete popup detected');
                const options = popup.querySelectorAll('li[role="option"]');
                log.log(`fillProcedure: popup has ${options.length} options`);
                // Find option whose visible text equals our value (procedure code)
                const match = Array.from(options).find((o) => o.textContent.trim().startsWith(value) || o.textContent.trim().includes(value));
                if (match) {
                    log.log('fillProcedure: clicking matching option', match);
                    simulateClick(match, log);
                } else {
                    log.warn(`fillProcedure: no matching option for "${value}" - leaving typed value as freeSolo`);
                }
            } else {
                log.log('fillProcedure: no popup appeared (input may be freeSolo or already committed)');
            }
            return ok;
        }

        /** Check the Done checkbox on the row's header. */
        function tickDone(row) {
            const cb = row.querySelector(SEL.doneCheckbox);
            if (!cb) { log.warn('tickDone: no done checkbox in row', row); return false; }
            log.log(`tickDone: checkbox found, currently checked=${cb.checked}, aria-label="${cb.getAttribute('aria-label')}"`);
            return ensureChecked(cb, true, log);
        }

        /** Run the 5-step procedure for a single row. */
        async function processRow(row) {
            const id = row.getAttribute('data-id');
            if (processedIds.has(id)) { log.log(`processRow: id=${id} already processed, skipping`); return; }
            processedIds.add(id);

            log.group(`processing row data-id=${id}`);
            try {
                // Step 0: identify the row
                const name = getRowName(row);
                if (!name) { log.warn('processRow: could not read intervention name yet, will retry next mutation'); processedIds.delete(id); log.groupEnd(); return; }
                log.log(`name="${name}"`);

                const entry = interventionData[name];
                if (!entry) {
                    log.warn(`no data entry for "${name}" - skipping all 5 steps. Available keys:`, Object.keys(interventionData));
                    log.groupEnd();
                    return;
                }
                log.log(`data entry:`, entry);

                // Step 1: scroll into view
                log.log('[step 1/5] scrollIntoView');
                row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                await sleep(300);

                // Step 2: expand
                log.log('[step 2/5] expand row');
                await expandRow(row);

                const panel = findDetailPanel(row);
                if (!panel) {
                    log.error('detail panel not found after expand - cannot fill justification/procedure');
                    log.groupEnd();
                    return;
                }

                // Step 3: justification
                log.log('[step 3/5] fill justification');
                const ok3 = fillJustification(panel, entry.justification);
                log.log(`[step 3/5] result: ${ok3 ? 'OK' : 'FAILED'}`);

                // Step 4: procedure
                log.log('[step 4/5] fill procedure');
                const ok4 = await fillProcedure(panel, entry.procedureNumber);
                log.log(`[step 4/5] result: ${ok4 ? 'OK' : 'FAILED'}`);

                // Step 5: check Done
                log.log('[step 5/5] tick Done checkbox');
                const ok5 = tickDone(row);
                log.log(`[step 5/5] result: ${ok5 ? 'OK' : 'FAILED'}`);

                log.log(`processRow complete for "${name}"`);
            } catch (err) {
                log.error('processRow threw:', err);
            } finally {
                log.groupEnd();
            }
        }

        /** Sweep the grid: process any row whose data-id is not in the baseline. */
        function sweep() {
            const grid = document.querySelector(SEL.grid);
            if (!grid) { log.log('sweep: no grid yet'); return; }
            const rows = grid.querySelectorAll(SEL.row);
            const ids = Array.from(rows).map((r) => r.getAttribute('data-id'));

            if (baselineIds === null) {
                baselineIds = new Set(ids);
                log.log(`sweep: baseline established with ${baselineIds.size} rows:`, [...baselineIds]);
                return; // don't process the baseline rows
            }

            const newRows = Array.from(rows).filter((r) => !baselineIds.has(r.getAttribute('data-id')));
            if (newRows.length === 0) { log.log(`sweep: no new rows (baseline=${baselineIds.size}, current=${rows.length})`); return; }
            log.log(`sweep: ${newRows.length} new row(s) detected`);
            newRows.forEach((r) => processRow(r));
        }

        // Boot: wait for the grid, then watch it.
        (async () => {
            log.log('waiting for MuiDataGrid to appear in DOM...');
            const grid = await waitFor(SEL.grid, { log });
            if (!grid) { log.warn('grid never appeared - autofill disabled'); return; }
            log.log('grid found, doing baseline sweep');
            sweep(); // establishes baseline

            let pending = null;
            const obs = new MutationObserver((muts) => {
                if (pending) return;
                pending = setTimeout(() => {
                    pending = null;
                    log.log(`MutationObserver fired (${muts.length} mutation records), running sweep`);
                    sweep();
                }, 250);
            });
            obs.observe(grid, { childList: true, subtree: true });
            log.log('MutationObserver attached to grid; listening for new rows.');
        })();

        // Manual triggers for DevTools:
        window.__athelasResetBaseline = () => {
            log.log('manually resetting baseline - next sweep will process EVERY row');
            baselineIds = null;
            processedIds.clear();
        };
        window.__athelasSweep = () => sweep();
        window.__athelasInterventionData = interventionData;
        log.log('exposed window.__athelasResetBaseline(), __athelasSweep(), __athelasInterventionData');
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
