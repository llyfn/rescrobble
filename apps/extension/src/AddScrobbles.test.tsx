import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { LASTFM_API_URL } from "@rescrobble/core";
import { BACKEND, server } from "./test/server.ts";
import { renderSignedIn } from "./test/extension.tsx";

interface Sent { artist: string; track: string; timestamp: number; album?: string }

function scrobbleEndpoint() {
  const requests: { bearer: string | null; scrobbles: Sent[] }[] = [];
  server.use(http.post(`${BACKEND}/api/scrobbles`, async ({ request }) => {
    const body = (await request.json()) as { scrobbles: Sent[] };
    requests.push({ bearer: request.headers.get("Authorization"), scrobbles: body.scrobbles });
    return HttpResponse.json({
      results: body.scrobbles.map((e) => ({ status: "accepted", artist: e.artist, artistCorrected: false, track: e.track, trackCorrected: false })),
    });
  }));
  return requests;
}

const input = (label: string) => screen.getByLabelText(label, { selector: "input" });

async function openAdd() {
  const view = await renderSignedIn();
  await view.user.click(screen.getByRole("link", { name: "Add scrobbles" }));
  await screen.findByRole("heading", { name: "Add scrobbles" });
  return view;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-06T21:10:30Z"));
});
afterEach(() => vi.useRealTimers());

describe("adding scrobbles in the Extension", () => {
  it("adds a Track through the backend with the bearer token", async () => {
    const requests = scrobbleEndpoint();
    const { user } = await openAdd();

    await user.type(input("Artist"), "Cher");
    await user.type(input("Track"), "Believe");
    await user.click(screen.getByRole("button", { name: "Add scrobble" }));

    expect(await within(screen.getByRole("region", { name: "This session" })).findByText("Added")).toBeInTheDocument();
    expect(requests).toEqual([{ bearer: "Bearer rescrobble-token", scrobbles: [{ artist: "Cher", track: "Believe", timestamp: 1793999400 }] }]);
  });

  it("adds an Album Scrobble found through Last.fm", async () => {
    server.use(http.get(LASTFM_API_URL, ({ request }) => {
      const method = new URL(request.url).searchParams.get("method");
      if (method === "album.search") return HttpResponse.json({ results: { albummatches: { album: [{ name: "Believe", artist: "Cher" }] } } });
      return HttpResponse.json({ album: { name: "Believe", artist: "Cher", tracks: { track: [
        { name: "Believe", duration: 239, artist: { name: "Cher" } },
        { name: "The Power", duration: 236, artist: { name: "Cher" } },
      ] } } });
    }));
    const requests = scrobbleEndpoint();
    const { user } = await openAdd();

    await user.click(screen.getByRole("tab", { name: "Album" }));
    await user.type(input("Album"), "believ");
    await user.click(await screen.findByRole("option", { name: /^Believe\s*Cher$/ }));
    await user.click(await screen.findByRole("button", { name: "Scrobble 2 tracks" }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]?.scrobbles.map((e) => [e.track, e.album])).toEqual([["Believe", "Believe"], ["The Power", "Believe"]]);
  });

  it("returns to sign-in when the session has ended mid-way", async () => {
    server.use(http.post(`${BACKEND}/api/scrobbles`, () => HttpResponse.json({ error: "sessionInvalid" }, { status: 401 })));
    const { user } = await openAdd();

    await user.type(input("Artist"), "Cher");
    await user.type(input("Track"), "Believe");
    await user.click(screen.getByRole("button", { name: "Add scrobble" }));

    expect(await screen.findByText("Your Last.fm session has ended. Log in again.")).toBeInTheDocument();
    expect(await fakeBrowser.storage.local.get("session")).toEqual({});
  });
});
