import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse } from "msw";
import { lastFmHistory, plays } from "./test/lastfmHistory.ts";
import { renderSignedIn } from "./test/extension.tsx";

const table = () => within(screen.getByRole("table", { name: "Scrobbles" }));
const bodyRows = () => table().getAllByRole("row").slice(1) as HTMLTableRowElement[];
const status = () => screen.getByRole("status");
const fact = (name: string) => screen.getByText(name, { selector: "dt" }).nextElementSibling?.textContent;

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

describe("the first sync", () => {
  it("copies the whole history, leaving out the track playing now", async () => {
    const { requests } = lastFmHistory(plays(450), { nowPlaying: true });
    await renderSignedIn();

    await waitFor(() => expect(status()).toHaveTextContent(/^Synced just now$/));
    expect(fact("Scrobbles")).toBe("450");
    expect(screen.queryByText("Playing Now")).not.toBeInTheDocument();
    expect(bodyRows()[0]).toHaveTextContent("Track 450");
    expect(requests.every((r) => r.user === "rj")).toBe(true);
    expect(requests.filter((r) => r.to !== null).map((r) => r.page)).toEqual([1, 2, 3]);
  });

  it("shows progress and lets you browse what has arrived while it runs", async () => {
    const pageTwo = gate();
    lastFmHistory(plays(450), { respond: async (req) => (req.page === 2 && req.to !== null ? (await pageTwo.opened, undefined) : undefined) });
    await renderSignedIn();

    await waitFor(() => expect(status()).toHaveTextContent("Syncing 200 of 450"));
    expect(bodyRows().length).toBeGreaterThan(0);
    expect(bodyRows()[0]).toHaveTextContent("Track 450");

    pageTwo.open();
    await waitFor(() => expect(fact("Scrobbles")).toBe("450"));
  });

  it("picks up where it stopped after the tab was closed, without duplicates", async () => {
    const pageTwo = gate();
    const first = lastFmHistory(plays(450), { respond: async (req) => (req.page === 2 && req.to !== null ? (await pageTwo.opened, undefined) : undefined) });
    const { unmount } = await renderSignedIn();
    await waitFor(() => expect(status()).toHaveTextContent("Syncing 200 of 450"));
    const to = first.requests.find((r) => r.to !== null)!.to;
    unmount();
    pageTwo.open();

    const second = lastFmHistory(plays(450));
    await renderSignedIn();

    await waitFor(() => expect(fact("Scrobbles")).toBe("450"));
    const firstSyncPages = second.requests.filter((r) => r.to !== null);
    expect(firstSyncPages.map((r) => r.page)).toEqual([2, 3]);
    expect(firstSyncPages.every((r) => r.to === to)).toBe(true);
  });

  it("waits and retries when Last.fm asks it to slow down", async () => {
    let refusals = 2;
    lastFmHistory(plays(300), {
      respond: (req) => (req.page === 2 && refusals-- > 0 ? HttpResponse.json({ error: 29, message: "Rate limit exceeded" }, { status: 429 }) : undefined),
    });
    await renderSignedIn();

    await waitFor(() => expect(status()).toHaveTextContent("Last.fm asked us to slow down. Retrying shortly"));
    await waitFor(() => expect(status()).toHaveTextContent(/^Synced just now$/));
    expect(fact("Scrobbles")).toBe("300");
  });
});

describe("keeping the Mirror current", () => {
  it("fetches only Scrobbles newer than the newest stored when reopened", async () => {
    const history = plays(250);
    lastFmHistory(history);
    const { unmount } = await renderSignedIn();
    await waitFor(() => expect(fact("Scrobbles")).toBe("250"));
    unmount();

    const newest = Math.max(...history.map((p) => p.timestamp));
    const afterFirstSync = Math.floor(Date.now() / 1000) + 60;
    const later = lastFmHistory([...history, { timestamp: afterFirstSync, artist: "Cher", track: "Believe" }]);
    await renderSignedIn();

    await waitFor(() => expect(fact("Scrobbles")).toBe("251"));
    expect(later.requests.every((r) => r.from !== null && r.from > newest - 1)).toBe(true);
    expect(bodyRows()[0]).toHaveTextContent("Believe");
  });

  it("syncs again on Sync now", async () => {
    const history = plays(10);
    lastFmHistory(history);
    const { user } = await renderSignedIn();
    await waitFor(() => expect(status()).toHaveTextContent(/^Synced/));

    history.push({ timestamp: Math.floor(Date.now() / 1000) + 60, artist: "Cher", track: "Strong Enough" });
    await user.click(screen.getByRole("button", { name: "Sync now" }));

    await waitFor(() => expect(fact("Scrobbles")).toBe("11"));
  });

  it("rebuilds the Mirror from scratch from Settings", async () => {
    const { requests } = lastFmHistory(plays(250));
    const { user } = await renderSignedIn();
    await waitFor(() => expect(fact("Scrobbles")).toBe("250"));
    requests.length = 0;

    await user.click(screen.getByRole("link", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Rebuild Mirror" }));
    await user.click(screen.getByRole("link", { name: "History" }));

    await waitFor(() => expect(fact("Scrobbles")).toBe("250"));
    expect(requests.filter((r) => r.to !== null).map((r) => r.page)).toEqual([1, 2]);
  });
});

describe("the History table", () => {
  it("sorts by a column and reverses on a second click", async () => {
    lastFmHistory([
      { timestamp: 1_790_000_000, artist: "Björk", track: "Hyperballad" },
      { timestamp: 1_790_000_300, artist: "Cher", track: "Believe" },
      { timestamp: 1_790_000_600, artist: "Air", track: "La femme d'argent" },
    ]);
    const { user } = await renderSignedIn();
    await waitFor(() => expect(fact("Scrobbles")).toBe("3"));

    await user.click(screen.getByRole("button", { name: "Artist" }));
    expect(bodyRows().map((r) => r.cells[2]?.textContent)).toEqual(["Air", "Björk", "Cher"]);
    expect(screen.getByRole("columnheader", { name: "Artist" })).toHaveAttribute("aria-sort", "ascending");

    await user.click(screen.getByRole("button", { name: "Artist" }));
    expect(bodyRows().map((r) => r.cells[2]?.textContent)).toEqual(["Cher", "Björk", "Air"]);
  });

  it("draws only the rows in view for a large Mirror", async () => {
    lastFmHistory(plays(1000));
    await renderSignedIn();

    await waitFor(() => expect(fact("Scrobbles")).toBe("1,000"));
    expect(bodyRows().length).toBeLessThan(100);
  });
});
