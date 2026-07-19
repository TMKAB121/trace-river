# test/ — Vitest suite

Run all: `npm test`. Single file: `npm test -- test/parsers/clf.test.ts`. (Agentic-pipeline hooks block `npx`; use npm scripts or `node_modules/.bin/vitest`.)

Layout: `parsers/` (golden + fuzz), `server/` (auth, ring buffer, replay/clear, subscribe, upload guardrails, port-zero), `e2e/` (smoke + memory), `fixtures/` (real captured log samples), `helpers/`.

## Conventions that matter

- **Fixtures are real-world captures, not synthetic** — one per format (`monolog-laravel.log`, `nginx-access.log`, `nginx-error.log`, `pino.jsonl`, `raw.log`) plus `nasty.log` (ANSI codes, interleaved partial writes, a 300-line PHP stack trace, mixed formats). Adding support for a new framework/format = drop in a fixture + expected `TraceRiverLog[]` output.
- **Golden pattern** (`pipeline-golden.test.ts` + per-format tests): fixture in → exact expected entries out.
- **Chunk-boundary fuzz** (`chunk-fuzz.test.ts`): re-feeds each fixture split at random byte offsets and asserts output is byte-identical to feeding it whole. This one test catches most partial-line/demux bugs — every new parser and every ingest adapter must pass it.
- **Server tests** use `helpers/server.ts` `startTestServer()`: boots the real server on an OS-assigned ephemeral port with a per-test token, returns `{baseUrl, wsUrl, token, close}`. Always `close()` in teardown. `helpers/child-server-runner.ts` runs the server in a child process for the memory test.
- **Memory test threshold** (`e2e/memory.test.ts`): the 100 MB-upload RSS ceiling reflects a product-owner-accepted range (263–292 MB measured vs. the spec's ~250 MB target — see `docs/project/overview.md` § Known deviations). Don't "fix" a failure by bumping the threshold; a regression beyond the accepted range is a real defect.

## QA process (agentic pipeline)

The qa-engineer lane writes only `test/` and `docs/qa/`. Failing behavior becomes a defect report in `docs/qa/defects/NNN-slug-N.md` — never a product-code fix. Test plans live in `docs/qa/test-plans/`, screenshots/DOM captures in `docs/qa/evidence/NNN-slug/`. The existing defect files are the format template.
