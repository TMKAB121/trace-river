import { useDockerAvailability, useOrderedSources } from "../store/store";
import SourceRow from "./SourceRow";
import DropArea from "./DropArea";
import ContainersSection from "./ContainersSection";
import FilesSection from "./FilesSection";
import "./Sidebar.css";

export default function Sidebar() {
  const dockerAvailability = useDockerAvailability();
  const sources = useOrderedSources();

  return (
    <aside aria-label="Log sources" className="sidebar">
      <img
        className="sidebar__logo"
        src="/logo.png"
        alt="TraceRiver — local log console"
      />
      <h2 className="sidebar__header">Log Sources</h2>
      <div className="sidebar__list-wrap">
        {dockerAvailability !== "disabled" ? (
          // Spec 002 § Layout: sidebar splits into Containers/Files
          // sub-sections whenever Docker isn't known to be disabled — this
          // covers both "enabled" and the brief "unknown" window before that
          // is settled (design review 002 Finding 2), so the loading state
          // is the sectioned "Checking Docker…" treatment, never the flat
          // phase-1 fallback below. That fallback is reserved for the
          // genuinely-settled `docker.enabled: false` case.
          <div className="sidebar__sections">
            <ContainersSection />
            <FilesSection />
          </div>
        ) : sources.length === 0 ? (
          <p className="sidebar__empty">(no sources yet)</p>
        ) : (
          <ul className="sidebar__list">
            {sources.map((source) => (
              <SourceRow key={source.id} source={source} />
            ))}
          </ul>
        )}
      </div>
      <div className="sidebar__divider" role="separator" />
      <DropArea />
    </aside>
  );
}
