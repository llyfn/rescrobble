import { useEffect, useState } from "react";
import { LastFmReader } from "@rescrobble/core";

let reader: Promise<LastFmReader | null> | null = null;

/** The public API key comes from the backend once per page; a failure is retried on the next use. */
function loadReader(): Promise<LastFmReader | null> {
  reader ??= fetch("/api/config")
    .then(async (response) => {
      if (!response.ok) throw new Error(`config ${response.status}`);
      const config: { lastFmApiKey: string } = await response.json();
      return new LastFmReader(config.lastFmApiKey);
    })
    .catch(() => {
      reader = null;
      return null;
    });
  return reader;
}

export function useLastFmReader(): LastFmReader | null {
  const [value, setValue] = useState<LastFmReader | null>(null);
  useEffect(() => {
    let live = true;
    loadReader().then((r) => live && setValue(r));
    return () => { live = false; };
  }, []);
  return value;
}

/** For tests: forget the cached reader so each test loads its own config. */
export function resetLastFmReader() {
  reader = null;
}
