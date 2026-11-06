import { useEffect, useState } from "react";
import { LastFmReader } from "@rescrobble/core";
import { useTransport } from "./context.ts";

let reader: Promise<LastFmReader | null> | null = null;

/** The public API key is loaded once per page; a failure is retried on the next use. */
function loadReader(loadApiKey: () => Promise<string>): Promise<LastFmReader | null> {
  reader ??= loadApiKey()
    .then((apiKey) => new LastFmReader(apiKey))
    .catch(() => {
      reader = null;
      return null;
    });
  return reader;
}

export function useLastFmReader(): LastFmReader | null {
  const { loadApiKey } = useTransport();
  const [value, setValue] = useState<LastFmReader | null>(null);
  useEffect(() => {
    let live = true;
    loadReader(loadApiKey).then((r) => live && setValue(r));
    return () => { live = false; };
  }, [loadApiKey]);
  return value;
}

/** For tests: forget the cached reader so each test loads its own key. */
export function resetLastFmReader() {
  reader = null;
}
