import type { SourceDescriptor } from "../types";
import { useAppStore } from "../store/store";
import { IconDocker, IconFile } from "./icons";
import "./SourceRow.css";

function KindIcon({ kind }: { kind: SourceDescriptor["kind"] }) {
  if (kind === "docker") return <IconDocker size={18} />;
  return <IconFile size={18} />;
}

export default function SourceRow({ source }: { source: SourceDescriptor }) {
  const { actions } = useAppStore();

  const dimmed = !source.subscribed;

  return (
    <li
      className={`source-row${dimmed ? " source-row--dimmed" : ""}`}
      title={source.state === "error" && source.detail ? source.detail : undefined}
    >
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
    </li>
  );
}
