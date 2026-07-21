<!--
Template for docs/qa/defects/NNN-slug-N.md, codifying the format already in
use across docs/qa/defects/001-*.md .. 004-*.md. `NNN-slug` matches the
feature's spec number/slug (docs/specs/NNN-slug.md); `N` is a 1-based
sequence number, one file per distinct defect found while verifying that
feature (e.g. `003-phase-3-auto-discovery-2.md`).

Delete this comment block when copying the template into a real defect file.
Everything below the comment is the actual template.
-->
# Defect NNN-slug-N

**Area:** frontend|backend|design
**Severity:** low|medium|high|critical
**Status:** open
**Spec:** `docs/specs/NNN-slug.md` — cite the specific acceptance
criterion number(s) and/or `§ Section name` the behavior violates, quoting
the exact spec language being contradicted. If the violation is indirect
(e.g. it undermines a general contract in `docs/architecture.md` or a phase
doc's exit criteria rather than the feature spec itself), cite that too.

## Summary

What's wrong, in plain terms: the expected behavior (per spec) vs. the
actual observed behavior, and why it matters to a real user. State the
severity's basis here (e.g. "the console is unusable when started this
way" vs. "wording differs between two already-similar sentence templates").

## Root cause (read, not modified)

Point at the exact file(s)/line(s)/function(s) responsible, quoting the
relevant code verbatim. This section is diagnostic only — QA reads and
quotes code to justify the defect, never edits product code. If the root
cause spans two independently-maintained copies of the same logic (e.g. a
client/server duplication), show both side by side.

## Reproduction

A minimal, concrete repro — ideally one runnable without the full stack
(a pure-function snippet, a `curl`/one-off script against a server on an
ephemeral port, or a bare-library isolation harness that rules out
TraceRiver-specific code as the cause). Show actual observed output, not
just the steps. If a permanent regression test was committed (red on
purpose, following the phase 2/3 convention), name it and note it's
currently failing.

## Impact

Who's affected, how often/broadly (one narrow edge case vs. a whole class
of configurations/detectors), and any explicitly-scoped-out adjacent
behavior that is *not* affected (so the fix's blast radius is clear to the
developer and re-verifying QA later).

## Suggested fix (for the <frontend|backend|design>-developer lane — not applied here)

Optional but common: a non-prescriptive pointer toward a plausible fix
direction, explicitly not a diff and not binding on the developer lane
that owns the fix — QA does not modify product code.

## Automated regression test / Automated regression coverage

State what was committed (path under `test/`, currently red on purpose) or,
if no automated test was added (e.g. the behavior requires real external
infra with prohibitive flakiness, or no test-runner tooling is available
for that layer), say so explicitly and explain why, plus what alternative
verification (manual repro, direct side-by-side execution, etc.) stands in
for it. If the underlying algorithm's *other* half already has coverage
elsewhere (e.g. the server-side twin of a client-side bug), reference it.

## Resolution
<!-- Add only once a fix has landed. Two sub-patterns seen in practice: -->

<!-- Pattern A — straightforward fix, no product-owner call needed: -->
Fixed by <frontend|backend>-developer in `path/to/file.ts`: <one or two
sentences on the actual change, quoting the key line(s) that changed>.

<!-- Pattern B — the defect involved a judgment call the product owner had
to make (e.g. "is this in scope," "is a measured deviation acceptable"):
open with "Product owner ruled ..." / "Product owner reviewed ... and
accepted/ruled out of scope ...", then describe the fix (if any) the same
way as Pattern A. -->

## Re-verification (YYYY-MM-DD)
<!-- Added by QA in Mode 2 (re-verify defects). Do not backfill a
Re-verification section before the fix has actually landed and been
re-tested. -->

What was confirmed present in the committed code (cite file/line), the
repro re-run with its new (fixed) output, which automated test(s) now pass
that didn't before (name them, and confirm they were red-before-fix per the
Automated regression test section above), and the full-suite regression
result (`npm test` — X/X pass, no regressions). If anything from the
original defect's scope is deliberately *not* re-tested (e.g. a
product-owner-accepted limitation that's out of scope for this defect),
say so explicitly rather than silently narrowing the verification.

End with a one-line explicit verdict matching the `Status` field at the top
of the file, e.g.:

**Status: verified-fixed.**
<!-- or, if the owner accepted a measured deviation instead of a code fix: -->
**Status: accepted-by-owner.**
