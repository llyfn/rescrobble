import type { Api } from "@rescrobble/scrobble-ui";

/** Calls the rescrobble backend with the session cookie. Any 401 ends the session in the UI before the caller sees the response. */
export function createApi(onUnauthorized: () => void): Api {
  return async (path, init) => {
    const response = await fetch(path, init);
    if (response.status === 401) onUnauthorized();
    return response;
  };
}

export async function loadApiKey(): Promise<string> {
  const response = await fetch("/api/config");
  if (!response.ok) throw new Error(`config ${response.status}`);
  const config: { lastFmApiKey: string } = await response.json();
  return config.lastFmApiKey;
}
