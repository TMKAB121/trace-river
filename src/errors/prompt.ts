/**
 * AI debugging prompt assembly (docs/specs/004-phase-4-error-intelligence.md
 * § API contract — Prompt assembly). Server-assembles the markdown template
 * verbatim from the spec, then redacts it, and returns the final string —
 * this is this spec's whole server-side role; nothing is ever sent onward
 * to any AI service (D9, clipboard-only).
 */
import type { AppState } from "../server/app-state.js";
import type { ErrorGroup, TraceRiverLog } from "../shared/types.js";
import { ERROR_INTELLIGENCE_CONFIG as CFG } from "./config.js";
import { normalizeBlockForPrompt, redactSecrets } from "./redact.js";

function pad(n: number, len = 2): string {
  return String(n).padStart(len, "0");
}

/** "YYYY-MM-DD HH:mm:ss", or just "HH:mm:ss" when `ms` falls on the same
 *  host-local calendar day as `now` — mirrors web/src/utils/format.ts's
 *  `formatTimestamp` convention, extended with the same-day shorthand the
 *  ErrorGroup card's own First/Last-seen line uses (spec § Components &
 *  states — ErrorGroup card). Server-local time, matching the existing
 *  "zone-less timestamps assumed host-local" convention (src/CLAUDE.md) —
 *  server and browser share a machine for this always-localhost tool. */
function formatTimestamp(ms: number, now: number): string {
  const d = new Date(ms);
  const n = new Date(now);
  const sameDay =
    d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  if (sameDay) return time;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`;
}

function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Standard triple-backtick fence, widening to four backticks if the body
 *  itself contains a triple-backtick sequence (§ Prompt assembly — Markdown
 *  fencing). */
function fence(body: string): string {
  const marker = body.includes("```") ? "````" : "```";
  return `${marker}\n${body}\n${marker}`;
}

function buildStackTraceSection(state: AppState, group: ErrorGroup): string {
  const latestId = group.sampleEntryIds[group.sampleEntryIds.length - 1];
  const latestEntry: TraceRiverLog | undefined = latestId !== undefined ? state.ringBuffer.get(latestId) : undefined;
  if (!latestEntry) {
    return "(original stack trace no longer available — this group's occurrences have all aged out of the buffer.)";
  }
  const raw = latestEntry.body ?? latestEntry.message;
  return normalizeBlockForPrompt(raw);
}

function buildEnvironmentSection(state: AppState, group: ErrorGroup): string[] {
  const lines: string[] = [];
  for (const sourceId of group.sources) {
    const descriptor = state.sources.get(sourceId);
    if (descriptor?.kind === "docker" && descriptor.docker) {
      lines.push(`- Source: ${sourceId} (image ${descriptor.docker.image})`);
    } else {
      lines.push(`- Source: ${sourceId}`);
    }
  }

  const frameworkLabels = state.discovery.frameworks.map((f) => f.label);
  if (frameworkLabels.length > 0) {
    lines.push(`- Project stack detected: ${frameworkLabels.join(", ")}`);
  }

  // "the parser name... currently locked for this error's source" — picks
  // the group's first source; under this spec's fingerprint namespace
  // (Decision 1) a group has exactly one source in practice.
  const parserName = group.sources.length > 0 ? state.parserNames.get(group.sources[0]) : undefined;
  if (parserName) lines.push(`- Log format: ${parserName}`);

  return lines;
}

function buildContextSection(
  state: AppState,
  group: ErrorGroup,
  now: number,
): { body: string; fallbackPrefix: string | null } {
  const anchor = state.errorGroups.getContextAnchor(group.fingerprint, now);
  if (!anchor) {
    return { body: "(no surrounding context available — every entry near this group's occurrences has aged out of the buffer.)", fallbackPrefix: null };
  }
  const before = state.ringBuffer.before(anchor.anchorId, CFG.promptContextLines);
  // Placeholder-normalize only each line's *message* — the leading
  // "<formatted timestamp> [<source>]" scaffolding is metadata this
  // function adds for the reader (spec: "interleaved... timestamped"), not
  // raw log text, so it must survive verbatim rather than being genericized
  // away by the same pass that (correctly) generalizes message content.
  const lines = before.map(
    (e) => `${formatTimestamp(e.timestamp, now)} [${e.source}] ${normalizeBlockForPrompt(e.message)}`,
  );
  const body = lines.length > 0 ? lines.join("\n") : "(no entries precede this occurrence.)";
  return {
    body,
    fallbackPrefix: anchor.usedFallback
      ? "(first-occurrence context unavailable — showing context around the oldest retained occurrence instead.)"
      : null,
  };
}

/** Deterministic occurrence-pattern summary from `group.perMinute` (§ Prompt
 *  assembly — Occurrence pattern). `now` is the same instant the group's
 *  `perMinute` array was computed against (its last bucket = `floor(now /
 *  60000)`), so the peak bucket's clock time can be derived from it. */
function buildOccurrencePatternSummary(perMinute: number[], now: number): string {
  const windowSize = perMinute.length;
  const sum = perMinute.reduce((a, b) => a + b, 0);
  const trueMean = windowSize > 0 ? sum / windowSize : 0;
  const avgRounded = Math.round(trueMean);
  const avgLabel = avgRounded === 0 && trueMean > 0 ? "<1" : String(avgRounded);

  let peakValue = 0;
  let peakIndex = 0;
  for (let i = 0; i < windowSize; i++) {
    if (perMinute[i] > peakValue) {
      peakValue = perMinute[i];
      peakIndex = i;
    }
  }

  if (peakValue >= CFG.spike.multiplierThreshold * avgRounded && peakValue >= CFG.spike.minAbsoluteRatePerMin) {
    const currentMinute = Math.floor(now / 60_000);
    const peakMinute = currentMinute - (windowSize - 1 - peakIndex);
    const clock = formatClock(peakMinute * 60_000);
    return `steady ~${avgLabel}/min for ${peakIndex} min, spiked to ${peakValue}/min at ${clock}`;
  }
  return `steady ~${avgLabel}/min over the last ${windowSize} min`;
}

/** Assembles + redacts the full markdown prompt for `fingerprint`, or
 *  `null` if the fingerprint isn't currently tracked (404 territory — the
 *  caller, src/server/routes/errors.ts, maps that to the documented
 *  response). */
export function assemblePrompt(state: AppState, fingerprint: string): string | null {
  const now = Date.now();
  const group = state.errorGroups.get(fingerprint, now);
  if (!group) return null;

  const stackTrace = buildStackTraceSection(state, group);
  const environmentLines = buildEnvironmentSection(state, group);
  const context = buildContextSection(state, group, now);
  const occurrencePattern = buildOccurrencePatternSummary(group.perMinute, now);

  const lines: string[] = [
    "I'm debugging an error in my local development environment. Help me find the",
    "root cause and suggest a fix.",
    "",
    "## Error",
    `\`${group.title}\` — occurred ${group.count} times between ${formatTimestamp(group.firstSeen, now)} and ${formatTimestamp(group.lastSeen, now)},`,
    `from source(s): ${group.sources.join(", ")}.`,
    "",
    "## Stack trace (most recent occurrence)",
    fence(stackTrace),
    "",
    "## Environment",
    ...environmentLines,
    "",
    "## Surrounding log context",
    "The 15 entries immediately before the first occurrence, across all subscribed",
    "sources (interleaved, timestamped):",
    ...(context.fallbackPrefix ? [context.fallbackPrefix] : []),
    fence(context.body),
    "",
    "## Occurrence pattern",
    occurrencePattern,
    "",
    "Please: 1) identify the most likely root cause, 2) explain the reasoning,",
    "3) suggest a concrete fix, 4) note what additional info would confirm it.",
  ];

  return redactSecrets(lines.join("\n"));
}
