# HANDOFF.md — bring-up-to-speed

Start here, then `AGENTS.md` (how to work in the repo) and `DECISIONS.md` (why things are the way they are + problems already solved). `CHANGELOG.md` has the per-version history.

## What this project is

A browser add-on that automates chart-note busywork in **Athelas Insights** (a physical-therapy EHR at insights.athelas.com). It ships as a **Tampermonkey userscript** (source of truth) and a generated **Chrome MV3 extension** (same code, MAIN world). Its headline value: the AI scribe files interventions under the wrong CPT code, and this tool moves each to the right code (97110/97112/97530) with the correct justification in one click — plus survey/goal helpers on initial evals, calendar shortcuts, and a settings panel to toggle features. It collects/transmits no data and runs only on Athelas.

## Who's who

(This repo is public — keep third-party names/emails out of committed files.)

- **Ben** — the developer (handing off to his Claude Code). Commits as `BenWare144 <bwarex@gmail.com>`; he does the GitHub pushes and Web Store uploads.
- **Cheri Ware, DPT** — Ben's mom; the original user, trading as **Lake Region Consulting** (the Web Store publisher). The tool is currently customized to her.
- **The clinic** evaluating a wider rollout — a compliance director there is test-driving it, with another stakeholder involved. Their internal evaluation email thread (the source of the requests below) is held by Ben, not committed here.

## Where it's at (Aug 2026)

- **Version `15.21.2`**, 24/24 tests green. Latest local commit `9fd1e7d`. All commits are LOCAL — Ben pushes.
- **Live features:** Fix Procedures, Fix Private Pay, functional-outcome survey quick-add + status button + goal-from-score (initial-eval notes), calendar Open Note + popup clamp, jump-to-Flowsheet, compact layout, and the Extension Settings toggle panel.
- **Shelved:** calendar auto Day→Week (misbehaves; code kept, not called).
- **Deployment:** userscript is live on Cheri's machine (auto-updates from a local `file://` build via `npm run build:local` + Tampermonkey "Check for updates"). The extension is unlisted on the Web Store (item ID `lnacagncbpglinobghcdeadaodonpjdf`) for eventual clinic force-install. The last submission was **rejected for keyword spam** (survey acronym list in the description); that's fixed in `deploy/store-listing.md` — needs a resubmit (upload current zip + paste corrected description; no appeal needed). Email archived in `deploy/store-review/`.
- **Everything a new agent needs is in-repo** (this file, AGENTS.md, DECISIONS.md, CHANGELOG.md, DEPLOYMENT.md) — the previous work happened in Claude "cowork" whose separate memory does NOT travel to Claude Code, so these docs are the source of truth.

## Current work / what's next — the Choice Therapy email requests (PRE-PLAN)

These are new feature requests from the compliance review, not yet built. They're mostly **matching-engine additions** (new rules in `matching/procedure-matching.js` + the `Proc` mirror + review dialog). Do NOT start coding — this is a pre-plan; the requests need clarification and live captures first.

1. **Auto-correct non-reimbursed billing codes → an appropriate PT CPT.** The scribe sometimes files a procedure under **98960** (Education & Training for Patient Self-Management — not reimbursed for PT). Confirmed request: **98960 → 97535** (Self-Care/Home Management Training). More broadly: catch "CPT codes that shouldn't be used" and let the therapist pick the right one (97110 / 97530 / 97535). Likely a new rule family + possibly a settings choice for the default target.
2. **"Provider cues" documented → move to Neuromuscular Re-education (97112).** When the note documents provider (verbal/tactile) cues, the item still stays under Exercise (97110) instead of moving to Neuro. Request: detect cue language and classify to 97112. (Careful: MET already → 97112, and this may compete with existing 97110 rules — precedence matters.)
3. **"Simulate / simulation of / replicates" → Therapeutic Activity (97530).** When the note says a task simulates/replicates a functional activity, move the item to 97530.
4. **Diagnosis code "S → D" change (UNCLEAR).** A request to "make the diagnosis code change also from a S to D." Most likely the ICD-10 injury-code 7th-character episode indicator (A initial / D subsequent / S sequela) — i.e., set subsequent-encounter "D" for follow-ups — but this is a guess. Needs clarification + a capture of the diagnosis field.

**Positive feedback (informs priorities, not tasks):** the reviewer loved the survey quick-add (most-popular-on-top + make-it-a-goal). They didn't find jump-to-Flowsheet useful — which they can disable in Extension Settings (validates the toggle system). The toggles, calendar Open Note, and jump-to-procedures are all confirmed wins.

## Open questions to resolve before planning

1. **98960/coding:** Is it always 98960 → 97535, or a per-code choice (settings dropdown)? What is the FULL list of "codes that shouldn't be used" and each target (98961/98962? 97150? G-codes?)? Need a **capture of a real note where 98960 appears** — is it a CPT card/section like the 97110/97530 cards, so Fix Procedures can move it?
2. **Provider cues → 97112:** exact trigger phrases ("verbal cues", "tactile cues", "VC", "cueing", "provider cued", "cues to/for…")? Does it apply to every item with cues, or only some? Where does it sit in precedence vs the existing 97110 rules (stretch, PROM, etc.) and MET?
3. **"Simulate" → 97530:** exact phrases ("simulate", "simulation of", "to simulate", "replicates", "mimics")? Precedence vs lunge/squat/etc.?
4. **Diagnosis S→D:** what exactly does "S to D" mean, which field/element holds the diagnosis on the note, and when should it flip (every visit, follow-ups only)? Need a capture.
5. **Company-wide vs Cheri-specific:** the matching rules are one shared set. Should these new rules apply to all Choice Therapy therapists, or stay Cheri's? If therapists want different code mappings (not just on/off), that implies per-user config beyond the current toggles.

## How to work here (the short version)

- Edit the userscript (and the canonical `matching/` or `surveys/` file first for logic). Bump the version in all four spots, regenerate `content.js`, `npm test`, `npm run build:local`, rebuild the store zip, update `CHANGELOG.md`. Commit locally; **don't push**.
- Verify DOM behavior on the live site or an `.mhtml` capture in `captures/` (PHI — never leaves the repo). When you can't verify, say so.
- Watch the recurring gotchas in `DECISIONS.md` (esp. `align-self: flex-end` for right-alignment, and MUI `mousedown` to open selects).
