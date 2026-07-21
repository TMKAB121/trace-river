# Pipeline state — 004-phase-4-error-intelligence

Status: complete            <!-- in-progress | complete | stopped -->
Current phase: 8 — Accepted by product owner 2026-07-21 (owner will smoke-test street_bites live E2E separately; follow-ups to be queued via backlog)
Tier: 3 — net-new UI structure (errors panel, prompt preview modal), multi-surface change (new WS `errorGroups` message + new API endpoints + net-new UI), and a data-handling/security tradeoff (redaction pass before prompts leave the server)
Lightened/skipped phases: none
QA fix-loop iteration: 1/2
Design fix-loop iteration: 0/2

## Ask

Implement Phase 4 — Error Intelligence, per docs/phases/phase-4-error-intelligence.md: error fingerprinting & grouping (4.1), UI surfacing — sidebar badges, errors panel, errors-only toggle, jump-to-latest-error, spike detection (4.2), AI prompt generation with redaction + preview modal (4.3), and the testing/exit criteria in 4.4. For end-to-end testing, ~/projects/street_bites has Docker containers enabled and other ~/projects directories can serve as local-log test beds.

## Phase log

| Phase | Agent | Artifacts | Status | When |
|---|---|---|---|---|
| 0 — State file | orchestrator | docs/pipeline/004-phase-4-error-intelligence.md; backlog B4 → in-progress (spec 004) | done | 2026-07-20 |
| 0.5 — Triage | orchestrator | Tier 3 recorded | done | 2026-07-20 |
| 1 — Design | ux-designer | docs/specs/004-phase-4-error-intelligence.md; docs/design-system.md (new tokens) | ready-for-dev | 2026-07-21 |
| 2 — Implementation | backend-developer | src/errors/* (new), src/server/{ingest-entries.ts,routes/errors.ts} (new), src/shared/types.ts, ring-buffer/broadcaster/ws/app-state/index, parsers/pipeline.ts, ingest/{upload,tail,docker}.ts | complete (typecheck+build+109/109 tests green) | 2026-07-21 |
| 2 — Implementation | frontend-developer | web/src/: types.ts, tokens.css, icons.tsx, store.tsx, App.tsx, 13 new components (ErrorsPanel, ErrorGroupCard, AIPromptModal, Sparkline, ScopeChip, …), hooks useFocusTrap/useLatestErrorShortcut, utils, rest.ts | complete (web typecheck + vite build clean) | 2026-07-21 |
| 2b — Docs sync | orchestrator | docs/architecture.md, docs/log-schema.md updated for Phase-4 wire contract (owner-approved) | done | 2026-07-21 |
| 3 — QA | qa-engineer | test/errors/* + test/server/errors-* (87 new tests, 196/196 green), docs/qa/test-plans/004…, docs/qa/defects/004…-1.md, docs/qa/evidence/004…/ | FAIL — 1 low-sev frontend defect | 2026-07-21 |
| 4 — QA fix loop (1/2) | frontend-developer | web/src/utils/occurrencePattern.ts (spike comparison aligned with server) | complete | 2026-07-21 |
| 4 — QA fix loop (1/2) | qa-engineer | test/errors/occurrence-pattern-client.test.ts (new), defect 004…-1 → verified-fixed, docs/qa/TEMPLATE-defect.md (new, owner-approved) | PASS — 199/199 | 2026-07-21 |
| 5 — Design verification | ux-designer | docs/design-reviews/004-phase-4-error-intelligence.md; design-system.md Iconography self-inconsistency corrected (Finding 1, designer's lane) | APPROVED — both delegated calls ratified | 2026-07-21 |
| 6 — Design fix loop | — | not needed (APPROVED first pass) | skipped | 2026-07-21 |
| 7 — Documentation | technical-writer | README.md, docs/project/overview.md, docs/project/features/004-phase-4-error-intelligence.md (new) | docs-current | 2026-07-21 |
| 8 — Acceptance | product owner | Accepted; street_bites live smoke deferred to owner | complete | 2026-07-21 |

## Open questions log

1. **backend-developer (Phase 2):** docs/architecture.md and docs/log-schema.md need Phase-4 updates (fingerprint field, ErrorGroup, errorGroups WS message, GET /api/errors, GET /api/errors/:fingerprint/prompt) but are outside all lanes. **Owner answer (2026-07-21):** orchestrator updates both binding docs.
2. **backend-developer (Phase 2):** (a) group `level` reflects latest occurrence's level; (b) prompt/card timestamps use server-host-local time. **Owner answer (2026-07-21):** both accepted as implemented.
3. **frontend-developer (Phase 2):** (a) sidebar error badge + SPIKING indicator inline in source row per spec prose; (b) sort-control active state uses accent-interactive, not error tint. **Owner answer (2026-07-21):** proceed; Phase-5 design review decides both against rendered evidence.
4. **qa-engineer (Phase 3):** should the low-severity cosmetic sparkline-tooltip defect (004-…-1) block, or ship as fast-follow? **Owner answer (2026-07-21):** fix now via the QA fix loop.
5. **qa-engineer (Phase 3):** docs/qa/TEMPLATE-defect.md referenced by QA role but missing (4th run in a row). **Owner answer (2026-07-21):** QA creates it during its Mode-2 re-verification this run.
