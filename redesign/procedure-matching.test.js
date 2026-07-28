// ---- normalize ----
function norm(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')   // punctuation/hyphens/slashes -> space
    .replace(/\s+/g, ' ')
    .trim();
}
const has = (n, ...toks) => toks.every(t => n.includes(t));
const word = (n, w) => new RegExp(`\\b${w}\\b`).test(n);

// ---- candidate table: label, code, justification (short), test(normName) ----
const TABLE = [
  // ===== 97112 balance/proprioception family (all share one justification) =====
  { label:'Semi Tandem',        code:'97112', just:'gluteMed', test:n => has(n,'tandem') },
  { label:'Tandem stand',       code:'97112', just:'gluteMed', test:n => has(n,'tandem') },
  { label:'Single leg stand',   code:'97112', just:'gluteMed',
    test:n => has(n,'single leg') && (has(n,'stand') || has(n,'stance') || has(n,'balance')) },
  { label:'Airex (+tandem/semi)', code:'97112', just:'gluteMed', test:n => has(n,'airex') },

  // ===== 97112 MET family =====
  { label:'MET (any)',          code:'97112', just:'met', test:n => word(n,'met') || has(n,'muscle energy') },

  // ===== 97530 Therapeutic Activity =====
  { label:'Sit to Stand',       code:'97530', just:'toilet',   test:n => has(n,'sit to stand') },
  { label:'Sit to Supine',      code:'97530', just:'bedxfer',  test:n => has(n,'sit to supine') },
  { label:'Step up',            code:'97530', just:'stairs',   test:n => has(n,'step up') },
  { label:'Step down',          code:'97530', just:'stairs',   test:n => has(n,'step down') },
  { label:'Forward lunges',     code:'97530', just:'squatrec', test:n => has(n,'lunge') && has(n,'forward') },
  { label:'Reverse lunges',     code:'97530', just:'squatrec', test:n => has(n,'lunge') && has(n,'reverse') },
  { label:'Side lunges',        code:'97530', just:'squatrec', test:n => has(n,'lunge') && has(n,'side') },
  { label:'Squat',              code:'97530', just:'squatrec', test:n => has(n,'squat') },
  { label:'Push cable column',  code:'97530', just:'yardwork', test:n => has(n,'cable') && has(n,'push') },
  { label:'Pull cable column',  code:'97530', just:'yardwork', test:n => has(n,'cable') && has(n,'pull') },
  { label:'Matrix',             code:'97530', just:'extremity',test:n => word(n,'matrix') },
  { label:'Bridges',            code:'97530', just:'bedcore',  test:n => word(n,'bridge') || word(n,'bridges') },

  // ===== 97110 Therapeutic Exercise =====
  { label:'PROM',               code:'97110', just:'rom', test:n => word(n,'prom') },
  { label:'passive range of motion', code:'97110', just:'rom',
    test:n => has(n,'passive') && has(n,'range') && has(n,'motion') },
];

// ---- 156 real names harvested from example chart notes ----
const REAL = `_PKB|Adductor Ball Squeeze|Anterior Hip Stretch - Stride Lunge on Steps|Arm Bike|Bicep Curl - Dumbbell|Brachial Plexus Mobilization|Calf Stretch - Off Step|Cervical Lateral Flexion Stretch|Chair squat|Chest Press|Chin Tuck|Corner Stretch - Chest Wall|Doorway Shoulder Stretch with Hip Shifting|Double Leg Leg Press - Machine|Elbow and Forearm Passive Stretch|Fascial Release - CT Junction|Femoral Nerve Flossing|Femoral nerve flossing, prone|Forearm Rotation - Palm Up/Palm Down|FRS Left Thoracic|FRS Right Thoracic|Grip and Hold|Hamstring Stretch-supine|Heel Cone Walkouts|Heel Cord Stretch - Standing|Hip Flexor Stretch - Prone with Strap|Hip Internal Rotation PROM|IASTM - Rhomboids and Middle Traps|Isometric Wall Exercise - Scapular Stabilization|IT Band / Lateral Line Manual Stretch - Left|ITB Stretch with Patellar Stabilization|ITB Stretching - Left|Joint Recoil Technique - Knee|Knee Extension with Weight - Seated Stretch|Knee Flexion Isometrics - Adduction and Abduction|Knee Flexion PROM|Knee Flexion ROM Mobilization - Genu Articularis|Knee to Chest - Bilateral|Lateral step ups|Lateral Step-Ups - 6 inch step|Leg Curl - Bilateral|Leg Curl - Unilateral Left|Leg Curl - Unilateral Right|Leg Extension - Unilateral|Leg Press|Long Arc Quad (LAQ) - AROM|Long Arc Quads|Lower Trunk Rotation|Marching|Marching - Knee Lifts|Median Nerve glides|Median Nerve Glides at the Wrist|MET|MET - 1243543t|MET - 143t41|MET - CT Junction (FRS T1 and T2)|MET - jhgkhjg|MET AC Joint - Hold Relax|MET for posteriorly subluxed rib|MET for posteriorly subluxed rib with IR|MET to Superior Tib-Fib Joint|Mini Squats|Neural mobs brachial plexus|Nu-step (Nustep)|Partial squat|Patellar Mobilization - Left|Patellar Mobilization - Medial Glide|Patellar Mobilizations|Patellar Taping / Strapping|Pec Major Stretch|Piriformis Soft Tissue Mobilization|Piriformis Stretch with Contract-Relax - Left|Piriformis Stretch with Contract-Relax - Right|Postural Correction with Isometric Pull-Down|Prayer stretch|Prone Knee Flexion and Extension|Quad Set with Straight Leg Raise|Resisted Walking|Rib Mobilization|Rib Mobilization - Bilateral|Scalene Stretch|Scalene Stretching|Scapular/Shoulder Girdle Soft Tissue and Joint Mobilization|Sciatic Nerve Flossing - Left|Seated Chin Tuck|Seated Knee Flexion - AAROM|Seated Scapular Retraction with Elbow Pull-Down|Short Arc Quad (SAQ)|Shoulder Abduction-Band|Shoulder Extension-Band|Shoulder Flexion - AAROM, Dowel|Shoulder Flexion-Band|Shoulder Posterior Capsule / Periscapular Mobilization|Shoulder Shrug and Postural Correction|Single Arm Pull|Single-Leg Balance - Left|Single-Leg Heel Raise - Slow Eccentric|Soft Tissue Massage to Wrist and Palm|Squats with Knee Alignment Cueing|Stair knee flexion stretch|Standing Chest Press - Band|Standing Hamstring Curl|Standing Heel Raises-Bilat|Standing Toe Raise|Stationary Bike|Step Stretch - Knee Flexion|Step up|Step-Up with Toe Raise Variation|Step-Ups|Step-Ups with Knee Valgus Correction|Sternoclavicular Joint Mobilization|STM|Straight Leg Raise (SLR)|Straight Leg Raise (SLR) with ER|Subclavius Stretch - Bilateral|Superior Sacral Shear Correction - Left|Supine Heel Slide|Supine Sciatic Nerve Slider|Tandem Stance, eyes open|Terminal Knee Extension (TKE)|Theraband|Theraband Shoulder External Rotation|Theraband Shoulder Internal Rotation|TKE on Cable column|Triceps Stretch|Wall Arm Lifts|Weight-Bearing Wrist Rocking|Wrist Curls|Wrist Extension|Wrist Extension Mobilization|Wrist extension stretch|Wrist flexion|Wrist Flexion and Extension with Weights|Wrist Flexor Stretch|Wrist Joint Mobilization/Manipulation|Wrist Skin and Joint Stretch|Wrist Traction and Distraction|Wrist wand for supination and pronation`.split('|');

function matchAll(name) {
  const n = norm(name);
  return TABLE.filter(e => e.test(n));
}

console.log('===== MATCHES (real name -> canonical, code) =====');
let anyMulti = false;
for (const name of REAL) {
  const ms = matchAll(name);
  if (ms.length === 0) continue;
  const tag = ms.length > 1 ? '  ⚠ MULTI' : '';
  if (ms.length > 1) anyMulti = true;
  console.log(`  "${name}"  ->  ${ms.map(m=>m.label+' ['+m.code+']').join('  ||  ')}${tag}`);
}
console.log('\n===== NAMES THAT MATCH NOTHING (sanity: should be non-canonical) =====');
for (const name of REAL) {
  if (matchAll(name).length === 0) console.log(`  "${name}"`);
}
