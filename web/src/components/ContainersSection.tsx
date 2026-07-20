import { useMemo, type ReactNode } from "react";
import { useAppStore, useContainerSources } from "../store/store";
import SourceRow from "./SourceRow";
import DockerStatusCard from "./DockerStatusCard";
import "./ContainersSection.css";

/**
 * "Containers" sidebar sub-section (spec 002 § Layout / § Components &
 * states). Renders, in priority order: the loading placeholder (before the
 * first `dockerStatus` message), the daemon-status card (replacing rows
 * entirely, header toggle omitted), or the container rows / empty copy.
 */
export default function ContainersSection() {
  const { state, actions } = useAppStore();
  const containerSources = useContainerSources();
  const status = state.dockerStatus;

  const visibleContainers = useMemo(
    () => containerSources.filter((s) => state.showAllContainers || s.docker?.inCurrentProject !== false),
    [containerSources, state.showAllContainers],
  );

  let card: ReactNode = null;
  if (status !== null && status !== "connected" && !state.dismissedDockerStatuses.has(status)) {
    card = (
      <DockerStatusCard
        status={status}
        detail={state.dockerStatusDetail}
        onDismiss={() => actions.dismissDockerStatusCard(status)}
      />
    );
  }

  const isLoading = status === null;
  // The header's toggle has nothing to toggle while a status card is
  // showing (spec 002 § Layout — "the section header and its toggle are
  // omitted while a card is showing").
  const showToggle = !isLoading && card === null;

  return (
    <section aria-labelledby="containers-heading" className="containers-section">
      <div className="containers-section__header">
        <h3 id="containers-heading" className="sidebar-subsection__heading">
          Containers
        </h3>
        {showToggle && (
          <button
            type="button"
            role="switch"
            aria-checked={state.showAllContainers}
            aria-label="Show all containers"
            className="containers-section__toggle"
            onClick={() => actions.toggleShowAllContainers()}
          >
            <span className="containers-section__toggle-label">Show all containers</span>
            <span className="containers-section__toggle-switch">
              <span className="containers-section__toggle-thumb" />
            </span>
          </button>
        )}
      </div>

      {isLoading && <p className="sidebar-subsection__empty">Checking Docker…</p>}

      {card}

      {!isLoading && card === null && visibleContainers.length === 0 && (
        <p className="sidebar-subsection__empty">No containers found in this project.</p>
      )}

      {!isLoading && card === null && visibleContainers.length > 0 && (
        <ul className="sidebar-subsection__list">
          {visibleContainers.map((source) => (
            <SourceRow key={source.id} source={source} />
          ))}
        </ul>
      )}
    </section>
  );
}
