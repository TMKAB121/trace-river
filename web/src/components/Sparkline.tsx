import { describeOccurrencePattern } from "../utils/occurrencePattern";
import "./Sparkline.css";

// Internal SVG coordinate space — matches --sparkline-width/height's pixel
// values (design-system.md § Layout & row metrics); the *rendered* size is
// driven entirely by the CSS tokens via Sparkline.css, this is only the
// drawing math's coordinate system.
const VIEW_WIDTH = 64;
const VIEW_HEIGHT = 20;

/**
 * Inline SVG occurrence-rate trend (docs/specs/004-phase-4-error-intelligence.md
 * § Components & states — ErrorGroup card § Sparkline): self-scaled to the
 * group's own perMinute min/max within its own 30-point window, not
 * normalized across cards. `aria-hidden` — the count and the tooltip's text
 * summary carry the same information in text form, so the chart itself is
 * decorative.
 */
export default function Sparkline({ perMinute, level }: { perMinute: number[]; level: "ERROR" | "FATAL" }) {
  const title = describeOccurrencePattern(perMinute);
  const levelKey = level.toLowerCase();

  if (perMinute.length === 0 || Math.max(...perMinute) === Math.min(...perMinute)) {
    // Flat/empty window (e.g. a group with only its first occurrence so
    // far) renders a flat baseline rather than an empty box.
    return (
      <svg
        className="sparkline"
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        aria-hidden="true"
        focusable="false"
      >
        <title>{title}</title>
        <line
          x1={0}
          y1={VIEW_HEIGHT / 2}
          x2={VIEW_WIDTH}
          y2={VIEW_HEIGHT / 2}
          className={`sparkline__line sparkline__line--${levelKey}`}
        />
      </svg>
    );
  }

  const max = Math.max(...perMinute);
  const min = Math.min(...perMinute);
  const range = max - min;
  const points = perMinute
    .map((v, i) => {
      const x = perMinute.length === 1 ? 0 : (i / (perMinute.length - 1)) * VIEW_WIDTH;
      const y = VIEW_HEIGHT - ((v - min) / range) * VIEW_HEIGHT;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg className="sparkline" viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} aria-hidden="true" focusable="false">
      <title>{title}</title>
      <polyline points={points} className={`sparkline__line sparkline__line--${levelKey}`} fill="none" />
    </svg>
  );
}
