import { useEffect, useState } from "react";
import { strings } from "./strings.ts";
import { SignedOut } from "./SignedOut.tsx";

type View = "loading" | "signedOut";

export function App() {
  const [view, setView] = useState<View>("loading");

  useEffect(() => {
    fetch("/api/me").then(() => setView("signedOut"), () => setView("signedOut"));
  }, []);

  return (
    <div className="app">
      <header className="rs-topbar">
        <span className="rs-topbar__brand">{strings.brand}</span>
      </header>
      {view === "loading" ? <main className="page" aria-busy="true" aria-label={strings.loading} /> : <SignedOut />}
      <footer className="footer">{strings.footer}</footer>
    </div>
  );
}
