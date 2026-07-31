// ==================================================================
// Procedure matching + resolution  (companion data for Fix-Procedures)
// ==================================================================
// Maps the messy procedure names the AI scribe produces onto the therapist's
// canonical rules (Stuff for EMR.xlsx + therapist markup on procedure-audit.md).
//
// resolveProcedure(name) -> null  (no rule; leave alone)
//                         | { label, code, justification, justMode, rename?, exclude? }
//   code        target CPT the item belongs under ('97110'|'97112'|'97530')
//   justMode    'replace' (MET) | 'append' (has canonical text) | 'none' (move only)
//   justification  text to write (null when justMode==='none' or MET-name-spliced)
//   rename      if present, the item's name should be changed to this first
//   exclude     true => explicitly leave alone (don't move/justify)
//
// PRECEDENCE: first matching rule wins. Order below is deliberate
// (e.g. cable-column before TKE-exclude; lunge before stretch).
// Tested against 141 real (section,name) pairs — see procedure-matching.test.js.
// ==================================================================

function normProc(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const _has = (n, ...toks) => toks.every((t) => n.includes(t));
const _word = (n, w) => new RegExp(`\\b${w}\\b`).test(n);

// Canonical justification texts still present in the xlsx.
const J = {
  toilet:    'Improve toilet transfers',
  bedxfer:   'Improved transfers on and off the bed',
  stairs:    'Improve stair climbing ability',
  squatrec:  'Improve ablity to squat and recover',   // (xlsx spelling kept verbatim)
  yardwork:  'Functional training for yard/house work',
  extremity: 'To restore normal function of extremity',
  bedcore:   'To assist with bed mobility and assist with core stabilty during functional tasks',
  gluteMed:  'Verbal and tactile cues to glute med for upright posture',
  rom:       'To assist with pain free range of motion and restore normal function',
};

// ---- MET helpers ----------------------------------------------------------
// Junk/test MET names (e.g. "MET - jhgkhjg", "MET - 1243543t"): IGNORE them.
// Junk = the descriptor after MET is a single token that has a digit or no vowel.
function metDescriptor(name) {
  let x = (name || '').trim();
  x = x.replace(/^\s*muscle\s*energy\s*technique\s*(\(met\))?\s*[:\-]?\s*/i, ''); // spelled-out prefix (+ optional "(MET)")
  x = x.replace(/^\s*met\b[\s:\-]*/i, '');                                        // abbreviated prefix
  x = x.replace(/^[\s\-:()]+|[\s\-:()]+$/g, '').trim();                           // trim stray wrapping punctuation
  return x;
}
function isJunkMET(name) {
  const x = metDescriptor(name);
  if (!x) return false;                       // bare "MET" is valid
  if (/\s/.test(x)) return false;             // multi-word => real
  return /\d/.test(x) || !/[aeiou]/i.test(x); // single token: digit or no vowel => junk
}
// Robust "MET - X" justification. Preserves the connector (to/for/…),
// defaults to "to" when the name has none.
function metJustification(name) {
  const tail = 'with tactile and vc to help facilitate proper proprioception and posture.';
  const rest = metDescriptor(name);
  if (!rest) return `Muscle energy technique applied, ${tail}`;
  const hasConnector = /^(to|for|at|of|on|in|with|toward|towards)\b/i.test(rest);
  const phrase = hasConnector ? rest : `to ${rest}`;
  return `Muscle energy technique applied ${phrase}, ${tail}`;
}

// ---- rule table (first match wins) ----------------------------------------
const RULES = [
  // 1. Anything "cable column" -> Therapeutic Activity (catches "TKE on Cable column"
  //    too; must beat the TKE-exclude and stretch rules below).
  { label: 'Cable column',   code: '97530', just: J.yardwork, justMode: 'append',
    test: (n) => _has(n, 'cable column') },

  // 2. Terminal Knee Extension (standalone) -> ambiguous, LEAVE ALONE.
  { label: 'TKE (leave alone)', exclude: true,
    test: (n) => _word(n, 'tke') || _has(n, 'terminal knee extension') },

  // 3. BRIDGES — DISABLED / UNDER REVIEW (therapist to clarify in a prompt).
  //    The old rule sent anything with "bridge" to 97530, but most bridges are
  //    strengthening exercises (usually 97110). Until that is settled we LEAVE
  //    bridge items ALONE (do not move). Placed high so bridge compounds
  //    ("Hamstring Curl to Bridge", "Shoulder Extension Bridge",
  //    "Straight Leg Raise ... Bridge Position") are left alone too — the
  //    therapist explicitly marked those "Leave Alone". See BRIDGES-review.md.
  { label: 'Bridges (under review — left alone)', exclude: true,
    test: (n) => _word(n, 'bridge') || _word(n, 'bridges') },

  // 4. Compound "... to single leg balance" cases. The therapist's per-item
  //    answers (matching-duplicates.md): a curtsey STEP into a balance is left
  //    alone; an anterior STEP into a balance is a Therapeutic Activity (97530);
  //    every other single-leg-balance ending (all the lunges, lateral/posterior
  //    steps) is Neuromuscular Reeducation (97112). These must beat Lunge/Step,
  //    so they sit above those rules.
  { label: 'Curtsey step → balance (leave alone)', exclude: true,
    test: (n) => _has(n, 'curtsey') && _has(n, 'step') && _has(n, 'single leg balance') },
  { label: 'Anterior step → balance (97530)', code: '97530', justMode: 'none',
    test: (n) => _has(n, 'anterior') && _has(n, 'step') && _has(n, 'single leg balance') },

  // 5. Rib Mobilization -> RENAME to "MET - Rib" and treat as MET.
  //    Exclude "first rib" — the therapist says "First Rib Mobilization - Strap"
  //    must NOT be treated as MET.
  { label: 'Rib -> MET - Rib', code: '97112', justMode: 'replace', met: true, rename: 'MET - Rib',
    test: (n) => _has(n, 'rib mobilization') && !_has(n, 'first rib') },

  // 6. MET family -> 97112, name-spliced justification (replace). Junk names ignored.
  { label: 'MET', code: '97112', justMode: 'replace', met: true,
    test: (n) => (_word(n, 'met') || _has(n, 'muscle energy')) },

  // 7. Balance family -> 97112 (glute-med justification). Broadened per therapist:
  //    any "balance" or "bosu" counts (tandem / airex / single-leg-balance / Y-balance /
  //    feet-together / in-line / BOSU work). Placed ABOVE Lunge/Step so a
  //    "... to single leg balance" ending wins (their answer for the lunge cases).
  { label: 'Balance', code: '97112', just: J.gluteMed, justMode: 'append',
    test: (n) => _has(n, 'tandem') || _has(n, 'airex') || _has(n, 'bosu') || _has(n, 'balance') },

  // 7b. Lunge Hip Flexion Stretch -> Therapeutic Exercise (97110). The therapist
  //     marked this specific item 97110 (it's a stretch). Must beat the blanket
  //     Lunge rule below. Note: only "hip flexion stretch" — "Anterior Hip Stretch -
  //     Stride Lunge on Steps" stays 97530 (that's a hip stretch, not hip-flexion).
  { label: 'Lunge Hip Flexion Stretch', code: '97110', justMode: 'none',
    test: (n) => _has(n, 'lunge') && _has(n, 'hip flexion stretch') },

  // 8. Any Lunge -> Therapeutic Activity (before stretch, so a "…Stretch … Lunge…" is a lunge).
  { label: 'Lunge', code: '97530', just: J.squatrec, justMode: 'append',
    test: (n) => _has(n, 'lunge') },

  // 9-14. Therapeutic Activity specifics
  { label: 'Squat',         code: '97530', just: J.squatrec, justMode: 'append', test: (n) => _has(n, 'squat') || _has(n, 'wall sit') },
  { label: 'Step up',       code: '97530', just: J.stairs,   justMode: 'append', test: (n) => _has(n, 'step up') },
  { label: 'Step down',     code: '97530', just: J.stairs,   justMode: 'append', test: (n) => _has(n, 'step down') },
  { label: 'Sit to Stand',  code: '97530', just: J.toilet,   justMode: 'append', test: (n) => _has(n, 'sit to stand') },
  { label: 'Sit to Supine', code: '97530', just: J.bedxfer,  justMode: 'append', test: (n) => _has(n, 'sit to supine') },
  { label: 'Matrix',        code: '97530', just: J.extremity,justMode: 'append', test: (n) => _word(n, 'matrix') },

  // 15. Any Curl -> Therapeutic Exercise (move only; no canonical text).
  { label: 'Curl', code: '97110', justMode: 'none', test: (n) => _has(n, 'curl') },

  // 16. PROM / passive ROM -> Therapeutic Exercise (append canonical text).
  { label: 'PROM', code: '97110', just: J.rom, justMode: 'append',
    test: (n) => _word(n, 'prom') || (_has(n, 'passive') && _has(n, 'range') && _has(n, 'motion')) },

  // 17. Specific therapist-flagged 97110 items (move only).
  { label: 'Long Arc Quad',      code: '97110', justMode: 'none', test: (n) => _has(n, 'long arc quad') || _word(n, 'laq') },
  { label: 'Short Arc Quad',     code: '97110', justMode: 'none', test: (n) => _has(n, 'short arc quad') || _word(n, 'saq') },
  { label: 'Genu Articularis',   code: '97110', justMode: 'none', test: (n) => _has(n, 'genu articularis') },
  { label: 'Scapular Retraction',code: '97110', justMode: 'none', test: (n) => _has(n, 'scapular retraction') },
  { label: 'Straight Leg Raise', code: '97110', justMode: 'none', test: (n) => _has(n, 'straight leg raise') || _word(n, 'slr') },
  { label: 'Shoulder Abduction', code: '97110', justMode: 'none', test: (n) => _has(n, 'shoulder abduction') },
  // Shoulder Extension: the therapist said D2 / posterior-sling / split-squat /
  // step-up variants should NOT be treated as a shoulder-extension exercise.
  { label: 'Shoulder Extension', code: '97110', justMode: 'none',
    test: (n) => _has(n, 'shoulder extension') && !_has(n, 'd2') && !_has(n, 'split squat')
      && !_has(n, 'step up') && !_has(n, 'posterior sling') && !_has(n, 'plank') },

  // 18. Any Stretch -> Therapeutic Exercise (move only), EXCEPT "hip shifting" (leave alone).
  { label: 'Stretch', code: '97110', justMode: 'none',
    test: (n) => _has(n, 'stretch') && !_has(n, 'hip shifting') },
];

function resolveProcedure(name) {
  const n = normProc(name);
  for (const r of RULES) {
    if (!r.test(n)) continue;
    if (r.exclude) return { label: r.label, exclude: true };
    if (r.met && isJunkMET(name)) return null;   // junk MET => leave alone (unmatched)
    // MET (and Rib->"MET - Rib") splice the justification from the FINAL name.
    const finalName = r.rename || name;
    const justification = r.met ? metJustification(finalName) : (r.just || null);
    return {
      label: r.label,
      code: r.code,
      justification,
      justMode: r.justMode,
      rename: r.rename || null,
    };
  }
  return null;
}

if (typeof module !== 'undefined') {
  module.exports = { normProc, resolveProcedure, metJustification, isJunkMET, RULES, J };
}
