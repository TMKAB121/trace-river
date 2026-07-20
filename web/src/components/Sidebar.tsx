import { useDockerEnabled, useOrderedSources } from "../store/store";
import SourceRow from "./SourceRow";
import DropArea from "./DropArea";
import ContainersSection from "./ContainersSection";
import FilesSection from "./FilesSection";
import "./Sidebar.css";

export default function Sidebar() {
  const dockerEnabled = useDockerEnabled();
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
        {dockerEnabled ? (
          // Spec 002 § Layout: sidebar splits into Containers/Files
          // sub-sections once Docker is enabled server-side; the flat phase-1
          // list below is reserved for `docker.enabled: false`.
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
