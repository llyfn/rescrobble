import { createContext, useContext } from "react";

/** Sends a request to the rescrobble backend. Each app supplies its own: cookie session or bearer token. */
export type Api = (path: string, init?: RequestInit) => Promise<Response>;

export interface ScrobbleTransport {
  api: Api;
  /** The public Last.fm API key, for unsigned read calls made straight from the browser. */
  loadApiKey: () => Promise<string>;
}

export const ScrobbleTransportContext = createContext<ScrobbleTransport | null>(null);

export function useTransport(): ScrobbleTransport {
  const transport = useContext(ScrobbleTransportContext);
  if (!transport) throw new Error("Add scrobbles needs a ScrobbleTransportContext provider");
  return transport;
}
