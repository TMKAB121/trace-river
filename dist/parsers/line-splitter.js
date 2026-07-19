/**
 * Stage 1 — line splitting with partial-line buffering and ANSI stripping.
 * See docs/log-schema.md § "Line splitting (partial-line buffering)".
 */
// Strip ANSI escape / CSI / OSC sequences before any format regex sees the line.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1B]*(?:\x07|\x1B\\))/g;
export function stripAnsi(input) {
    return input.replace(ANSI_RE, "");
}
/** Idle timeout after which the held remainder is flushed as a final line. */
export const LINE_SPLITTER_IDLE_MS = 2000;
export class LineSplitter {
    decoder = new TextDecoder("utf-8", { fatal: false });
    remainder = "";
    /** Feed a raw chunk; returns complete, ANSI-stripped lines found within it. */
    push(chunk) {
        const text = this.decoder.decode(chunk, { stream: true });
        const combined = this.remainder + text;
        const parts = combined.split("\n");
        this.remainder = parts.pop() ?? "";
        return parts.map((line) => stripAnsi(stripTrailingCr(line)));
    }
    /** Call at stream end (or on idle timeout) to flush any held partial line. */
    flush() {
        // Flush any bytes still buffered inside the streaming decoder.
        const tail = this.decoder.decode();
        const combined = this.remainder + tail;
        this.remainder = "";
        if (combined === "")
            return [];
        return [stripAnsi(stripTrailingCr(combined))];
    }
    hasPending() {
        return this.remainder.length > 0;
    }
}
function stripTrailingCr(line) {
    return line.endsWith("\r") ? line.slice(0, -1) : line;
}
//# sourceMappingURL=line-splitter.js.map