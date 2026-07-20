import { IconDocker, IconX } from "./icons";
import type { DockerStatus } from "../types";
import "./DockerStatusCard.css";

type FailureStatus = Exclude<DockerStatus, "connected">;

const COPY: Record<FailureStatus, { heading: string; body: (detail: string | null) => string }> = {
  not_installed: {
    heading: "Docker not detected",
    body: () => "Install Docker Desktop, or start your daemon, to see this project's containers here.",
  },
  not_running: {
    heading: "Docker not running",
    body: () => "Start Docker to see this project's containers.",
  },
  permission_denied: {
    heading: "Permission denied",
    body: (detail) => `TraceRiver can't access the Docker socket.${detail ? ` ${detail}` : ""}`,
  },
};

/**
 * Dismissible Docker daemon-status card (spec 002 § Components & states —
 * Docker status card). Distinguished by heading text + icon color, never by
 * color alone (design-system.md § Accessibility).
 */
export default function DockerStatusCard({
  status,
  detail,
  onDismiss,
}: {
  status: FailureStatus;
  detail: string | null;
  onDismiss: () => void;
}) {
  const copy = COPY[status];
  const isWarn = status === "permission_denied";

  return (
    <div className={`docker-status-card${isWarn ? " docker-status-card--warn" : ""}`}>
      <div className="docker-status-card__header">
        <span className="docker-status-card__icon" aria-hidden>
          <IconDocker size={18} />
        </span>
        <p className="docker-status-card__heading">{copy.heading}</p>
        <button
          type="button"
          className="docker-status-card__dismiss"
          aria-label="Dismiss Docker status message"
          onClick={onDismiss}
        >
          <IconX size={14} />
        </button>
      </div>
      <p className="docker-status-card__body">{copy.body(detail)}</p>
      <p className="docker-status-card__retry">Retrying automatically…</p>
    </div>
  );
}
