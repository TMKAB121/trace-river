import {
  useDiscoveryAvailability,
  useDockerAvailability,
  useEnvironmentSources,
  useFrameworks,
  useOrderedSources,
} from "../store/store";
import SourceRow from "./SourceRow";
import DropArea from "./DropArea";
import ContainersSection from "./ContainersSection";
import FilesSection from "./FilesSection";
import EnvironmentSection from "./EnvironmentSection";
import "./Sidebar.css";

export default function Sidebar() {
  const dockerAvailability = useDockerAvailability();
  const discoveryAvailability = useDiscoveryAvailability();
  const frameworks = useFrameworks();
  const environmentSources = useEnvironmentSources();
  const sources = useOrderedSources();

  // Spec 003 § Components & states — "the three-vs-flat-list rule from
  // spec 002 extends unchanged in spirit: when docker.enabled: false and
  // discovery.enabled: false (or discovery enabled but nothing found and no
  // environment sources), the sidebar reverts to spec 001's flat,
  // unsectioned list." `discoveryAvailability === "unknown"` (still
  // settling) is treated the same as "enabled", mirroring
  // `dockerAvailability`'s existing unknown-treated-as-not-disabled
  // precedent (design review 002 Finding 2) — never flash the flat layout
  // before genuinely learning both features are off/empty.
  const flat =
    dockerAvailability === "disabled" &&
    (discoveryAvailability === "disabled" ||
      (discoveryAvailability === "enabled" && frameworks.length === 0 && environmentSources.length === 0));

  return (
    <aside aria-label="Log sources" className="sidebar">
      <img
        className="sidebar__logo"
        src="/logo.png"
        alt="TraceRiver — local log console"
      />
      <h2 className="sidebar__header">Log Sources</h2>
      <div className="sidebar__list-wrap">
        {!flat ? (
          <div className="sidebar__sections">
            {/* Containers gating is unchanged from spec 002 (docker.enabled) —
             *  entering sectioned mode via discovery alone (docker disabled)
             *  must not conjure a Containers section. */}
            {dockerAvailability !== "disabled" && <ContainersSection />}
            <FilesSection />
            <EnvironmentSection />
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
