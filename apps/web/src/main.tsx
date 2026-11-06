import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@rescrobble/ui/tokens.css";
import "@rescrobble/ui/components.css";
import "@rescrobble/scrobble-ui/scrobble-ui.css";
import "./app.css";
import { App } from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
