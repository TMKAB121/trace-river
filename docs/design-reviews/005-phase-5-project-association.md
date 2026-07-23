# Design Review 005 — Phase 5: Real-World Project Association (Batch 1 — S1)

Spec: [`docs/specs/005-phase-5-project-association.md`](../specs/005-phase-5-project-association.md)
Test plan: [`docs/qa/test-plans/005-phase-5-project-association.md`](../qa/test-plans/005-phase-5-project-association.md) — verdict PASS, 0 defects, criteria 1–14 verified
Tier: 2 (light) — **delta scope**, per the orchestrator's brief: verify only the changed surface, not a full-UI pass.

## Scope reviewed

This batch is specified (§ Overview, § Layout, § Components & states, § Design
tokens used, § Accessibility requirements) as a **server-side matcher change
with zero rendered surface** — no wireframe, no new/changed component state,
no new token, no accessibility delta. Accordingly this review's scope is:

1. Confirm the shipped change stays within that declared zero-UI surface (no
   `web/` modification, no new token, no design-system impact).
2. Confirm the wire contract the UI depends on
   (`SourceDescriptor.docker.inCurrentProject` / `composeProject` /
   `composeService`) is unchanged, per spec § API contract.
3. Confirm the user-flow outcome the spec promises (§ User flow) is actually
   covered by QA's verified criteria, not left asserted-but-unverified.
4. Note criterion 15 (architecture.md + ADR) status without treating it as a
   design defect (it's explicitly out of this spec's scope, owned by other
   lanes).

No `docs/qa/evidence/005-*` directory exists, and none was expected — the
test plan correctly declares (§ header) that Tier-2 browser-evidence capture
is skipped for a backend-only, zero-rendered-surface change. There is nothing
to Read-as-screenshot for this feature; source/type reading plus QA's written
verification is the correct verification method here, not a shortfall.

## Findings

| Severity | Spec section | Expected | Actual | Suspected file |
|---|---|---|---|---|
| — | none | — | No blocker/major/minor findings. | — |

No findings. Details below by check.

### 1. Zero-UI surface held

Read `src/ingest/docker.ts` in full: the entire diff is contained to that one
file — a new `resolvePathMatch`/`matchesProjectPath`/`safeRealpath`/
`stripTrailingSep` helper set feeding into `discoverAll()`'s existing
`inCurrentProject` computation (previously a single name-comparison
expression, now `pathMatch !== null ? pathMatch : <unchanged name
comparison>`). No `web/` file is touched by this batch: `Glob` over `web/**/*`
plus a targeted `Grep` for `inCurrentProject` inside `web/` turns up exactly
two pre-existing references —

- `web/src/types.ts:110` — the field declaration, identical in shape to
  `src/shared/types.ts`'s `SourceDescriptor.docker` (`image`,
  `composeProject`, `composeService`, `inCurrentProject: boolean` — same four
  fields, same types, same optionality).
- `web/src/components/ContainersSection.tsx:19` — the existing client-side
  filter, `state.showAllContainers || s.docker?.inCurrentProject !== false`,
  unchanged, consuming the field exactly as an opaque boolean.

Both predate this batch and are untouched by it — consistent with spec's "no
frontend work required" claim (§ API contract) and QA's own confirmation
(test plan: "Changed product code this batch: `src/ingest/docker.ts` only").
No new design-system token is referenced or required — verified there is
nothing new to check against `docs/design-system.md`.

### 2. Wire contract unchanged

Read `src/shared/types.ts` in full. `SourceDescriptor.docker` (lines 121–126)
is exactly:

```ts
docker?: {
  image: string;
  composeProject: string | null;
  composeService: string | null;
  inCurrentProject: boolean;
};
```

— the same four fields, same types, as documented pre-batch, with no fifth
field (e.g. no "matched via path/name" diagnostic — consistent with spec
Open Question 2 correctly *not* being implemented unilaterally). This is a
full-content read comparison, not a diff; I have no `git diff` tool available
in this lane. Per the brief's own instruction, I rely on QA's recorded
verification for the byte-identical claim: the test plan states `git diff
HEAD -- src/shared/types.ts` "produced zero output" and reports criterion 14
**PASS**. Combined with my own read confirming the field shapes are exactly
what spec 002/005 describe (no new field, no changed type), I have no basis
to doubt that record, and no independent way to run `git diff` myself in this
lane — this is disclosed as reliance on QA's tooling, not an independent
byte-diff.

`src/ingest/docker.ts`'s `discoverAll()` (lines 229–241) confirms
`composeProject`/`composeService` are populated from the same two labels as
before (`com.docker.compose.project`, `com.docker.compose.service`)
regardless of which tier decided `inCurrentProject` — matching spec § API
contract's claim that a Lando container's tooltip still shows whatever its
`com.docker.compose.project` label says, unchanged.

### 3. User-flow outcome covered by verified criteria

Walking spec § User flow's five numbered outcomes against the acceptance
criteria → QA mapping table:

- Flow step 3 ("Lando containers default into view, toggle off") →
  criteria 1–2, verified PASS (S1 fixture, exact `io.lando.root` match,
  `working_dir` correctly ignored).
- Flow step 4 ("unrelated project elsewhere stays behind the toggle") →
  criterion 4 (sibling-prefix non-match) plus criterion 7 (reverse-ancestor
  non-match) plus criterion 9 (no labels at all → no match), all PASS —
  together these cover every "should not spuriously associate" shape the flow
  implies.
- Flow step 5 ("vanilla Compose keeps associating as before, via
  `working_dir` first, falling through to name/basename only if absent") →
  criteria 5, 6, 8, all PASS, including the explicit regression guarantee
  that `test/docker/discovery.test.ts`'s existing criterion-1 scenario passes
  **unmodified**.
- Flow step 6 ("include/exclude and the toggle behave identically regardless
  of which signal produced `inCurrentProject`") → criteria 10–11, PASS,
  exercised against real throwaway containers carrying a synthetic
  `io.lando.root` label (live-daemon test), not just the pure-fixture matcher
  test — this is the right test shape for a claim about the toggle/filter
  pipeline rather than the matcher function in isolation.

I find no user-flow claim left asserted in the spec without a corresponding
verified criterion. The `ContainersSection.tsx` filter expression I read
(`s.docker?.inCurrentProject !== false`) is exactly the mechanism the flow's
"toggle off" default described, and it is untouched by this batch — the
correct outcome given the spec's claim that only the server-side computation
of the boolean changed, not its consumption.

### 4. Criterion 15 status

Confirmed not yet done: `docs/architecture.md`'s Docker association section
and `docs/decisions.md` (checked: no ADR beyond D10, no mention of
`io.lando.root`/path-label matching order) don't yet reflect this batch. Per
the spec's own framing ("owned by the backend/technical-writer lanes, not by
this spec's UI/QA scope") and QA's test plan (criterion 15 recorded "N/A —
tracked, not QA-owned"), this is **not a design defect** — it's pending
downstream doc-phase work, noted here for traceability only, consistent with
the brief's instruction.

## Checklist

- [x] Layout vs wireframe — N/A, none specified, none shipped.
- [x] All specified states present — N/A, no new/changed states specified;
      pre-existing Docker status card / source-row / toggle states (spec 002)
      confirmed untouched by reading `ContainersSection.tsx` in full.
- [x] Token-only styling — N/A, no CSS/token change in this batch; spot-check
      of `web/` confirms no new raw values introduced.
- [x] Semantics/landmarks, ARIA — N/A, no markup change; `ContainersSection.tsx`'s
      existing `role="switch"`/`aria-checked`/`aria-label` on the toggle are
      unchanged, read in full to confirm no incidental edit.
- [x] Focus states — N/A, no new interactive control.
- [x] Text-not-color-alone — N/A, no new state/indicator introduced.
- [x] Wire contract (`SourceDescriptor.docker`) unchanged — verified by direct
      read of `src/shared/types.ts`, corroborated by QA's recorded `git diff`
      result.
- [x] No `web/` file modified by this batch — verified by Glob + targeted Grep.
- [x] User-flow claims backed by verified acceptance criteria — verified via
      the criteria → QA mapping table cross-check above.

## Verdict

**APPROVED.** The implementation stays exactly within the spec's declared
zero-UI surface: no `web/` file, no design-system token, and no wire-contract
field changed. `SourceDescriptor.docker`'s four fields are unchanged in
`src/shared/types.ts`, and the sidebar's existing consumption of
`inCurrentProject` as an opaque boolean (`ContainersSection.tsx`) is
untouched and unaffected. Every user-flow outcome the spec promises maps to
a QA-verified acceptance criterion; no claim is left unverified. Criterion 15
(architecture.md/ADR) remains pending but is explicitly out of this spec's
and this review's scope, not a defect.

---

ARTIFACTS WRITTEN: docs/design-reviews/005-phase-5-project-association.md
STATUS: APPROVED
OPEN QUESTIONS: none (spec 005's own two open questions — reverse ancestor-path/monorepo matching direction; an optional "matched via" tooltip affordance — remain open for the product owner per the spec itself; this review does not add any new ones)
