import type { SourceDescriptor } from "../types";
import { useAppStore } from "../store/store";
import { IconDocker, IconFile } from "./icons";
import "./SourceRow.css";

function KindIcon({ kind }: { kind: SourceDescriptor["kind"] }) {
  if (kind === "docker") return <IconDocker size={18} />;
  return <IconFile size={18} />;
}

/** Docker-only tooltip metadata addition (spec 002 § Components & states —
 *  Container source row): `"<image> · <composeProject>/<composeService>"`. */
function dockerMetadataText(source: SourceDescriptor): string | null {
  if (!source.docker) return null;
  const { image, composeProject, composeService } = source.docker;
  if (composeProject && composeService) {
    return `${image} · ${composeProject}/${composeService}`;
  }
  return image;
}

/** The row's `title` attribute: a file's existing error-detail tooltip
 *  (spec 001), extended for docker sources with image/compose metadata
 *  (spec 002). Has no effect on the collapsed row's fixed layout/width. */
function rowTitle(source: SourceDescriptor): string | undefined {
  const parts: string[] = [];
  if (source.kind === "docker") {
    const meta = dockerMetadataText(source);
    if (meta) parts.push(meta);
  }
  if (source.state === "error" && source.detail) {
    parts.push(source.detail);
  }
  return parts.length > 0 ? parts.join(" — ") : undefined;
}

export default function SourceRow({ source }: { source: SourceDescriptor }) {
  const { actions } = useAppStore();

  const dimmed = !source.subscribed;
  // State label is scoped to docker sources only (spec 002 § Components &
  // states — Container source row); file-source rows are unchanged from
  // spec 001 (error still surfaces only via the tooltip above).
  const stateLabel =
    source.kind === "docker" && (source.state === "stopped" || source.state === "error") ? source.state : null;

  return (
    <li className={`source-row${dimmed ? " source-row--dimmed" : ""}`} title={rowTitle(source)}>
      <div className="source-row__main">
        <input
          type="checkbox"
          className="source-row__checkbox"
          checked={source.subscribed}
          aria-label={`Subscribe to ${source.id}`}
          onChange={(e) => actions.setSourceSubscribed(source.id, e.target.checked)}
        />
        <span className="source-row__icon" aria-hidden>
          <KindIcon kind={source.kind} />
        </span>
        <span className="source-row__label">{source.label}</span>
        <span className="source-row__count">{source.entryCount}</span>
        <button
          type="button"
          role="switch"
          aria-checked={source.subscribed && source.visible}
          aria-label={`Show ${source.id} in stream`}
          className="source-row__toggle"
          disabled={!source.subscribed}
          onClick={() => actions.setSourceVisible(source.id, !source.visible)}
        >
          <span className="source-row__toggle-thumb" />
        </button>
      </div>
      {stateLabel && (
        <span className={`source-row__state-label source-row__state-label--${stateLabel}`}>
          {stateLabel === "stopped" ? "Stopped" : "Error"}
        </span>
      )}
    </li>
  );
}
