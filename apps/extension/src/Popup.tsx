import { useCallback, useEffect, useMemo, useState } from "react";
import { browser } from "wxt/browser";
import { ScrobbleTransportContext, SessionResults, TrackForm, useSessionResults } from "@rescrobble/scrobble-ui";
import { createApi, loadApiKey } from "./backend.ts";
import { formatAgo, formatPlayedShort } from "./format.ts";
import { JobStore, type StoredJob } from "./jobs/jobStore.ts";
import { MirrorDb, type Scrobble } from "./mirror/db.ts";
import { APP_PATH, openApp } from "./openApp.ts";
import { clearSession, loadSession, type StoredSession } from "./session.ts";
import { strings } from "./strings.ts";

const p = strings.popup;

type View = { kind: "loading" } | { kind: "signedOut"; notice?: string } | { kind: "signedIn"; session: StoredSession };
type Tab = "add" | "recent";

/** Opens a screen of the full view and closes the popup, which can't outlive losing focus anyway. */
function openFullView(screen?: string) {
  void openApp(screen).then(() => window.close());
}

const WarnIcon = () => (
  <svg className="rs-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5l6 11H2l6-11z" /><path d="M8 7v3M8 12h.01" /></svg>
);

/**
 * The toolbar popup. It closes whenever it loses focus, so it only does what finishes at once: it adds
 * single scrobbles and reads what the full view has stored. Signing in, syncing and Jobs run in the full view.
 */
export function Popup() {
  const [view, setView] = useState<View>({ kind: "loading" });

  useEffect(() => {
    loadSession().then((session) => setView(session ? { kind: "signedIn", session } : { kind: "signedOut" }));
  }, []);

  const endSession = useCallback(() => {
    void clearSession();
    setView({ kind: "signedOut", notice: strings.sessionEnded });
  }, []);

  if (view.kind === "loading") return <main className="popup" aria-busy="true" aria-label={strings.loading} />;

  return (
    <main className="popup">
      <header className="popup__bar">
        <span className="rs-rail__brand">{strings.brand}</span>
        {view.kind === "signedIn" && <span className="account">{view.session.username}</span>}
        <button type="button" className="rs-btn rs-btn--quiet" title={p.fullViewHint} onClick={() => openFullView()}>
          <svg className="rs-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M9 2.5h4.5V7M13.5 2.5L8 8M6.5 3.5h-4v10h10v-4" /></svg>
          {p.fullView}
        </button>
      </header>
      {view.kind === "signedOut" ? <SignedOut notice={view.notice} /> : <SignedIn session={view.session} onUnauthorized={endSession} />}
    </main>
  );
}

function SignedOut({ notice }: { notice?: string }) {
  const s = strings.signIn;
  return (
    <div className="popup__body popup__sign-in">
      {notice && (
        <div className="rs-notice rs-notice--warn" role="status">
          <svg className="rs-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path d="M8 7.5v3.5M8 5h.01" /></svg>
          <span>{notice}</span>
        </div>
      )}
      <h1>{s.heading}</h1>
      <p>{s.intro}</p>
      <button type="button" className="rs-btn rs-btn--primary rs-btn--block" onClick={() => openFullView()}>{s.logIn}</button>
      <p className="rs-hint">{p.logInHint}</p>
    </div>
  );
}

function SignedIn({ session, onUnauthorized }: { session: StoredSession; onUnauthorized: () => void }) {
  const [tab, setTab] = useState<Tab>("add");
  const transport = useMemo(() => ({ api: createApi(session.token, onUnauthorized), loadApiKey }), [session, onUnauthorized]);

  return (
    <>
      <JobStrip user={session.username} />
      <div className="rs-tabs" role="tablist" aria-label={p.tabs.label}>
        {(["add", "recent"] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            id={`popup-tab-${name}`}
            className="rs-tab"
            aria-selected={tab === name}
            aria-controls={`popup-panel-${name}`}
            onClick={() => setTab(name)}
          >
            {p.tabs[name]}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`popup-panel-${tab}`} aria-labelledby={`popup-tab-${tab}`} className="popup__body">
        {tab === "add" ? (
          <ScrobbleTransportContext value={transport}>
            <AddTrack />
          </ScrobbleTransportContext>
        ) : (
          <Recent user={session.username} />
        )}
      </div>
    </>
  );
}

function AddTrack() {
  const session = useSessionResults();
  return (
    <div className="add-scrobbles">
      <TrackForm onResults={session.add} />
      {session.results.length > 0 && <SessionResults results={session.results} />}
      <p className="popup__more rs-hint">
        {p.album}{" "}
        <button type="button" className="link" onClick={() => openFullView("add")}>{p.continueInTab}</button>
      </p>
    </div>
  );
}

type RecentState = { kind: "loading" } | { kind: "empty" } | { kind: "ready"; scrobbles: Scrobble[]; lastSyncedAt: number | null };

const RECENT_COUNT = 10;

function Recent({ user }: { user: string }) {
  const [state, setState] = useState<RecentState>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    (async () => {
      const db = await MirrorDb.open();
      try {
        const sync = await db.state();
        const scrobbles = sync?.username === user ? await db.recent(RECENT_COUNT) : [];
        if (!live) return;
        setState(scrobbles.length > 0 ? { kind: "ready", scrobbles, lastSyncedAt: sync!.lastSyncedAt } : { kind: "empty" });
      } finally {
        db.close();
      }
    })().catch(() => live && setState({ kind: "empty" }));
    return () => {
      live = false;
    };
  }, [user]);

  if (state.kind === "loading") return <div aria-busy="true" />;

  if (state.kind === "empty") {
    return (
      <div className="rs-empty popup__empty">
        <b>{p.notSynced}</b>
        <p>{p.notSyncedHint}</p>
        <button type="button" className="rs-btn rs-btn--primary" onClick={() => openFullView("history")}>{p.continueInTab}</button>
      </div>
    );
  }

  return (
    <section className="popup__recent" aria-labelledby="popup-recent-heading">
      <h2 id="popup-recent-heading" className="rs-visually-hidden">{p.recentHeading}</h2>
      <ul className="popup__scrobbles rs-num">
        {state.scrobbles.map((s) => (
          <li key={s.id}>
            <time dateTime={new Date(s.timestamp * 1000).toISOString()}>{formatPlayedShort(s.timestamp)}</time>
            <span className="what">
              <span className="track">{s.track}</span>
              <span className="artist">{s.artist}</span>
            </span>
          </li>
        ))}
      </ul>
      {state.lastSyncedAt !== null && <p className="rs-hint">{p.synced(formatAgo(state.lastSyncedAt))}</p>}
      <button type="button" className="rs-btn rs-btn--block" onClick={() => openFullView("history")}>{p.findAndFix}</button>
    </section>
  );
}

const JOB_POLL_MS = 1000;

/** The active Job, if any, re-read every second: the full view saves it after each change. */
function useActiveJob(user: string) {
  const [active, setActive] = useState<{ job: StoredJob; appOpen: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    let store: JobStore | null = null;
    const appUrl = browser.runtime.getURL(APP_PATH);
    const read = async () => {
      store ??= await JobStore.open();
      if (!live) return;
      const job = (await store.all()).find((j) => j.user === user && (j.state === "running" || j.state === "paused"));
      const appOpen = job ? (await browser.tabs.query({})).some((t) => t.url?.startsWith(appUrl)) : false;
      if (live) setActive(job ? { job, appOpen } : null);
    };
    void read().catch(() => undefined);
    const timer = setInterval(() => void read().catch(() => undefined), JOB_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
      store?.close();
    };
  }, [user]);

  return active;
}

function JobStrip({ user }: { user: string }) {
  const active = useActiveJob(user);
  if (!active) return null;
  const { job, appOpen } = active;
  const total = job.entries.length;

  // A Job left "running" or "paused" with no full view open stopped when the full view closed.
  if (!appOpen) {
    return (
      <div className="popup__job rs-notice rs-notice--warn" role="status">
        <WarnIcon />
        <span>
          {strings.job.interrupted(strings.job.kinds[job.kind], strings.preview.count(total))}{" "}
          <button type="button" className="link" onClick={() => openFullView("history")}>{p.continueInTab}</button>
        </span>
      </div>
    );
  }

  const handled = job.entries.filter((e) => e.status !== "queued").length;
  return (
    <div className="popup__job" role="status">
      <span className="rs-num">
        {p.jobRunning(job.kind, handled, total)}
        {job.state === "paused" && ` · ${p.jobPaused}`}
      </span>
      <button type="button" className="link" onClick={() => openFullView()}>{p.show}</button>
    </div>
  );
}
