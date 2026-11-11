import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { jobTiming } from "./jobs/runner.ts";
import { lastFmHistory, plays as manyPlays, type Play } from "./test/lastfmHistory.ts";
import { FakeLastFmWebsite, siteScrobble } from "./test/fakeWebsite.ts";
import { renderSignedIn } from "./test/extension.tsx";

const now = Math.floor(Date.now() / 1000);
const DAY = 86_400;
const plays: Play[] = [
  { timestamp: now - 2 * DAY, artist: "Radiohead", track: "Airbag - Remastered" },
  { timestamp: now - 3 * DAY, artist: "Radiohead", track: "Let Down - Remastered" },
  { timestamp: now - 4 * DAY, artist: "Radiohead", track: "Lucky - Remastered" },
];

const fact = (name: string) => screen.queryByText(name, { selector: "dt" })?.nextElementSibling?.textContent;
const preview = () => within(screen.getByRole("complementary", { name: "Preview" }));
const websiteWith = (list: Play[]) => new FakeLastFmWebsite(list.map((p) => siteScrobble(p.timestamp, p.artist, p.track)));
const deletes = (website: FakeLastFmWebsite) => website.calls.filter((c) => c.op === "deleteScrobble");

/** Replaces the runner's waiting: each wait is recorded, and held until released when `hold` is on. */
function controlledSleep({ hold = false } = {}) {
  const waits: number[] = [];
  const pending: (() => void)[] = [];
  jobTiming.sleep = (ms) => {
    if (ms > 0) waits.push(ms);
    if (!hold || ms === 0) return Promise.resolve();
    return new Promise<void>((resolve) => pending.push(resolve));
  };
  return {
    waits,
    async release() {
      await waitFor(() => expect(pending.length).toBeGreaterThan(0));
      pending.shift()!();
    },
  };
}

async function selectAndDelete(website: FakeLastFmWebsite, history: Play[] = plays, count = history.length) {
  lastFmHistory(history);
  const view = await renderSignedIn(true, website);
  await waitFor(() => expect(fact("Scrobbles")).toBe(String(count)));
  await view.user.click(screen.getByRole("button", { name: /^Filter$/ }));
  const editor = within(screen.getByRole("form", { name: "New filter" }));
  await view.user.selectOptions(editor.getByLabelText("Field"), "artist");
  await view.user.type(editor.getByLabelText("Value"), "Radiohead");
  await view.user.click(editor.getByRole("button", { name: "Add filter" }));
  await view.user.click(screen.getByRole("checkbox", { name: "Select all matching scrobbles" }));
  return view;
}

async function confirmDelete(user: Awaited<ReturnType<typeof renderSignedIn>>["user"], n: number) {
  await user.click(screen.getByRole("button", { name: `Delete ${n} scrobbles` }));
  await user.click(preview().getByRole("button", { name: `Delete ${n} scrobbles` }));
}

describe("when Last.fm slows us down", () => {
  it("backs off from 10 s up to 60 s, and starts over after a success", async () => {
    const sleep = controlledSleep();
    const website = websiteWith(plays);
    for (let i = 0; i < 4; i++) website.failNext("deleteScrobble", { ok: false, reason: "rateLimited", status: i % 2 ? 503 : 429 });
    const { user } = await selectAndDelete(website);

    await confirmDelete(user, 3);

    await waitFor(() => expect(preview().getByText("3 deleted")).toBeInTheDocument());
    expect(sleep.waits).toEqual([10_000, 20_000, 40_000, 60_000]);
  });

  it("starts the back-off over after a success", async () => {
    const sleep = controlledSleep();
    const website = websiteWith(plays);
    website.failNext("deleteScrobble", { ok: false, reason: "rateLimited", status: 429 });
    website.failNext("deleteScrobble", { ok: false, reason: "rateLimited", status: 429 });
    const { user } = await selectAndDelete(website);
    await confirmDelete(user, 3);
    await waitFor(() => expect(preview().getByText("3 deleted")).toBeInTheDocument());

    expect(sleep.waits).toEqual([10_000, 20_000]);
  });

  it("says when it will retry while waiting", async () => {
    const sleep = controlledSleep({ hold: true });
    const website = websiteWith(plays);
    website.failNext("deleteScrobble", { ok: false, reason: "rateLimited", status: 429 });
    const { user } = await selectAndDelete(website);

    await confirmDelete(user, 3);

    expect(await preview().findByText(/^Last.fm asked us to slow down. Retrying at \d\d:\d\d:\d\d\.$/)).toBeInTheDocument();
    await sleep.release();
    expect(await preview().findByText("3 deleted")).toBeInTheDocument();
  });

  it("waits out a block for 10 minutes, then carries on by itself", async () => {
    const sleep = controlledSleep({ hold: true });
    const website = websiteWith(plays);
    website.failNext("listTrack", { ok: false, reason: "blocked" });
    const { user } = await selectAndDelete(website);

    await confirmDelete(user, 3);

    expect(await preview().findByRole("alert")).toHaveTextContent(/^Last.fm is limiting requests from your network\. Continuing automatically at/);
    expect(sleep.waits).toEqual([600_000]);
    await sleep.release();
    expect(await preview().findByText("3 deleted")).toBeInTheDocument();
    expect(deletes(website)).toHaveLength(3);
  });

  it("pauses after five failures in a row until resumed", async () => {
    controlledSleep();
    const website = websiteWith(plays);
    for (let i = 0; i < 5; i++) website.failNext("deleteScrobble", { ok: false, reason: "rateLimited", status: 503 });
    const { user } = await selectAndDelete(website);

    await confirmDelete(user, 3);

    expect(await preview().findByRole("alert")).toHaveTextContent("Paused after 5 failures in a row. Resume to try again.");
    const before = website.calls.length;
    await new Promise((r) => setTimeout(r, 30));
    expect(website.calls).toHaveLength(before);

    await user.click(preview().getByRole("button", { name: "Resume" }));
    expect(await preview().findByText("3 deleted")).toBeInTheDocument();
  });
});

describe("steering a Job", () => {
  it("pauses, resumes and cancels, stopping after the request in flight", async () => {
    jobTiming.requestSpacingMs = 1000;
    const sleep = controlledSleep({ hold: true });
    const website = websiteWith(plays);
    const { user } = await selectAndDelete(website);
    await confirmDelete(user, 3);
    await sleep.release();
    await waitFor(() => expect(deletes(website)).toHaveLength(1));

    await user.click(preview().getByRole("button", { name: "Pause" }));
    await sleep.release();

    expect(await preview().findByText("Paused.")).toBeInTheDocument();
    expect(deletes(website)).toHaveLength(1);

    await user.click(preview().getByRole("button", { name: "Resume" }));
    await sleep.release();
    await waitFor(() => expect(deletes(website)).toHaveLength(2));
    await user.click(preview().getByRole("button", { name: "Cancel job" }));
    await sleep.release().catch(() => undefined);

    expect(await preview().findByText("Cancelled. 2 deleted")).toBeInTheDocument();
    expect(preview().getAllByText("Cancelled", { selector: ".rs-status" })).toHaveLength(1);
    expect(deletes(website)).toHaveLength(2);
  });

  it("offers to resume a Job interrupted by closing the app, without repeating any request", async () => {
    jobTiming.requestSpacingMs = 1000;
    const sleep = controlledSleep({ hold: true });
    const website = websiteWith(plays);
    const first = await selectAndDelete(website);
    await confirmDelete(first.user, 3);
    await sleep.release();
    await waitFor(() => expect(deletes(website)).toHaveLength(1));
    website.failNext("listTrack", { ok: false, reason: "loggedOut" });
    await sleep.release();
    await waitFor(() => expect(preview().getByRole("alert")).toHaveTextContent("Log in to last.fm in this browser, then resume."));
    first.unmount();

    controlledSleep();
    lastFmHistory(website.library.map((s) => ({ timestamp: s.timestamp, artist: s.artist, track: s.track })));
    const second = await renderSignedIn(true, website);

    expect(await screen.findByText(/^An unfinished delete of 3 scrobbles stopped when rescrobble was closed\./)).toBeInTheDocument();
    await second.user.click(screen.getByRole("button", { name: "Resume" }));

    expect(await preview().findByText("3 deleted")).toBeInTheDocument();
    const deleted = deletes(website).map((c) => c.timestamp);
    expect(deleted).toHaveLength(3);
    expect(new Set(deleted).size).toBe(3);
  });

  it("lists Jobs with how far they got", async () => {
    const website = websiteWith(plays);
    const { user } = await selectAndDelete(website);
    await confirmDelete(user, 3);
    await preview().findByText("3 deleted");

    await user.click(screen.getByRole("link", { name: "Jobs" }));

    const row = within(screen.getByRole("table")).getAllByRole("row")[1]!;
    expect(row).toHaveTextContent("Delete 3 scrobbles");
    expect(row).toHaveTextContent("3 / 3");
    expect(row).toHaveTextContent("Finished");
  });
});

describe("large Jobs", () => {
  it("estimates how long a Job of more than 500 Scrobbles will take", async () => {
    jobTiming.requestSpacingMs = 1000;
    const history = manyPlays(501);
    const { user } = await selectAndDelete(websiteWith(history), history, 501);

    await user.click(screen.getByRole("button", { name: "Delete 501 scrobbles" }));

    expect(preview().getByText("This will take about 17 minutes, one request at a time.")).toBeInTheDocument();
  });
});
