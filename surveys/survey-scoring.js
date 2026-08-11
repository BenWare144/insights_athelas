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
    case 'Modified Oswestry': return { points: pairs['Score'], max: 50, pct };
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
    case 'DHI':               return P === null ? '' : `DHI total score of ${P}/100`;
    case 'Modified Oswestry': return (P === null && C === null) ? '' : `Modified Oswestry score of ${P === null ? '?' : P}/50 (${C === null ? '?' : C}% disability)`;
    case 'NDI':               return (P === null && C === null) ? '' : `NDI score of ${P === null ? '?' : P}/50 (${C === null ? '?' : C}% disability)`;
    case 'LEFS':              return (P === null && C === null) ? '' : `LEFS score of ${P === null ? '?' : P}/80 (${C === null ? '?' : C}% of full function)`;
    case 'QuickDASH':         return C === null ? '' : `QuickDASH score of ${C}/100`;
    case 'KOS-ADLS':          return C === null ? '' : `KOS-ADLS score of ${C}% of full function`;
    default:                  return '';
  }
}

// Goal title = "<panel label> score", e.g. "LEFS score".
const goalTitle = (key) => (byKey(key) ? `${key} score` : '');

// ---- target-state mapping (therapist "vibe" tables, delivered Aug 2026) --------
// Each survey looks up its driving metric in a table -> a target token (may carry
// a leading < or >), then renders a display sentence in that survey's units.
// Directions/units are the therapist's; KOS keys on raw /70 converted from the
// displayed %, per Ben's decision (min-change = 10 pts).

// The metric each table is keyed on.
function targetLookupValue(key, pairs) {
  const v = scoreValues(key, pairs);
  switch (key) {
    case 'QuickDASH':         return v.pct;                                   // % score 0-100 (lower better)
    case 'LEFS':              return v.points;                               // raw /80 (higher better)
    case 'Modified Oswestry': return v.points;                               // raw /50 (lower better)
    case 'NDI':               return v.points;                               // raw /50 (lower better)
    case 'DHI':               return v.points;                               // total score /100 (lower better)
    case 'KOS-ADLS':          return v.pct === undefined || v.pct === null ? null : v.pct * 0.7; // % -> raw /70 (higher better)
    default:                  return null;
  }
}

// Table lookup -> target token.
function targetToken(key, v) {
  switch (key) {
    case 'QuickDASH':         return v >= 28 ? '<20' : v >= 18 ? '<10' : '<5';
    case 'LEFS':              return v >= 62 ? '79' : v >= 52 ? '70' : '>60';
    case 'Modified Oswestry':
    case 'NDI':               return v >= 40 ? '30' : v >= 30 ? '20' : v >= 20 ? '10' : v >= 10 ? '5' : '0';
    case 'DHI':               return v >= 54 ? '34' : v >= 36 ? '16' : '<6';
    case 'KOS-ADLS':          return v >= 65 ? '70' : v >= 50 ? '>68' : v >= 40 ? '>60' : '>50';
    default:                  return '';
  }
}

// Convert a numeric token ("70", ">60", "<6") to a percentage token on `max`,
// keeping the comparator. e.g. (">60", 80) -> ">75"; (">60", 70) -> ">86".
function tokenPct(tok, max) {
  const m = /^([<>]?)(\d+(?:\.\d+)?)$/.exec(tok);
  if (!m) return tok;
  return m[1] + Math.round((parseFloat(m[2]) / max) * 100);
}

// Render the target metric phrase per survey's display convention.
function targetPhrase(key, T) {
  switch (key) {
    case 'QuickDASH':         return `QuickDASH score of ${T}/100`;
    case 'DHI':               return `DHI total score of ${T}/100`;
    case 'LEFS':              return `LEFS score of ${T}/80 (${tokenPct(T, 80)}% of full function)`;
    case 'Modified Oswestry': return `Modified Oswestry score of ${T}/50 (${tokenPct(T, 50)}% disability)`;
    case 'NDI':               return `NDI score of ${T}/50 (${tokenPct(T, 50)}% disability)`;
    case 'KOS-ADLS':          return `KOS-ADLS score of ${tokenPct(T, 70)}% of full function`;
    default:                  return '';
  }
}

// Full target-state sentence, or '' when the survey isn't scored yet.
function computeTargetState(key, pairs) {
  if (!byKey(key)) return '';
  const v = targetLookupValue(key, pairs);
  if (v === null || v === undefined || isNaN(v)) return '';
  const T = targetToken(key, v);
  if (!T) return '';
  return `Patient will have a ${targetPhrase(key, T)} for improved QOL.`;
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
