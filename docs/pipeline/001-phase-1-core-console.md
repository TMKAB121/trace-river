# Pipeline state — 001-phase-1-core-console

Status: complete
Current phase: 8 — accepted by product owner 2026-07-19
Tier: 3 — net-new UI structure and design language, multi-surface (frontend + backend), security-model implementation
Lightened/skipped phases: none
QA fix-loop iteration: 1/2
Design fix-loop iteration: 0/2

## Ask

Implement Phase 1 — Core Console as specified in docs/phases/phase-1-core.md: CLI wrapper (`traceriver start`), Fastify local server with token auth, React frontend with the terminal-chic theme and virtualized unified stream, the Uniform Parser Pipeline (monolog/clf/jsonl/raw), and streaming file upload with ring buffer + WS replay. Includes parser golden/fuzz tests and an e2e smoke test.

## Phase log

| Phase | Agent | Artifacts | Status | When |
|---|---|---|---|---|
| 0 — State file & lane pre-flight | orchestrator | docs/pipeline/001-phase-1-core-console.md | done — lane probes pass for src/ and web/; dependency gap found (syntax highlighter, font) | 2026-07-19 |
| 0.5 — Triage | orchestrator | (state file) | done — Tier 3 | 2026-07-19 |
| 1 — Design | ux-designer | docs/specs/001-phase-1-core-console.md, docs/design-system.md | done — ready-for-dev; 4 open questions answered by owner, decisions logged in spec | 2026-07-19 |
| 2 — Implementation | backend-developer + frontend-developer (parallel) | src/** (CLI, server, parser pipeline, upload, ring buffer, WS), package.json, tsconfig.json; web/** (full SPA) | done — both STATUS complete; open questions raised, answered by owner; deps installed, full build + tarball boot verified | 2026-07-19 |
| 3 — QA | qa-engineer | docs/qa/test-plans/001-phase-1-core-console.md, docs/qa/defects/001-phase-1-core-console-{1,2,3}.md, docs/qa/evidence/001-phase-1-core-console/, test/** (golden, fuzz, ring-buffer, auth, replay, guardrails, e2e smoke, memory) | done — VERDICT: FAIL, 3 defects (2 backend med, 1 frontend low); gates pass, 57/60 tests | 2026-07-19 |
| 4 — QA fix loop (iter 1) | backend-developer (defect 1) + frontend-developer (defect 3) parallel; qa-engineer re-verify | src/server/index.ts; web/src/components/FreezeButton.tsx; defect files + test plan updated; test/e2e/memory.test.ts threshold per owner ruling | done — VERDICT: PASS, 60/60 tests, 22/22 criteria, 0 open defects (defect 2 accepted-by-owner) | 2026-07-19 |
| 5 — Design verification | ux-designer | docs/design-reviews/001-phase-1-core-console.md; corrections to docs/design-system.md and spec criterion 7 | done — APPROVED, one non-blocking wireframe note | 2026-07-19 |
| 6 — Design fix loop | — | — | skipped — no changes required | 2026-07-19 |
| 7 — Documentation | technical-writer | README.md (rewritten to shipped state), docs/project/overview.md, docs/project/features/001-phase-1-core-console.md | done — docs-current, no open questions | 2026-07-19 |

## Open questions log

1. (orchestrator, lane pre-flight) The dependency allowlist in `.claude/lanes.json` has no syntax-highlighting library (phase doc requires highlight.js or Shiki) and no self-hosted font package (doc requires JetBrains Mono, offline, no CDN). Which deps should be added? — ANSWERED (product owner, 2026-07-19): approve `highlight.js` + `@fontsource/jetbrains-mono`; added to the allowlist with owner authorization.
2. (ux-designer, Phase 1) Sort-by-timestamp toggle in phase 1? — ANSWERED (2026-07-19): excluded from phase 1.
3. (ux-designer, Phase 1) Responsive/mobile layout? — ANSWERED (2026-07-19): desktop-only.
4. (ux-designer, Phase 1) New WS broadcast `{ type: "cleared" }` extending architecture.md's protocol? — ANSWERED (2026-07-19): approved.
5. (ux-designer, Phase 1) Missing CLAUDE.md? — ANSWERED (2026-07-19): not needed this run.
6. (backend-developer, Phase 2) Orphaned root cli.js after bin moved to dist/cli.js? — ANSWERED (2026-07-19): delete it; removed by orchestrator with owner authorization.
7. (backend-developer, Phase 2) `traceriver init` in phase 1? — ANSWERED (2026-07-19): out of scope for phase 1.
8. (frontend-developer, Phase 2) Frontend deps absent from package.json? — routing, not a decision: backend-developer (sole installer) dispatched to install the already-allowlisted deps.
9. (frontend-developer, Phase 2) Source visibility persistence? — ANSWERED (2026-07-19): client-local as implemented; no setVisible contract change.
10. (frontend-developer, Phase 2) Minor resolutions (native confirm/alert guardrails; eviction notice inferred from /api/status; tooltip-only errored-source affordance; designer to fix design-system highlight table at verification) — ANSWERED (2026-07-19): all four approved as implemented.
11. (backend-developer, Phase 2 follow-up) Dependency hook blocks `npm install <local-tarball>` even for our own packed artifact — ANSWERED (2026-07-19): keep hook as-is; future runs verify tarballs via tar-extract + bare `npm install --omit=dev` inside the extracted package.
12. (qa-engineer, Phase 3) Peak RSS 263–292 MB vs spec's "~250 MB" (defect 2)? — ANSWERED (2026-07-19): ACCEPTED as tolerance; defect 2 closes as accepted-by-owner; spec criterion to be annotated with the accepted range at design verification; QA memory test threshold updated accordingly.
13. (qa-engineer, Phase 3) Is startServer({port:0}) in scope (defect 1)? — ANSWERED (2026-07-19): fix now (backend).
14. (qa-engineer, Phase 3) "Stays responsive" threshold (~3s peak API latency during 100 MB upload)? — ANSWERED (2026-07-19): accepted for phase 1; no numeric threshold invented.
15. (qa-engineer, Phase 3) Freeze badge copy "· n new" vs "n new" (defect 3)? — ANSWERED (2026-07-19): fix to match spec (frontend).
16. (qa-engineer, Phase 3, informational) npx-invoked tools blocked by installer hook for QA lane — noted; use npm scripts/local binaries. Missing docs/qa templates — QA's authored format accepted as the project template. Docker fixture carried to phase 2.
