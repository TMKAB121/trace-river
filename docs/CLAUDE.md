# docs/ — what's authoritative, what's a plan, what's an artifact

Three kinds of documents live here. Knowing which is which prevents both stale edits and treating plans as shipped behavior.

## Authoritative, living specs — keep in sync with code changes

| Doc | Owns |
|---|---|
| `architecture.md` | Process model, data flow, WS transport/batching, memory model, **security model**, port strategy, packaging + dependency budget |
| `log-schema.md` | The `TraceRiverLog` contract and all four pipeline stages (mirrored by `src/shared/types.ts` and `src/parsers/`) |
| `configuration.md` | CLI flags and the full `traceriver.json` schema (schema is ahead of implementation — see below) |
| `design-system.md` | **Every** visual value in the UI. No spec or component may use a raw value not listed here; new values are added here first, with a reason. Mirrored by `web/src/styles/tokens.css`. |
| `decisions.md` | One-paragraph dated ADRs (D1–D10 so far). When making an architectural choice, append one recording *why*, so it isn't relitigated. |

If a code change contradicts one of these, either the change is wrong or the doc must be updated in the same effort — never leave them diverged silently.

## Plans — `phases/`

`phase-0` … `phase-4` are the build plan with exit criteria. Phases 0–2 are done; **3–4 are forward-looking** — they describe intended behavior (tailing/auto-discovery, error intelligence), not current code. They contain deliberately captured implementation gotchas — read the relevant phase doc before starting its implementation.

## Per-feature pipeline artifacts — historical record, numbered `NNN-slug`

One feature number threads through: `specs/` (UX spec + API contract + acceptance criteria — the spec is the binding contract for its feature's UI and endpoints), `design-reviews/` (verdicts), `qa/` (test plans, defects, evidence), `pipeline/` (run state + open-questions log for the orchestrated run). These record what happened; don't rewrite history in them — a change to shipped behavior gets a new spec/feature number.

`project/` is the exception: `project/overview.md` and `project/features/` are *living* docs describing shipped state only (technical-writer lane), updated per feature. **`project/overview.md` § "Known deviations"** is the canonical list of doc-vs-implementation gaps (e.g. `traceriver init` documented but not implemented; config's `discovery`/`parsers` sections still scaffolding — the `docker` section is live as of phase 2). Check it before assuming a documented feature exists; don't restate its contents elsewhere.
