import { useFileSources, useFrameworks } from "../store/store";
import SourceRow from "./SourceRow";
import { IconInfo } from "./icons";
import "./FilesSection.css";

/**
 * "Files" sidebar sub-section (spec 002 § Layout, extended by spec 003 §
 * Layout/§ Components & states). Only ever rendered in the sectioned
 * sidebar layout — otherwise file/local sources render in phase 1's flat
 * list. Renders, in order: uploaded-file rows plus `kind: "local"` sources
 * whose `local.scope` is "project" or "config" (spec 001's `SourceRow`,
 * unchanged), then one line per no-file-target detector match (Next.js/Go/
 * Django), static text, no checkbox.
 */
export default function FilesSection() {
  const files = useFileSources();
  const notes = useFrameworks().filter((f) => !f.hasFileTarget);
  const isEmpty = files.length === 0 && notes.length === 0;

  return (
    <section aria-labelledby="files-heading" className="files-section">
      <h3 id="files-heading" className="sidebar-subsection__heading">
        Files
      </h3>
      {isEmpty ? (
        <p className="sidebar-subsection__empty">(no files yet)</p>
      ) : (
        <>
          {files.length > 0 && (
            <ul className="sidebar-subsection__list">
              {files.map((source) => (
                <SourceRow key={source.id} source={source} />
              ))}
            </ul>
          )}
          {notes.length > 0 && (
            <div className="files-section__notes">
              {notes.map((framework) => (
                <p key={framework.detector} className="files-section__note">
                  <span className="files-section__note-icon" aria-hidden>
                    <IconInfo size={16} />
                  </span>
                  <span>{framework.note}</span>
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
