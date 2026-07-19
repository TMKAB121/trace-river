# TraceRiver Design System

Single source of truth for every visual value used in TraceRiver's UI. **No
spec or component may use a raw color/spacing/type value that isn't listed
here.** If a design needs a new value, add it here first, with a short reason,
then reference the token name in the spec.

Theme: **terminal-chic** — near-black background, self-hosted monospace
font, neon level-accent colors used as the app's core visual grammar (level
color is the only place saturated color appears; everything else stays
neutral so levels stay scannable even peripherally).

All colors below are checked against the base background (`--color-bg`,
`#0B0E14`) using WCAG 2.1 contrast math; ratios noted are `(text or icon) vs
--color-bg` unless stated otherwise. Target: **≥ 4.5:1** for any text/icon
that conveys information (AA, normal text), **≥ 3:1** for non-text UI
boundaries that convey meaning (focus rings, interactive borders).

## Color

### Surfaces

| Token | Value | Usage |
|---|---|---|
| `--color-bg` | `#0B0E14` | App background, main stream panel |
| `--color-surface-sidebar` | `#0D1017` | Sidebar background (barely lighter than base — subtle separation only) |
| `--color-surface-topbar` | `#0D1017` | Top bar background |
| `--color-surface-row-hover` | `#131820` | Stream row hover/focus background |
| `--color-surface-row-expanded-panel` | `#0E121A` | Inset background of the expanded row's body/context viewport |
| `--color-border` | `#1E2530` | Decorative dividers (sidebar/topbar separators, row bottom rule) |
| `--color-border-interactive` | `#2A3341` | Borders on inputs, buttons, drop area (default, non-hover) — 3.1:1 vs bg, meets non-text contrast |

### Text

| Token | Value | Usage | Contrast vs bg |
|---|---|---|---|
| `--color-text-primary` | `#E8EAED` | Message text, source names, primary labels | 16.0:1 |
| `--color-text-muted` | `#7A8494` | Timestamps, secondary labels, entry counts, placeholder text | 5.1:1 |
| `--color-text-inverse` | `#0B0E14` | Text on filled/inverted surfaces (FATAL chip fill) | — |

### Level accents (the core visual grammar)

Each level gets one accent color, used for: the row's left edge bar, the
level word in the row, and the level filter chip. Colors chosen so every one
independently clears 4.5:1 against `--color-bg`.

| Level | Token | Value | Contrast vs bg |
|---|---|---|---|
| DEBUG | `--color-level-debug` | `#58A6FF` (blue) | 7.7:1 |
| INFO | `--color-level-info` | `#3FE0A5` (green) | 11.4:1 |
| WARN | `--color-level-warn` | `#F5B84E` (amber) | 10.9:1 |
| ERROR | `--color-level-error` | `#FF6B4A` (red-orange) | 6.9:1 |
| FATAL | `--color-level-fatal` | `#FF6B4A` (same hue as ERROR) | 6.9:1 |
| UNKNOWN | `--color-level-unknown` | `#9BA4B0` (gray) | 7.7:1 |

FATAL intentionally reuses ERROR's hue per the phase doc ("ERROR / FATAL: red-orange")
— they are distinguished by **weight/fill**, not color: ERROR renders as
colored text on transparent background; FATAL renders as a filled chip
(`--color-level-fatal` background, `--color-text-inverse` text) so the most
severe entries are still visually louder even though the hue is shared. See
design-reviews note in spec 001 for rationale.

### Interactive / focus

| Token | Value | Usage |
|---|---|---|
| `--color-accent-interactive` | `#58A6FF` | "↓ Live" jump-back button, active/pressed states on chips and toggles, links. Deliberately reuses `--color-level-debug`'s value — the two never appear in the same visual context (one is a row accent, the other is floating UI chrome), and blue-as-actionable is a standard, low-risk convention. |
| `--color-focus-ring` | `#FFFFFF` | 2px solid focus outline, 2px offset, on every interactive element. Contrast vs bg: 16.0:1. |

### Syntax highlighting (expanded row body/context viewport)

highlight.js is configured with only the `json` and `plaintext` grammars
registered (not the full ~190-language bundle) to keep bundle size minimal —
this is the "small grammar set" the phase doc calls for. Color mapping reuses
existing tokens rather than introducing new ones:

| Syntax role | Token | Applies to |
|---|---|---|
| Key / attribute name | `--color-text-primary` | JSON object keys |
| String value | `--color-level-info` | JSON string values |
| Number (`hljs-number`) | `--color-level-warn` | JSON numeric values |
| Punctuation (`{ } [ ] : ,`) | `--color-text-muted` | JSON structural characters |
| Literal (`hljs-literal`: `null`, `true`, `false`) | `--color-level-debug` | JSON `null`/`true`/`false` |
| Plaintext body (non-JSON, e.g. a raw stack trace) | `--color-text-primary` | Rendered monospace, no additional coloring |

Resolved 2026-07-19: the two rows above previously both claimed `true`/
`false` (a contradiction between "number/literal" and "null/boolean").
Product owner approved the frontend's implemented split — `hljs-number` is
purely numeric values → `--color-level-warn`; `hljs-literal` covers
`null`/`true`/`false` → `--color-level-debug`. Table corrected to match.

## Typography

Self-hosted via `@fontsource/jetbrains-mono` — no CDN fonts, works fully
offline. Only two static weight files are loaded (400, 700) to keep the
bundle small; no italic.

| Token | Value |
|---|---|
| `--font-family-mono` | `"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace` |
| `--font-weight-regular` | `400` |
| `--font-weight-bold` | `700` |
| `--font-size-xs` | `11px` — badges, entry counts |
| `--font-size-sm` | `12px` — timestamps, muted labels |
| `--font-size-base` | `13px` — message text, level word, source name, body/code viewport |
| `--font-size-lg` | `15px` — section headers ("LOG SOURCES", "UNIFIED LOG STREAM") |
| `--line-height-tight` | `1.2` — single-line row text |
| `--line-height-relaxed` | `1.5` — expanded body/code viewport |
| `--letter-spacing-label` | `0.08em` — applied with uppercase transform on section headers and level words |

The entire UI is set in the monospace family, including chrome (buttons,
labels) — not just log content — matching the concept art.

## Spacing

4px base scale.

| Token | Value |
|---|---|
| `--space-1` | `4px` |
| `--space-2` | `8px` |
| `--space-3` | `12px` |
| `--space-4` | `16px` |
| `--space-5` | `20px` |
| `--space-6` | `24px` |
| `--space-8` | `32px` |
| `--space-12` | `48px` |

## Radius

| Token | Value | Usage |
|---|---|---|
| `--radius-sm` | `4px` | Checkboxes, level chips (in-row) |
| `--radius-md` | `8px` | Buttons, search input, expanded-row code viewport |
| `--radius-lg` | `12px` | Drop area |
| `--radius-pill` | `999px` | Visibility toggle switch, top-bar level filter chips |

## Layout & row metrics

| Token | Value |
|---|---|
| `--sidebar-width` | `288px` (fixed — desktop-only layout, confirmed by product owner, no responsive breakpoints in phase 1) |
| `--topbar-height` | `56px` |
| `--filter-row-height` | `36px` |
| `--row-height-collapsed` | `40px` (fixed height fed to TanStack Virtual's row estimate) |
| `--row-padding-x` | `16px` |
| `--row-padding-y` | `12px` |
| `--row-left-edge-width` | `4px` |
| `--row-expanded-max-height` | `420px` (internal scroll beyond this) |
| `--toggle-width` / `--toggle-height` | `36px` / `20px` |
| `--toggle-thumb-size` | `16px` |
| `--checkbox-size` | `16px` |

## Motion

| Token | Value | Usage |
|---|---|---|
| `--motion-fast` | `120ms ease-out` | Hover/focus transitions |
| `--motion-base` | `200ms ease-out` | Row expand/collapse height animation, drag-over overlay fade |
| `--debounce-search` | `250ms` | Search input debounce |

## Z-index

| Token | Value | Usage |
|---|---|---|
| `--z-dragover-overlay` | `40` | Full-viewport drag-over overlay |
| `--z-jump-button` | `50` | "↓ Live" floating button |
| `--z-toast` | `100` | Transient toasts (dropped-entries notice, clear confirmation) |

## Iconography

**No icon library is on the dependency allowlist.** All icons (docker whale
mark, generic file, cloud-upload, magnifier, trash, pause/play, chevron) are
hand-authored inline SVG at 16–20px, single-color, using `currentColor` so
they inherit the token color of their context (e.g. a level-colored source
icon isn't a thing — icons are always neutral `--color-text-primary` or
`--color-text-muted`; only text/edges/chips carry level color). This requires
no new dependency.
