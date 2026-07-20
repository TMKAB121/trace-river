import { useFileSources } from "../store/store";
import SourceRow from "./SourceRow";

/**
 * "Files" sidebar sub-section (spec 002 § Layout). Only ever rendered when
 * Docker is enabled — otherwise file sources render in phase 1's flat list.
 * The row rendering itself is exactly spec 001's `SourceRow`, unchanged.
 */
export default function FilesSection() {
  const files = useFileSources();

  return (
    <section aria-labelledby="files-heading" className="files-section">
      <h3 id="files-heading" className="sidebar-subsection__heading">
        Files
      </h3>
      {files.length === 0 ? (
        <p className="sidebar-subsection__empty">(no files yet)</p>
      ) : (
        <ul className="sidebar-subsection__list">
          {files.map((source) => (
            <SourceRow key={source.id} source={source} />
          ))}
        </ul>
      )}
    </section>
  );
}
