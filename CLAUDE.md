# CLAUDE.md

Agent guide for this repo. Read these in order:

1. **AGENTS.md** — what this project is, hard constraints, repo map, the dual-artifact rule, the matching-engine sync, build/version workflow, and the commit/push policy. **Start here.**
2. **HANDOFF.md** — current state, the **open loops** (act on those before starting new work), the live-verification checklist, and the pending feature requests + open questions.
3. **DECISIONS.md** — why the code is the way it is, the key DOM anchors, and problems already solved (don't re-solve them — e.g. the `align-self: flex-end` right-alignment fix, MUI selects opening on `mousedown`).

**Two things that bite immediately:**

- **Never open the raw captures folder (`../insights_athelas_raw_captures`).** It holds real patient charts, saved under the patients' names. Read only the scrubbed copies in `captures/` (`<date>_<description>.mhtml`) — `scripts/scrub-capture.js` makes them, and a hook runs it before each prompt and tells you when a new one is ready. If you need something the scrub removed, ask Ben; do not go to the raw file. If Ben types a raw filename in chat, do not repeat it. **And the repo is PUBLIC:** no patient names, clinical details, or clinic staff names/emails in any doc, comment, commit message or test (use roles: "the compliance director"). Four names leaked to the public remote before the scrubber existed; see DECISIONS.md.
- **Work on `main` and push `main`.** Ben's standing instruction (2026-10-13): everything goes into `main` — no feature branch, no PR, unless he asks for one. The old `v15.25.1-billing-diagnosis-poc` branch was merged that day (PR #1) and is stale; don't check it out.

Quick rules: edit `userscript/athelas-insights-helper.user.js` (never `content.js` — it's generated); for matching/survey logic edit the canonical `matching/`/`surveys/` file first, then mirror. Bump the version in all four spots (userscript `@version`, `manifest.json`, `package.json`, `content.js` banner), regenerate `content.js`, run `npm test`, `npm run build:local`, rebuild the store zip, update `CHANGELOG.md`. Commit on `main`, then **always push** — no need to ask (Ben's standing instruction, 2026-10-13); scan the diff for PHI first, because the repo is public.

Toolchain gotchas on this machine: `node` works in the Bash tool; `python`/`python3` are Microsoft Store stubs, so use `C:\Users\Ben\.platformio\penv\Scripts\python.exe` (stdlib only) with `PYTHONUTF8=1`; there is no `zip` (use PowerShell `Compress-Archive`) and no `$TMPDIR` (use the session scratchpad).
