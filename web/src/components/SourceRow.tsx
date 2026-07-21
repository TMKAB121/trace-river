import type { SourceDescriptor } from "../types";
import { useAppStore, useSourceErrorCount, useSourceSpiking } from "../store/store";
import { IconDocker, IconFile } from "./icons";
import SpikingBadge from "./SpikingBadge";
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

/** Local-source tooltip text (spec 003 § Components & states — Local source
 *  row): resolved absolute target path, plus a trailing config note when
 *  `local.origin === "config"`, or the state-label detail text appended
 *  instead (config suffix omitted then — `detail` already carries the
 *  operative information). */
function localTooltipText(source: SourceDescriptor): string | null {
  if (!source.local) return null;
  const { targetPath, origin } = source.local;
  if (source.detail) return `${targetPath} — ${source.detail}`;
  if (origin === "config") return `${targetPath} · configured via traceriver.json`;
  return targetPath;
}

/** The row's `title` attribute: a file's existing error-detail tooltip
 *  (spec 001), extended for docker sources with image/compose metadata
 *  (spec 002), and for local sources with the resolved target path +
 *  config/detail note (spec 003). Has no effect on the collapsed row's
 *  fixed layout/width. */
function rowTitle(source: SourceDescriptor): string | undefined {
  if (source.kind === "local") {
    return localTooltipText(source) ?? undefined;
  }
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

const STATE_LABEL_TEXT: Record<"pending" | "stopped" | "error", string> = {
  pending: "Waiting",
  stopped: "Stopped",
  error: "Error",
};

export default function SourceRow({ source }: { source: SourceDescriptor }) {
  const { actions } = useAppStore();
  const errorCount = useSourceErrorCount(source.id);
  const spiking = useSourceSpiking(source.id);

  const dimmed = !source.subscribed;
  // State label is scoped to docker and local sources (spec 002 §
  // Components & states — Container source row, extended by spec 003 §
  // Components & states — Local source row to also cover "pending"); file-
  // source rows are unchanged from spec 001 (error still surfaces only via
  // the tooltip above).
  const stateLabel =
    (source.kind === "docker" || source.kind === "local") &&
    (source.state === "pending" || source.state === "stopped" || source.state === "error")
      ? source.state
      : null;

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
        {errorCount > 0 && (
          <button
            type="button"
            className="source-row__error-badge"
            aria-label={`${errorCount} errors from ${source.id} — filter stream to these`}
            onClick={() => actions.setScopeSource(source.id)}
          >
            {errorCount}
          </button>
        )}
        {spiking && <SpikingBadge />}
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
          {STATE_LABEL_TEXT[stateLabel]}
        </span>
      )}
    </li>
  );
}
