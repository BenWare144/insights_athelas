// ==UserScript==
// @name         Menu Toggle Example
// @namespace    http://tampermonkey.net/
// @version      1.0
// @match        https://insights.athelas.com/v3/appointments*
// @match        https://insights.athelas.com/ehr/calendar*
// @match        https://insights.athelas.com/ehr/v2/patients/*/appointments/*
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function() {
    'use strict';

    // 1. Get saved value or default to false
    let isDarkMode = GM_getValue('darkMode', false);

    // 2. Function to toggle the setting and update the menu
    function toggleDarkMode() {
        isDarkMode = !isDarkMode; // Flip the true/false state
        GM_setValue('darkMode', isDarkMode); // Save it
        alert('Dark mode is now ' + (isDarkMode ? 'ON' : 'OFF'));
        location.reload(); // Reload page to apply changes
    }

    // 3. Register the menu command dynamically
    function registerMenu() {
        let status = isDarkMode ? '✅ ON' : '❌ OFF';
        GM_registerMenuCommand(`Dark Mode: ${status}`, toggleDarkMode);
    }

    registerMenu();
})();