# CLAUDE.md

Agent guide for this repo. Read these in order:

1. **AGENTS.md** — what this project is, hard constraints, repo map, the dual-artifact rule, the matching-engine sync, build/version workflow, and the commit/push policy. **Start here.**
2. **HANDOFF.md** — current state (version, deployment status, Web Store rejection), and the pending feature requests + open questions ("current work").
3. **DECISIONS.md** — why the code is the way it is, the key DOM anchors, and problems already solved (don't re-solve them — e.g. the `align-self: flex-end` right-alignment fix, MUI selects opening on `mousedown`).

Quick rules: edit `userscript/athelas-insights-helper.user.js` (never `content.js` — it's generated); for matching/survey logic edit the canonical `matching/`/`surveys/` file first, then mirror. Bump the version in all four spots (userscript `@version`, `manifest.json`, `package.json`, `content.js` banner), regenerate `content.js`, run `npm test`, `npm run build:local`, rebuild the store zip, update `CHANGELOG.md`. Commit locally; **do not push** (Ben pushes). Never commit PHI (`captures/`).
