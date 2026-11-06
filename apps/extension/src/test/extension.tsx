import { vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { App } from "../App.tsx";
import type { WebsiteGateway } from "../website/gateway.ts";
import { FakeLastFmWebsite } from "./fakeWebsite.ts";
import { BACKEND, server } from "./server.ts";

export const REDIRECT = "https://mnbkmonfmoloodikmopdlohjgdehfkep.chromiumapp.org/lastfm";

/** Scripts the browser's Last.fm sign-in window to come back with `token`, or to be closed when null. */
export function lastFmApproval(token: string | null) {
  const launched: string[] = [];
  fakeBrowser.identity.getRedirectURL = vi.fn((path?: string) => `https://mnbkmonfmoloodikmopdlohjgdehfkep.chromiumapp.org/${path ?? ""}`);
  fakeBrowser.identity.launchWebAuthFlow = vi.fn(async ({ url }: { url: string }) => {
    launched.push(url);
    if (token === null) throw new Error("The user did not approve access.");
    return `${REDIRECT}?token=${token}`;
  }) as typeof fakeBrowser.identity.launchWebAuthFlow;
  return launched;
}

/** The backend as a signed-in account `rj` with the given Pro status, recording bearer tokens it sees. */
export function backendFor(username: string, pro: boolean | null, rescrobbleToken = "rescrobble-token") {
  const bearers: (string | null)[] = [];
  const exchanged: string[] = [];
  server.use(
    http.post(`${BACKEND}/auth/session`, async ({ request }) => {
      exchanged.push(((await request.json()) as { token: string }).token);
      return HttpResponse.json({ username, token: rescrobbleToken });
    }),
    http.get(`${BACKEND}/api/me`, ({ request }) => {
      bearers.push(request.headers.get("Authorization"));
      return HttpResponse.json({ username, pro });
    }),
  );
  return { bearers, exchanged };
}

export async function storeSession(username = "rj", token = "rescrobble-token") {
  await fakeBrowser.storage.local.set({ session: { username, token } });
}

export function renderApp(gateway: WebsiteGateway = new FakeLastFmWebsite([])) {
  const user = userEvent.setup();
  return { user, ...render(<App gateway={gateway} />) };
}

export async function renderSignedIn(pro: boolean | null = true, gateway?: WebsiteGateway) {
  await storeSession();
  const backend = backendFor("rj", pro);
  const view = renderApp(gateway);
  await screen.findByRole("navigation", { name: "Main" });
  return { ...view, backend };
}
