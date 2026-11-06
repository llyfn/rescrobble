import type { Api } from "@rescrobble/scrobble-ui";
import { DEFAULT_BACKEND_ORIGIN } from "./backendOrigin.ts";

export const BACKEND_ORIGIN: string = import.meta.env.WXT_BACKEND_ORIGIN || DEFAULT_BACKEND_ORIGIN;

/** Calls the rescrobble backend with the Extension's bearer token. Any 401 ends the session first. */
export function createApi(token: string, onUnauthorized: () => void): Api {
  return async (path, init) => {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(`${BACKEND_ORIGIN}${path}`, { ...init, headers });
    if (response.status === 401) onUnauthorized();
    return response;
  };
}

export async function loadApiKey(): Promise<string> {
  const response = await fetch(`${BACKEND_ORIGIN}/api/config`);
  if (!response.ok) throw new Error(`config ${response.status}`);
  const config: { lastFmApiKey: string } = await response.json();
  return config.lastFmApiKey;
}
