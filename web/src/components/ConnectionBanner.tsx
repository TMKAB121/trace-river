import { useAppStore } from "../store/store";
import "./ConnectionBanner.css";

export default function ConnectionBanner() {
  const { state } = useAppStore();

  if (state.connection === "connected") return null;

  if (state.connection === "connecting") {
    return <div className="connection-banner">Connecting…</div>;
  }

  if (state.connection === "disconnected") {
    return <div className="connection-banner">Disconnected — retrying…</div>;
  }

  // "invalid-token": terminal state, distinct copy, no retry loop.
  return (
    <div className="connection-banner connection-banner--error">
      Invalid or expired session. Reopen the console from the CLI.
    </div>
  );
}
