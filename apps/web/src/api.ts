import { createContext, useContext } from "react";

/** Calls the rescrobble backend. Any 401 ends the session in the UI before the caller sees the response. */
export type Api = (path: string, init?: RequestInit) => Promise<Response>;

export function createApi(onUnauthorized: () => void): Api {
  return async (path, init) => {
    const response = await fetch(path, init);
    if (response.status === 401) onUnauthorized();
    return response;
  };
}

export const ApiContext = createContext<Api | null>(null);

export function useApi(): Api {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi needs an ApiContext provider");
  return api;
}
