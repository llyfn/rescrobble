import { useState } from "react";
import { AlbumForm } from "./AlbumForm.tsx";
import { useSessionResults } from "./session.ts";
import { SessionResults } from "./SessionResults.tsx";
import { strings } from "./strings.ts";
import { TrackForm } from "./TrackForm.tsx";

type Tab = "track" | "album";

function tabFromUrl(): Tab {
  return new URLSearchParams(window.location.search).get("tab") === "album" ? "album" : "track";
}

function setTabInUrl(tab: Tab) {
  const url = new URL(window.location.href);
  if (tab === "album") url.searchParams.set("tab", "album");
  else url.searchParams.delete("tab");
  window.history.replaceState(null, "", url);
}

export function SignedIn() {
  const session = useSessionResults();
  const [tab, setTab] = useState<Tab>(tabFromUrl);
  const choose = (next: Tab) => {
    setTab(next);
    setTabInUrl(next);
  };

  return (
    <main className="page">
      <h1>{strings.signedIn.heading}</h1>
      <div className="rs-tabs" role="tablist" aria-label={strings.tabs.label}>
        {(["track", "album"] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            id={`tab-${name}`}
            className="rs-tab"
            aria-selected={tab === name}
            aria-controls={`panel-${name}`}
            onClick={() => choose(name)}
          >
            {strings.tabs[name]}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="panel">
        {tab === "track" ? <TrackForm onResults={session.add} /> : <AlbumForm onResults={session.add} />}
      </div>
      <SessionResults results={session.results} />
    </main>
  );
}
