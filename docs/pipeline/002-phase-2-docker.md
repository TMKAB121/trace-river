# Pipeline state — 002-phase-2-docker

Status: in-progress
Current phase: 4 — QA fix loop
Tier: 3 — Complex: net-new UI (Docker sources in sidebar, status/guidance cards, all-containers toggle) plus a new backend surface (Docker wrapper, subscribe protocol) plus an explicit security tradeoff (read-only Docker socket access) — three separate Tier-3 escalators.
Lightened/skipped phases: none — full pipeline.
QA fix-loop iteration: 1/2
Design fix-loop iteration: 0/2

## Ask

Implement Phase 2 (Docker log streams) as specified in docs/phases/phase-2-docker.md. The user is running their street_bites Laravel site in Docker locally, which can be used for real-world verification.

## Phase log

| Phase | Agent | Artifacts | Status | When |
|---|---|---|---|---|
| 0 — State file | orchestrator | docs/pipeline/002-phase-2-docker.md | done | 2026-07-19 |
| 0.5 — Triage | orchestrator | Tier 3 recorded | done | 2026-07-19 |
| 1 — Design | ux-designer | docs/specs/002-phase-2-docker.md | ready-for-dev; 2 open Qs answered by owner, recorded as Decisions 4/5 in spec | 2026-07-19 |
| 2 — Implementation (backend) | backend-developer | src/ingest/docker-client.ts, src/ingest/docker.ts, src/types/dockerode.d.ts, src/server/routes/docker-status.ts, src/shared/{types,config}.ts, src/cli.ts, src/server/{app-state,sources,broadcaster,ws,index}.ts, src/server/routes/status.ts, src/parsers/{pipeline,aggregator}.ts, src/parsers/formats/types.ts, package.json (+dockerode) | complete; typecheck/build/60 tests pass; live-verified vs street_bites; 2 open Qs → owner ratified | 2026-07-19 |
| 2 — Implementation (frontend) | frontend-developer | web/src/types.ts, web/src/store/store.tsx, web/src/components/{Sidebar,SourceRow}.tsx+.css, ContainersSection.tsx+.css, FilesSection.tsx, DockerStatusCard.tsx+.css | complete; web typecheck + vite build pass; 3 open Qs → owner ratified | 2026-07-19 |
| 3 — QA | qa-engineer | docs/qa/test-plans/002-phase-2-docker.md, test/docker/* (19 tests), docs/qa/defects/002-phase-2-docker-{1,2,3}.md, docs/qa/evidence/002-phase-2-docker/ | FAIL — gates pass, 18/21 criteria OK, 3 backend defects (criteria 5, 7, 8); 3 open Qs → owner answered | 2026-07-19 |
| 4 — Fix loop iter 1 (backend) | backend-developer | src/parsers/pipeline.ts, src/ingest/docker.ts, src/types/dockerode.d.ts | complete — all 3 defects fixed, 79/79 tests green incl. both regression tests; 1 open Q → owner accepted provisional emit | 2026-07-20 |

## Open questions log

1. (ux-designer, Phase 1) Container rename: carry subscription/history to new name, or treat as fresh unsubscribed source? — **Owner: New source** (old id settles to stopped with history; spec default confirmed).
2. (ux-designer, Phase 1) Docker subscription model: global/server-side shared attachment vs. per-connection? — **Owner: Global** (one attachment per container, unsubscribe destroys it; spec default confirmed).
3. (backend-developer, Phase 2) not_installed vs not_running is a heuristic (socket file + docker CLI on PATH)? — **Owner: Accept heuristic.**
4. (backend-developer, Phase 2) Restart/rename lifecycle not exercised against owner's live containers — how should QA verify? — **Owner: QA uses throwaway test containers; street_bites is observed only, never disturbed.**
5. (frontend-developer, Phase 2) Docker-enabled detection by inference vs explicit `dockerEnabled` field on GET /api/status? — **Owner: Keep inference.**
6. (frontend-developer, Phase 2) Two unspecified UI details (dismissed-card empty state; combined metadata+error tooltip format) — **Owner: Accept both as implemented.**

All Phase-2 answers ratified shipped behavior as-is; no dev re-invocation was required.

7. (qa-engineer, Phase 3) Failure-state cards (criteria 10–13) only verifiable by code review on this host (live daemon occupies default socket; stopping it would kill street_bites) — sufficient, or add test-only socket override? — **Owner: Code review is sufficient for this run.**
8. (qa-engineer, Phase 3) Do defects 1–3 block shipping? — **Owner: Fix all three now via the standard fix loop.**
9. (qa-engineer, Phase 3) `tools/browser.js` doesn't exist; evidence captured via direct headless Chrome. — **Owner: Accepted; evidence stands as captured.**
10. (backend-developer, Phase 4 fix loop) Defect-1 fix strategy: provisional emit (first ≤20 entries may stay `raw`) vs retroactive re-tag on format lock? — **Owner: Provisional emit accepted.**
