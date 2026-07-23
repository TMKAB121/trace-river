# docs/ — what's authoritative, what's a plan, what's an artifact

Three kinds of documents live here. Knowing which is which prevents both stale edits and treating plans as shipped behavior.

## Authoritative, living specs — keep in sync with code changes

| Doc | Owns |
|---|---|
| `architecture.md` | Process model, data flow, WS transport/batching, memory model, **security model**, port strategy, packaging + dependency budget |
| `log-schema.md` | The `TraceRiverLog` contract and all four pipeline stages (mirrored by `src/shared/types.ts` and `src/parsers/`) |
| `configuration.md` | CLI flags and the full `traceriver.json` schema (schema is ahead of implementation — see below) |
| `design-system.md` | **Every** visual value in the UI. No spec or component may use a raw value not listed here; new values are added here first, with a reason. Mirrored by `web/src/styles/tokens.css`. |
| `decisions.md` | One-paragraph dated ADRs (through D11). When making an architectural choice, append one recording *why*, so it isn't relitigated. |

If a code change contradicts one of these, either the change is wrong or the doc must be updated in the same effort — never leave them diverged silently.

## Plans — `phases/`

`phase-0` … `phase-5` are the build plan with exit criteria. **Phases 0–5 have all shipped** — these are now historical build docs, not a forward roadmap; `docs/project/` is the source of truth for current shipped behavior. Phase 5 (`phase-5-project-association.md`) is a *living* phase, extended incrementally (currently through batch 1). The phase docs still contain deliberately captured implementation gotchas — worth reading before touching the corresponding subsystem.

## Per-feature pipeline artifacts — historical record, numbered `NNN-slug`

One feature number threads through: `specs/` (UX spec + API contract + acceptance criteria — the spec is the binding contract for its feature's UI and endpoints), `design-reviews/` (verdicts), `qa/` (test plans, defects, evidence), `pipeline/` (run state + open-questions log for the orchestrated run). These record what happened; don't rewrite history in them — a change to shipped behavior gets a new spec/feature number.

`project/` is the exception: `project/overview.md` and `project/features/` are *living* docs describing shipped state only (technical-writer lane), updated per feature. **`project/overview.md` § "Known deviations"** is the canonical list of doc-vs-implementation gaps (e.g. `traceriver init` documented but not implemented; config's `discovery`/`parsers` sections still scaffolding — the `docker` section is live as of phase 2). Check it before assuming a documented feature exists; don't restate its contents elsewhere.
