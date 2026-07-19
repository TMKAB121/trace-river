# Defect 001-phase-1-core-console-3

**Area:** frontend
**Severity:** low
**Status:** verified-fixed
**Spec:** `docs/specs/001-phase-1-core-console.md` acceptance criterion 11 and § Components & states § Top bar.

## Resolution

Product owner ruled this in scope; fixed by frontend-developer in
`web/src/components/FreezeButton.tsx`, now:

```tsx
{state.frozen && newCount > 0 && <span className="topbar-btn__badge">· {newCount} new</span>}
```

**Re-verified by QA:**
- Static source read confirms the `"· "` prefix is now present.
- Confirmed the fix is present in the **rebuilt production bundle**
  (`npm run build`), not just source: `grep`ping
  `dist/web/assets/index-*.js` finds
  `className:"topbar-btn__badge",children:["· ",n," new"]` — the exact
  string QA had flagged as missing is present in what would actually ship.
- Not re-verified via a rendered screenshot of the live frozen/accumulating
  state — driving that state still requires click/drag interaction the
  available headless-browser tool (`tools/browser.js`) cannot script
  (confirmed unchanged from the original QA pass — see the test plan's
  notes on this limitation). The static source + built-bundle checks above
  are the full extent of what's reachable without that capability.

## Summary

The spec's acceptance criterion 11 states: "the button shows an accurate
accumulating **'· n new'** count while frozen" (the middle-dot separator is
part of the quoted, testable copy — it also appears in the spec's Top-bar
component description: `▶ Resume · 42 new`, and in the wireframe).

The implemented badge renders **`{n} new`** with no separator:

`web/src/components/FreezeButton.tsx`:
```tsx
{state.frozen && newCount > 0 && <span className="topbar-btn__badge">{newCount} new</span>}
```

So the rendered text reads "Resume" (button label) next to a separate pill
reading "42 new" — functionally correct (accurate accumulating count, only
shown while frozen) but the literal "· " prefix specified in the acceptance
criterion's copy is missing.

## Impact

Low — the count is still accurate and legible, and the badge already reads
as a visually distinct pill next to the label, so the missing character
doesn't create ambiguity. Filed because criterion 11 quotes exact copy as
part of a numbered, testable acceptance criterion, so this is an objective
mismatch against the spec as written, not a stylistic preference.

## Verification

Confirmed via source read (no interaction needed): `FreezeButton.tsx` line
18. Not independently re-verified via rendered screenshot because driving
the "frozen with accumulating entries" state requires live WS traffic during
an active `dragenter`/click sequence, which the available headless-browser
tool (`tools/browser.js`) cannot script (navigation/screenshot only, no
click/drag simulation) — see the test plan's notes on this limitation.

## Open question (resolved)

Was: whether to add the "· " separator to match the spec's literal copy, or
treat the spec's copy as illustrative and leave the implementation as-is.
Resolved by the product owner: fix it — see Resolution above.
