import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Self-hosted JetBrains Mono — only the two static weights the design
// system calls for (400, 700), no italics, no CDN (docs/design-system.md
// § Typography). Must work fully offline.
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";

import "./styles/tokens.css";
import "./styles/reset.css";
import "./styles/global.css";
import "./styles/highlight.css";

import { AppStoreProvider } from "./store/store";
import App from "./App";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("#root element not found");
}

createRoot(rootEl).render(
  <StrictMode>
    <AppStoreProvider>
      <App />
    </AppStoreProvider>
  </StrictMode>,
);
