import { browser } from "wxt/browser";
import { BACKEND_ORIGIN, loadApiKey } from "./backend.ts";

/** The rescrobble token from POST /auth/session: the encrypted session, never the raw Last.fm key. */
export interface StoredSession {
  username: string;
  token: string;
}

const KEY = "session";

export async function loadSession(): Promise<StoredSession | null> {
  const stored = await browser.storage.local.get(KEY);
  return (stored[KEY] as StoredSession | undefined) ?? null;
}

export async function clearSession() {
  await browser.storage.local.remove(KEY);
}

export class SignInFailed extends Error {}

/** Approves rescrobble on last.fm through the browser's own sign-in window, then exchanges the token. */
export async function signIn(): Promise<StoredSession> {
  const apiKey = await loadApiKey().catch(() => {
    throw new SignInFailed("config");
  });
  const redirect = browser.identity.getRedirectURL("lastfm");
  const approval = `https://www.last.fm/api/auth/?api_key=${encodeURIComponent(apiKey)}&cb=${encodeURIComponent(redirect)}`;

  let returned: string | undefined;
  try {
    returned = await browser.identity.launchWebAuthFlow({ url: approval, interactive: true });
  } catch {
    throw new SignInFailed("cancelled");
  }
  const token = returned ? new URL(returned).searchParams.get("token") : null;
  if (!token) throw new SignInFailed("no token");

  const response = await fetch(`${BACKEND_ORIGIN}/auth/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  }).catch(() => null);
  if (!response?.ok) throw new SignInFailed("exchange");
  const session: StoredSession = await response.json();
  await browser.storage.local.set({ [KEY]: { username: session.username, token: session.token } });
  return session;
}
