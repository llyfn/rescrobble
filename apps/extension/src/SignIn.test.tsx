import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { BACKEND, server } from "./test/server.ts";
import { backendFor, lastFmApproval, renderApp, renderSignedIn, storeSession } from "./test/extension.tsx";

describe("signing in", () => {
  it("offers Log in with Last.fm when no one is signed in", async () => {
    renderApp();

    expect(await screen.findByRole("button", { name: "Log in with Last.fm" })).toBeInTheDocument();
  });

  it("credits AudioScrobbler with a link back to Last.fm", async () => {
    renderApp();

    expect(await screen.findByRole("link", { name: "Powered by AudioScrobbler" })).toHaveAttribute("href", "https://www.last.fm");
  });

  it("approves on last.fm, exchanges the token, stores the session and shows the account", async () => {
    const launched = lastFmApproval("lastfm-token");
    const backend = backendFor("rj", true);
    const { user } = renderApp();

    await user.click(await screen.findByRole("button", { name: "Log in with Last.fm" }));

    expect(await screen.findByText("rj")).toBeInTheDocument();
    expect(screen.getByText("Last.fm Pro")).toBeInTheDocument();
    const approval = new URL(launched[0]!);
    expect(approval.origin + approval.pathname).toBe("https://www.last.fm/api/auth/");
    expect(approval.searchParams.get("api_key")).toBe("test-api-key");
    expect(approval.searchParams.get("cb")).toBe("https://pjeamaekcjcngmbldpkhanpmgnhjfboh.chromiumapp.org/lastfm");
    expect(backend.exchanged).toEqual(["lastfm-token"]);
    expect(backend.bearers).toEqual(["Bearer rescrobble-token"]);
    expect(await fakeBrowser.storage.local.get("session")).toEqual({ session: { username: "rj", token: "rescrobble-token" } });
  });

  it("shows a free account as such", async () => {
    await renderSignedIn(false);

    expect(screen.getByText("Free account")).toBeInTheDocument();
  });

  it("explains when the sign-in window is closed without approving", async () => {
    lastFmApproval(null);
    const { user } = renderApp();

    await user.click(await screen.findByRole("button", { name: "Log in with Last.fm" }));

    expect(await screen.findByText("Sign-in didn't complete. Try again.")).toBeInTheDocument();
    expect(await fakeBrowser.storage.local.get("session")).toEqual({});
  });

  it("explains when the backend refuses the token", async () => {
    lastFmApproval("used-token");
    server.use(http.post(`${BACKEND}/auth/session`, () => HttpResponse.json({ error: "invalidToken" }, { status: 401 })));
    const { user } = renderApp();

    await user.click(await screen.findByRole("button", { name: "Log in with Last.fm" }));

    expect(await screen.findByText("Sign-in didn't complete. Try again.")).toBeInTheDocument();
  });
});

describe("a stored session", () => {
  it("goes straight in, sending the bearer token", async () => {
    const { backend } = await renderSignedIn();

    expect(screen.getByText("rj")).toBeInTheDocument();
    expect(backend.bearers).toEqual(["Bearer rescrobble-token"]);
  });

  it("is cleared by Sign out", async () => {
    const { user } = await renderSignedIn();

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("button", { name: "Log in with Last.fm" })).toBeInTheDocument();
    expect(await fakeBrowser.storage.local.get("session")).toEqual({});
  });

  it("ends with an explanation when the backend no longer accepts it", async () => {
    await storeSession();
    renderApp();

    expect(await screen.findByText("Your Last.fm session has ended. Log in again.")).toBeInTheDocument();
    expect(await fakeBrowser.storage.local.get("session")).toEqual({});
  });
});

describe("the shell", () => {
  it("switches screens from the rail", async () => {
    const { user } = await renderSignedIn();

    await user.click(screen.getByRole("link", { name: "Change log" }));

    expect(screen.getByRole("link", { name: "Change log" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "Change log" })).toBeInTheDocument();
  });

  it("opens on the screen named in the URL hash", async () => {
    window.history.replaceState(null, "", "/#jobs");

    await renderSignedIn();

    expect(screen.getByRole("link", { name: "Jobs" })).toHaveAttribute("aria-current", "page");
  });

  it("follows the URL hash when the popup opens another screen", async () => {
    const { user } = await renderSignedIn();
    await user.click(screen.getByRole("link", { name: "Change log" }));

    window.location.hash = "#settings";

    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
  });

  it("credits AudioScrobbler in the rail with a link back to Last.fm", async () => {
    await renderSignedIn();

    expect(screen.getByRole("link", { name: "Powered by AudioScrobbler" })).toHaveAttribute("href", "https://www.last.fm");
  });
});
