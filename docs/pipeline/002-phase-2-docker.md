# Pipeline state — 002-phase-2-docker

Status: complete
Current phase: 8 — Accepted by product owner (2026-07-20)
Tier: 3 — Complex: net-new UI (Docker sources in sidebar, status/guidance cards, all-containers toggle) plus a new backend surface (Docker wrapper, subscribe protocol) plus an explicit security tradeoff (read-only Docker socket access) — three separate Tier-3 escalators.
Lightened/skipped phases: none — full pipeline.
QA fix-loop iteration: 1/2
Design fix-loop iteration: 1/2

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
| 4 — Fix loop iter 1 (QA re-verify) | qa-engineer | defect files 1–3 → verified-fixed; test plan updated | PASS — 21/21 criteria, 0 defects open, gates green (79/79 ×3 runs) | 2026-07-20 |
| 5 — Design verification | ux-designer | docs/design-reviews/002-phase-2-docker.md | CHANGES REQUIRED — F1 major (backend: connected toast broadcast ordering shows 0 containers), F2 minor (frontend: flat-layout flash pre-dockerStatus) | 2026-07-20 |
| 6 — Design fix iter 1 (backend) | backend-developer | src/ingest/docker.ts | complete — discovery/sources broadcast now precedes connected status; phantom-connected guarded; 79/79 green | 2026-07-20 |
| 6 — Design fix iter 1 (frontend) | frontend-developer | web/src/store/store.tsx, web/src/components/Sidebar.tsx | complete — tri-state dockerAvailability (unknown/enabled/disabled) with 400ms settle guard; flat fallback only when settled disabled | 2026-07-20 |
| 6 — Design fix iter 1 (QA regression) | qa-engineer | test/docker/recovery-ordering.test.ts (new), test plan regression section, evidence 04/05 | PASS — 81/81, both fixes confirmed, 0 defects | 2026-07-20 |
| 6 — Design re-review | ux-designer | docs/design-reviews/002-phase-2-docker.md (re-review section + final verdict) | APPROVED — both findings resolved | 2026-07-20 |
| 7 — Documentation | technical-writer | README.md, docs/project/overview.md, docs/project/features/002-phase-2-docker.md (new) | docs-current; 3 open Qs → owner answered | 2026-07-20 |
| 7b — CLAUDE.md sync | orchestrator (owner-approved) | docs/CLAUDE.md, src/CLAUDE.md | done — phase-2 status + ingest section updated | 2026-07-20 |
| 7c — Version bump | backend-developer | package.json, package-lock.json, src/server/index.ts, src/cli.ts | 0.0.1 → 0.2.0 across package, /api/status, and CLI --version (owner-approved) | 2026-07-20 |

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
11. (technical-writer, Phase 7) `docs/CLAUDE.md` + `src/CLAUDE.md` stale after phase 2 (outside all lanes) — **Owner: orchestrator updates both directly.** Done.
12. (technical-writer, Phase 7) Bump package version to 0.2.0 for the phase-2 release? — **Owner: Yes, bump.** Routed to backend-developer.
13. (backend-developer, Phase 7c) `src/cli.ts` Commander `.version("0.0.1")` also stale — bump in same change? — **Owner: Yes, bump it too.**
