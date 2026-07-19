# Phase 4 — Error Intelligence

**Objective:** Turn "consolidate" into "identify." Phases 1–3 make every log visible; this phase makes the *errors* impossible to miss — grouped, counted, and one click away from an AI-ready debugging prompt. This is the differentiator over plain log viewers (Dozzle, logdy, `docker compose logs`).

## 4.1 Error fingerprinting & grouping

The same error logged 400 times is one problem, not 400 lines. Each ERROR/FATAL entry gets a **fingerprint** so recurrences collapse into a group.

**Fingerprint algorithm** — normalize the message, then hash:

1. Start from `message` (+ the first frame of the stack trace when present — same message from two code paths should split into two groups).
2. Strip/replace variable segments with placeholders:
   - timestamps and dates → `<ts>`
   - UUIDs, hex strings ≥ 8 chars, long integers → `<id>`
   - quoted strings and numbers in common positions (`user 12345`, `id = 'abc'`) → `<val>`
   - memory addresses, ports, durations (`took 342ms`) → `<n>`
   - file paths keep their static tail but drop user-specific prefixes (`/Users/x/project/` → ``)
3. `fingerprint = hash(source-namespace + normalized message + top stack frame)`. Grouping is per source *type* namespace, so `docker:mysql` and a re-created `docker:mysql` regroup together, but mysql and nginx errors never merge.

Normalization rules live next to the parser fixtures with golden tests — false merges (distinct bugs in one group) are worse than false splits, so rules err conservative.

**Error group model:**

```ts
interface ErrorGroup {
  fingerprint: string;
  title: string;            // normalized message (placeholders shown as ⟨…⟩)
  level: "ERROR" | "FATAL";
  sources: string[];        // every source that emitted it
  count: number;
  firstSeen: number;        // epoch ms
  lastSeen: number;
  sampleEntryIds: number[]; // ring-buffer ids of up to 10 raw occurrences
  perMinute: number[];      // rolling 30-min occurrence histogram
}
```

Groups live server-side beside the ring buffer (groups survive entry eviction — count/firstSeen persist after the raw lines age out, flagged "raw entries evicted"). Capped at 500 groups (LRU by lastSeen).

## 4.2 Surfacing errors in the UI

- **Sidebar badges**: per-source error count (red badge), incrementing live. Clicking a badge filters the stream to that source's errors.
- **Errors panel**: a new top-level view listing `ErrorGroup` cards — title, count, sparkline of the `perMinute` histogram, sources, first/last seen. Sorted by lastSeen (recency) with a count sort toggle. Clicking a card shows sample occurrences (expandable, full stack traces) and the Generate AI Prompt button.
- **Errors-only stream toggle** in the top bar — the existing stream filtered to ERROR/FATAL across all sources.
- **Jump to latest error**: keyboard shortcut (`e`) + top-bar button scrolls the stream to the most recent error entry.
- **Spike detection (lightweight, no ML)**: a group whose current per-minute rate exceeds 5× its trailing 30-min average (and ≥ 10/min absolute) gets a "spiking" badge, and the source row in the sidebar pulses. Threshold constants live in one config object; this is a heuristic, documented as such.
- New WS messages: `{ type: "errorGroups", groups }` (batched updates, same 75 ms cadence) — the client never computes fingerprints.

## 4.3 AI prompt generation

One click on an error group assembles a **copy-ready markdown prompt** engineered to give an AI assistant (Claude, Copilot, ChatGPT) everything it needs to actually help — the value is in the *context assembly*, which TraceRiver is uniquely positioned to do because it holds the surrounding stream.

**Prompt contents** (server-assembled from the ring buffer + phase-3 fingerprint data):

````markdown
I'm debugging an error in my local development environment. Help me find the
root cause and suggest a fix.

## Error
`<normalized title>` — occurred <count> times between <firstSeen> and <lastSeen>,
from source(s): <sources>.

## Stack trace (most recent occurrence)
```
<full raw body of the latest sample entry>
```

## Environment
- Source: docker:app (image php:8.3-fpm) / local:laravel   ← from phase-2 inspect / phase-3 fingerprint
- Project stack detected: Laravel (composer.json), Next.js  ← detector results
- Log format: monolog

## Surrounding log context
The 15 entries immediately before the first occurrence, across all subscribed
sources (interleaved, timestamped):
```
<context lines>
```

## Occurrence pattern
<per-minute histogram summary — e.g. "steady ~2/min for 20 min, spiked to 40/min at 15:31">

Please: 1) identify the most likely root cause, 2) explain the reasoning,
3) suggest a concrete fix, 4) note what additional info would confirm it.
````

Design points:

- **Cross-source context is the killer detail**: the 15 entries *before* the error include the mysql `Connection refused` that nginx's 500 is downstream of — exactly what a human debugging session reconstructs manually.
- **Redaction pass** before the prompt leaves the server: the fingerprinting placeholder rules re-run over context lines, plus pattern scrubbing for obvious secrets (bearer tokens, `password=`, AWS-style keys) → `<redacted>`. Shown in a preview modal — the user sees exactly what they're copying, can edit inline, then Copy.
- **v1 is clipboard-only.** No API keys, no network calls — TraceRiver stays fully local and the user pastes into whatever assistant they already use. Future work (explicitly out of scope): bring-your-own-key direct integration, and an MCP server mode so agentic tools can query TraceRiver's buffer themselves.

## 4.4 Testing

- Fingerprint golden tests: fixture corpus of real error messages (Laravel exceptions, mysql errors, nginx 5xx, Node unhandled rejections) → expected group assignments; regression suite grows with every false-merge/false-split bug found.
- Prompt snapshot tests: seeded ring buffer → generated prompt matches snapshot (proves redaction + context selection deterministically).

## Exit criteria

- [ ] 400 repetitions of one Laravel exception render as one group with count 400, not 400 cards.
- [ ] Two distinct errors sharing message text but different stack tops form separate groups.
- [ ] Sidebar badges, errors panel, errors-only toggle, and jump-to-latest-error work live during a stream.
- [ ] Spike badge triggers on a simulated error burst and clears when the rate subsides.
- [ ] Generated prompt for a nginx-500-caused-by-mysql-down scenario includes the mysql failure in its context section, with secrets redacted.
- [ ] Groups survive ring-buffer eviction of their raw entries (counts intact, samples marked evicted).
