import hljs from "highlight.js/lib/core";
import json from "highlight.js/lib/languages/json";
import plaintext from "highlight.js/lib/languages/plaintext";

// "highlight.js is configured with only the json and plaintext grammars
// registered (not the full ~190-language bundle)" — docs/design-system.md
// § Syntax highlighting.
hljs.registerLanguage("json", json);
hljs.registerLanguage("plaintext", plaintext);

export function highlightJson(value: unknown): string {
  const pretty = JSON.stringify(value, null, 2);
  return hljs.highlight(pretty, { language: "json" }).value;
}

export interface HighlightedBody {
  html: string;
  isJson: boolean;
}

/**
 * Renders `body` for the expanded-row viewport. If the trimmed text parses
 * as a JSON value it's pretty-printed and JSON-highlighted; otherwise it's
 * run through the plaintext grammar (no additional coloring, per the design
 * system's syntax table) — this covers the common case of a raw stack trace.
 */
export function highlightBody(text: string): HighlightedBody {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return { html: highlightJson(parsed), isJson: true };
    } catch {
      // Not valid JSON — fall through to plaintext.
    }
  }
  return { html: hljs.highlight(text, { language: "plaintext" }).value, isJson: false };
}
