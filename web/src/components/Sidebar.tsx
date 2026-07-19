import { useOrderedSources } from "../store/store";
import SourceRow from "./SourceRow";
import DropArea from "./DropArea";
import "./Sidebar.css";

export default function Sidebar() {
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
        {sources.length === 0 ? (
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
