import { useCallback, useEffect, useMemo, useState } from "react";
import { AddScrobbles, ScrobbleTransportContext } from "@rescrobble/scrobble-ui";
import { createApi, loadApiKey } from "./backend.ts";
import { clearSession, loadSession, signIn, type StoredSession } from "./session.ts";
import { strings } from "./strings.ts";

type Screen = "history" | "add" | "jobs" | "changeLog";

type View =
  | { kind: "loading" }
  | { kind: "signedOut"; notice?: string }
  | { kind: "signedIn"; session: StoredSession; pro: boolean | null };

const screens: Screen[] = ["history", "add", "jobs", "changeLog"];
const screenLabels: Record<Screen, string> = {
  history: strings.nav.history,
  add: strings.nav.add,
  jobs: strings.nav.jobs,
  changeLog: strings.nav.changeLog,
};

export function App() {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [screen, setScreen] = useState<Screen>("history");
  const [busy, setBusy] = useState(false);

  const endSession = useCallback(() => {
    void clearSession();
    setView({ kind: "signedOut", notice: strings.sessionEnded });
  }, []);

  const enter = useCallback(async (session: StoredSession) => {
    const api = createApi(session.token, endSession);
    const response = await api("/api/me").catch(() => null);
    if (response?.status === 401) return;
    const me = response?.ok ? ((await response.json()) as { pro: boolean | null }) : { pro: null };
    setView({ kind: "signedIn", session, pro: me.pro });
  }, [endSession]);

  useEffect(() => {
    loadSession().then((session) => (session ? enter(session) : setView({ kind: "signedOut" })));
  }, [enter]);

  async function logIn() {
    setBusy(true);
    try {
      await enter(await signIn());
    } catch {
      setView({ kind: "signedOut", notice: strings.signIn.failed });
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await clearSession();
    setView({ kind: "signedOut" });
  }

  const transport = useMemo(
    () => (view.kind === "signedIn" ? { api: createApi(view.session.token, endSession), loadApiKey } : null),
    [view, endSession],
  );

  if (view.kind === "loading") return <main className="sign-in" aria-busy="true" aria-label={strings.loading} />;

  if (view.kind === "signedOut") {
    const s = strings.signIn;
    return (
      <main className="sign-in">
        {view.notice && (
          <div className="rs-notice rs-notice--warn" role="status">
            <svg className="rs-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path d="M8 7.5v3.5M8 5h.01" /></svg>
            <span>{view.notice}</span>
          </div>
        )}
        <h1>{s.heading}</h1>
        <p>{s.intro}</p>
        <button type="button" className="rs-btn rs-btn--primary rs-btn--block" onClick={logIn} aria-busy={busy || undefined}>
          {s.logIn}
        </button>
        <p className="rs-hint">{s.privacy}</p>
        <p className="rs-hint">{strings.footer}</p>
      </main>
    );
  }

  return (
    <div className="shell">
      <nav className="rs-rail" aria-label={strings.nav.label}>
        <div className="rs-rail__brand">{strings.brand}</div>
        {screens.map((name) => (
          <a
            key={name}
            href={`#${name}`}
            className="rs-rail__link"
            aria-current={screen === name ? "page" : undefined}
            onClick={(e) => {
              e.preventDefault();
              setScreen(name);
            }}
          >
            {screenLabels[name]}
          </a>
        ))}
        <div className="rs-rail__foot">
          <span className="account">{view.session.username}</span>
          {view.pro !== null && <span>{view.pro ? strings.account.pro : strings.account.free}</span>}
          <button type="button" className="rs-btn rs-btn--quiet sign-out" onClick={signOut}>{strings.account.signOut}</button>
        </div>
      </nav>
      <main className="work">
        {screen === "add" && transport ? (
          <ScrobbleTransportContext value={transport}>
            <div className="add-page"><AddScrobbles /></div>
          </ScrobbleTransportContext>
        ) : (
          <h1 className="placeholder">{screenLabels[screen]}</h1>
        )}
      </main>
    </div>
  );
}
