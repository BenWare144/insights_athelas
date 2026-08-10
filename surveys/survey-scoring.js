// ==================================================================
// Functional-outcome survey scoring + goal-string helpers  (CANONICAL)
// ==================================================================
// Pure logic behind the two initial-note features (survey quick-add panel and
// goal-from-score). No DOM here — the userscript's `Surveys` module mirrors these
// functions and adds the DOM wrappers. Keep the two in sync; surveys-sync.test.js
// compares them. Tested in survey-scoring.test.js.
//
// Scoring conventions were researched (Aug 2026) and split into TWO families:
//   family 'disability' → higher score = WORSE  ("% disability/handicap" is right)
//   family 'function'   → higher score = BETTER (the % is "% of full function")
// Ben's example target "LEFS score of <20 (<30% disability)" is backwards for the
// function-family scales; computeTargetState() is a family-aware STUB until Ben
// delivers the real initial→target mapping.
// ==================================================================

// key     = short label shown on the panel button + used in the goal title
// auto    = exact MUI Autocomplete option text ("Add a functional outcome form")
// section = data-section / "Scores for <section>" name of the rendered survey
//           (matched with trim(); DHI carries a trailing space in the live DOM)
const SURVEYS = [
  { key: 'DHI',              auto: 'Dizziness Handicap Inventory (DHI)',        section: 'Dizziness Handicap Inventory (DHI)',        family: 'disability' },
  { key: 'Modified Oswestry',auto: 'Modified Oswestry',                         section: 'Modified Oswestry',                         family: 'disability' },
  { key: 'NDI',              auto: 'Neck Disability Index [NDI]',               section: 'Neck Disability Index [NDI]',               family: 'disability' },
  { key: 'LEFS',             auto: 'Lower Extremity Functional Scale [LEFS]',   section: 'Lower Extremity Functional Scale [LEFS]',   family: 'function' },
  { key: 'QuickDASH',        auto: 'QuickDASH',                                 section: 'QuickDASH',                                 family: 'disability' },
  { key: 'KOS-ADLS',         auto: 'KOS - Activities of Daily Living',          section: 'KOS - Activities of Daily Living',          family: 'function' },
];

const byKey = (k) => SURVEYS.find((s) => s.key === k) || null;

// Parse a "Scores for X" region's text into { label: number }. Labels seen in the
// live DOM: 'DHI Total Score', 'Total Score', 'Score %', 'Score', 'Emotional Score'…
function parseScoreText(text) {
  const out = {};
  const re = /([A-Za-z][A-Za-z %/]*?)\s*:\s*(-?\d+(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(text || ''))) out[m[1].trim()] = parseFloat(m[2]);
  return out;
}

// Format a number for display: drop a trailing ".0", keep real decimals.
function fmtNum(n) {
  if (n === null || n === undefined || isNaN(n)) return null;
  return Number.isInteger(n) ? String(n) : String(+n.toFixed(1));
}

// Pull the survey's primary metric(s) out of the parsed pairs.
function scoreValues(key, pairs) {
  pairs = pairs || {};
  const pct = pairs['Score %'];
  switch (key) {
    case 'DHI':               return { points: pairs['DHI Total Score'] !== undefined ? pairs['DHI Total Score'] : pairs['Total Score'], max: 100 };
    case 'Modified Oswestry': return { pct };
    case 'NDI':               return { points: pairs['Score'], max: 50, pct };
    case 'LEFS':              return { points: pairs['Score'], max: 80, pct };
    case 'QuickDASH':         return { pct, max: 100 };            // the 0-100 index is labelled "Score %"
    case 'KOS-ADLS':          return { pct: pairs['Total Score'] }; // "Total Score" IS the percent here
    default:                  return {};
  }
}

// Initial-state sentence, family-aware. Returns '' if the needed value is absent.
function initialStateText(key, pairs) {
  const v = scoreValues(key, pairs);
  const P = fmtNum(v.points), C = fmtNum(v.pct);
  switch (key) {
    case 'DHI':               return P === null ? '' : `DHI score of ${P}/100`;
    case 'Modified Oswestry': return C === null ? '' : `Modified Oswestry score of ${C}% disability`;
    case 'NDI':               return (P === null && C === null) ? '' : `NDI score of ${P === null ? '?' : P}/50 (${C === null ? '?' : C}% disability)`;
    case 'LEFS':              return (P === null && C === null) ? '' : `LEFS score of ${P === null ? '?' : P}/80 (${C === null ? '?' : C}% of full function)`;
    case 'QuickDASH':         return C === null ? '' : `QuickDASH score of ${C}/100`;
    case 'KOS-ADLS':          return C === null ? '' : `KOS-ADLS score of ${C}% of full function`;
    default:                  return '';
  }
}

// Goal title = "<panel label> score", e.g. "LEFS score".
const goalTitle = (key) => (byKey(key) ? `${key} score` : '');

// STUB target state — Ben delivers the real initial→target mapping later. Family-
// aware so the placeholder already points the correct direction.
function computeTargetState(key, pairs) {
  const s = byKey(key);
  if (!s) return '';
  const dir = s.family === 'function' ? 'improved function' : 'reduced disability';
  return `Patient will have a ${key} score reflecting ${dir} for improved QOL. [TARGET TBD]`;
}

// Note-type gate: present on initial/eval notes. Default true when we can't read
// the note type (Ben: "if you can't reliably tell, default to being present").
function isInitialEvalValue(v) {
  if (v === null || v === undefined || v === '') return true;
  return /\beval/i.test(v);
}

if (typeof module !== 'undefined') {
  module.exports = { SURVEYS, byKey, parseScoreText, fmtNum, scoreValues, initialStateText, goalTitle, computeTargetState, isInitialEvalValue };
}
