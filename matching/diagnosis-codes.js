// ==================================================================
// ICD-10 diagnosis-code helpers  (companion data for Fix Diagnosis)
// ==================================================================
// Canonical, exported, tested copy of the 7th-character logic. The userscript
// mirrors these three one-liners inside its `Dx` engine (which also owns the
// DOM work); tests/table-sync.test.js fails if they drift. Change this file
// first, then mirror — same rule as matching/procedure-matching.js.
//
// ICD-10 chapter-19 injury codes (the S/T block) are SEVEN characters, and the
// seventh is the episode-of-care indicator:
//     A = initial encounter
//     D = subsequent encounter (routine healing)  <- what a follow-up visit needs
//     S = sequela
// (Fracture codes use a wider set — B/C/E/F/G/H/J/K/M/N/P/Q for open/delayed/
// nonunion/malunion variants — but only A/D/S matter here.)
//
// The AI scribe carries the initial diagnosis forward, so follow-up notes keep
// arriving with the sequela "S". Billing a sequela code on a routine follow-up
// is a denial, so Fix Diagnosis rewrites the 7th character S -> D. Codes that
// are not seven characters have no episode indicator and are left alone.
// ==================================================================

// Code without its decimal point, upper-cased. "S52.301S" -> "S52301S"
const bare = (code) => String(code || '').replace(/\./g, '').toUpperCase();

// The 7th-character episode indicator, or '' when the code doesn't have one.
const episode = (code) => { const b = bare(code); return b.length === 7 ? b[6] : ''; };

// The subsequent-encounter form of a sequela code, else null.
const subsequentOf = (code) => (episode(code) === 'S' ? String(code).slice(0, -1) + 'D' : null);

if (typeof module !== 'undefined') {
  module.exports = { bare, episode, subsequentOf };
}
