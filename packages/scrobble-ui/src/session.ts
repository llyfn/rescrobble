import { useCallback, useState } from "react";
import type { Outcome, ScrobbleEntry } from "./scrobbles.ts";

export interface SessionResult {
  id: string;
  entry: ScrobbleEntry;
  outcome: Outcome;
}

const KEY = "rescrobble.session";

function load(): SessionResult[] {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "[]") as SessionResult[];
  } catch {
    return [];
  }
}

/** "This session": kept in sessionStorage so it survives a reload, stays private to the tab, and ends with it. */
export function useSessionResults() {
  const [results, setResults] = useState<SessionResult[]>(load);

  const add = useCallback((entries: ScrobbleEntry[], outcomes: Outcome[]) => {
    const added = entries.map((entry, i) => ({ id: crypto.randomUUID(), entry, outcome: outcomes[i]! })).reverse();
    setResults((current) => {
      const next = [...added, ...current];
      sessionStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { results, add };
}
