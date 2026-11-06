import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiContext, createApi } from "./api.ts";
import { strings } from "./strings.ts";
import { SignedOut } from "./SignedOut.tsx";
import { SignedIn } from "./SignedIn.tsx";

type View =
  | { kind: "loading" }
  | { kind: "signedOut"; notice?: string }
  | { kind: "signedIn"; username: string };

/**
 * The backend adds `?signIn=failed` when a Last.fm sign-in doesn't complete. Reading it has no side effect,
 * and it is removed only once the notice is on screen, so a refresh doesn't repeat it.
 */
function hasSignInFailure(): boolean {
  return new URLSearchParams(window.location.search).get("signIn") === "failed";
}

function clearSignInFailure() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("signIn")) return;
  url.searchParams.delete("signIn");
  window.history.replaceState(null, "", url);
}

export function App() {
  const [view, setView] = useState<View>({ kind: "loading" });
  const api = useMemo(
    () => createApi(() => setView({ kind: "signedOut", notice: strings.sessionEnded })),
    [],
  );

  useEffect(() => {
    const signedOut: View = { kind: "signedOut", notice: hasSignInFailure() ? strings.signedOut.signInFailed : undefined };
    fetch("/api/me")
      .then(async (response) => {
        if (!response.ok) return setView(signedOut);
        const me: { username: string } = await response.json();
        setView({ kind: "signedIn", username: me.username });
      })
      .catch(() => setView(signedOut))
      .finally(clearSignInFailure);
  }, []);

  const signOut = useCallback(async () => {
    const response = await api("/auth/logout", { method: "POST" });
    if (response.ok) setView({ kind: "signedOut" });
  }, [api]);

  return (
    <ApiContext value={api}>
      <div className="app">
        <header className="rs-topbar">
          <span className="rs-topbar__brand">{strings.brand}</span>
          {view.kind === "signedIn" && (
            <div className="rs-topbar__end">
              <span>{view.username}</span>
              <button type="button" className="rs-btn rs-btn--quiet" onClick={signOut}>{strings.signOut}</button>
            </div>
          )}
        </header>
        {view.kind === "loading" && <main className="page" aria-busy="true" aria-label={strings.loading} />}
        {view.kind === "signedOut" && <SignedOut notice={view.notice} />}
        {view.kind === "signedIn" && <SignedIn />}
        <footer className="footer">{strings.footer}</footer>
      </div>
    </ApiContext>
  );
}
