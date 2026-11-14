import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { Popup } from "./Popup.tsx";
import { JobStore, type StoredJob } from "./jobs/jobStore.ts";
import { MirrorDb, scrobbleId, type SyncState } from "./mirror/db.ts";
import { plays } from "./test/lastfmHistory.ts";
import { storeSession } from "./test/extension.tsx";
import { BACKEND, server } from "./test/server.ts";

const appUrl = () => fakeBrowser.runtime.getURL("/app.html");
const openTabs = async () => (await fakeBrowser.tabs.query({})).map((t: { url?: string }) => t.url);
const input = (label: string) => screen.getByLabelText(label, { selector: "input" });

let closed: ReturnType<typeof vi.fn<() => void>>;
beforeEach(() => {
  closed = vi.fn<() => void>();
  vi.spyOn(window, "close").mockImplementation(closed);
});
afterEach(() => vi.restoreAllMocks());

function renderPopup() {
  const user = userEvent.setup();
  return { user, ...render(<Popup />) };
}

async function renderSignedInPopup() {
  await storeSession();
  const view = renderPopup();
  await screen.findByRole("tablist", { name: "Popup" });
  return view;
}

async function storeMirror(username: string, count: number, lastSyncedAt: number | null = Date.now() - 5 * 60_000) {
  const db = await MirrorDb.open();
  const state: SyncState = { username, full: { to: 1_790_000_000, nextPage: 2, totalPages: 1, total: count, done: true }, newestSynced: 1_790_000_000, lastSyncedAt };
  await db.putPage(plays(count).map((p) => ({ ...p, album: p.album ?? "", id: scrobbleId({ ...p, album: p.album ?? "" }) })), state);
  db.close();
}

async function storeJob(state: StoredJob["state"], handled: number, total: number) {
  const store = await JobStore.open();
  await store.save({
    id: "job-1",
    user: "rj",
    kind: "delete",
    changes: [],
    createdAt: Date.now(),
    entries: Array.from({ length: total }, (_, i) => ({
      target: { id: `s${i}`, artist: "Radiohead", track: `Track ${i}`, album: "", timestamp: 1_790_000_000 - i },
      status: i < handled ? "done" : "queued",
    })),
    state,
    notice: null,
  });
  store.close();
}

describe("the popup when signed out", () => {
  it("sends sign-in to the full view, because the sign-in window would close the popup", async () => {
    const { user } = renderPopup();

    await user.click(await screen.findByRole("button", { name: "Log in with Last.fm" }));

    await waitFor(() => expect(closed).toHaveBeenCalled());
    expect(await openTabs()).toContain(appUrl());
  });
});

describe("the popup", () => {
  it("opens the full view from the header and closes", async () => {
    const { user } = await renderSignedInPopup();

    await user.click(screen.getByRole("button", { name: "Full view" }));

    await waitFor(() => expect(closed).toHaveBeenCalled());
    expect(await openTabs()).toContain(appUrl());
  });

  it("shows who is signed in", async () => {
    await renderSignedInPopup();

    expect(screen.getByRole("banner")).toHaveTextContent("rj");
  });

  it("adds a track through the backend with the bearer token", async () => {
    const requests: { bearer: string | null; scrobbles: { artist: string; track: string }[] }[] = [];
    server.use(http.post(`${BACKEND}/api/scrobbles`, async ({ request }) => {
      const body = (await request.json()) as { scrobbles: { artist: string; track: string }[] };
      requests.push({ bearer: request.headers.get("Authorization"), scrobbles: body.scrobbles });
      return HttpResponse.json({ results: body.scrobbles.map((e) => ({ status: "accepted", artist: e.artist, artistCorrected: false, track: e.track, trackCorrected: false })) });
    }));
    const { user } = await renderSignedInPopup();

    await user.type(input("Artist"), "Cher");
    await user.type(input("Track"), "Believe");
    await user.click(screen.getByRole("button", { name: "Add scrobble" }));

    expect(await within(screen.getByRole("region", { name: "This session" })).findByText("Added")).toBeInTheDocument();
    expect(requests.map((r) => [r.bearer, r.scrobbles[0]?.artist, r.scrobbles[0]?.track])).toEqual([["Bearer rescrobble-token", "Cher", "Believe"]]);
  });

  it("returns to sign-in when the session has ended", async () => {
    server.use(http.post(`${BACKEND}/api/scrobbles`, () => HttpResponse.json({ error: "sessionInvalid" }, { status: 401 })));
    const { user } = await renderSignedInPopup();

    await user.type(input("Artist"), "Cher");
    await user.type(input("Track"), "Believe");
    await user.click(screen.getByRole("button", { name: "Add scrobble" }));

    expect(await screen.findByText("Your Last.fm session has ended. Log in again.")).toBeInTheDocument();
    expect(await fakeBrowser.storage.local.get("session")).toEqual({});
  });

  it("continues an album in the full view's Add scrobbles screen", async () => {
    const { user } = await renderSignedInPopup();

    await user.click(screen.getByRole("button", { name: "Continue in new tab" }));

    await waitFor(() => expect(closed).toHaveBeenCalled());
    expect(await openTabs()).toContain(`${appUrl()}#add`);
  });
});

describe("recent scrobbles in the popup", () => {
  it("lists the ten newest scrobbles the full view has synced", async () => {
    await storeMirror("rj", 25);
    const { user } = await renderSignedInPopup();

    await user.click(screen.getByRole("tab", { name: "Recent" }));

    const items = within(await screen.findByRole("list")).getAllByRole("listitem");
    expect(items).toHaveLength(10);
    expect(items[0]).toHaveTextContent("Track 25");
    expect(items[9]).toHaveTextContent("Track 16");
    expect(screen.getByText(/^Synced 5 min ago\./)).toBeInTheDocument();
  });

  it("asks for a sync in the full view when nothing is synced yet", async () => {
    const { user } = await renderSignedInPopup();

    await user.click(screen.getByRole("tab", { name: "Recent" }));
    expect(await screen.findByText("Your history isn't here yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue in new tab" }));

    await waitFor(() => expect(closed).toHaveBeenCalled());
    expect(await openTabs()).toContain(`${appUrl()}#history`);
  });

  it("doesn't show another account's synced history", async () => {
    await storeMirror("someone-else", 5);
    const { user } = await renderSignedInPopup();

    await user.click(screen.getByRole("tab", { name: "Recent" }));

    expect(await screen.findByText("Your history isn't here yet")).toBeInTheDocument();
  });
});

describe("jobs in the popup", () => {
  it("shows the progress of a job running in the full view", async () => {
    await fakeBrowser.tabs.create({ url: appUrl() });
    await storeJob("running", 3, 10);

    await renderSignedInPopup();

    expect(await screen.findByText("Deleting 3 of 10")).toBeInTheDocument();
  });

  it("offers to continue a job that stopped when the full view closed", async () => {
    await storeJob("running", 3, 10);
    const { user } = await renderSignedInPopup();

    expect(await screen.findByText(/An unfinished delete of 10 scrobbles stopped/)).toBeInTheDocument();
    await user.click(within(screen.getByText(/An unfinished delete/)).getByRole("button", { name: "Continue in new tab" }));

    await waitFor(() => expect(closed).toHaveBeenCalled());
    expect(await openTabs()).toContain(`${appUrl()}#history`);
  });

  it("shows nothing about finished jobs", async () => {
    await fakeBrowser.tabs.create({ url: appUrl() });
    await storeJob("finished", 10, 10);

    await renderSignedInPopup();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText(/Deleting/)).not.toBeInTheDocument();
  });
});
