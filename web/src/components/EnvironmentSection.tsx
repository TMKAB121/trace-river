import { useEnvironmentSources } from "../store/store";
import SourceRow from "./SourceRow";
import "./EnvironmentSection.css";

/**
 * "Environment" sidebar sub-section (spec 003 § Layout / § Components &
 * states) — macOS-only, cross-project sources (Herd/Valet/Homebrew nginx or
 * PHP-FPM), all unchecked by default. Renders only when at least one
 * environment-scope source was discovered; per the product owner (spec 003
 * § Open Questions #1), it is omitted entirely — no header, no "nothing
 * found" copy — when empty, unlike Containers' always-show-a-status-card
 * pattern.
 */
export default function EnvironmentSection() {
  const sources = useEnvironmentSources();

  if (sources.length === 0) return null;

  return (
    <section aria-labelledby="environment-heading" className="environment-section">
      <h3 id="environment-heading" className="sidebar-subsection__heading">
        Environment
      </h3>
      <ul className="sidebar-subsection__list">
        {sources.map((source) => (
          <SourceRow key={source.id} source={source} />
        ))}
      </ul>
    </section>
  );
}
