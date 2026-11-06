import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { formatPlayedShort } from "./format.ts";
import { jobTiming } from "./jobs/runJob.ts";
import { lastFmHistory, type Play } from "./test/lastfmHistory.ts";
import { FakeLastFmWebsite, siteScrobble } from "./test/fakeWebsite.ts";
import { renderSignedIn } from "./test/extension.tsx";

const now = Math.floor(Date.now() / 1000);
const DAY = 86_400;
const plays: Play[] = [
  { timestamp: now - 2 * DAY, artist: "Radiohead", track: "Airbag - Remastered" },
  { timestamp: now - 3 * DAY, artist: "Radiohead", track: "Airbag - Remastered" },
  { timestamp: now - 30 * DAY, artist: "Radiohead", track: "Let Down - Remastered" },
  { timestamp: now - 4 * DAY, artist: "Cher", track: "Believe" },
];

const fact = (name: string) => screen.queryByText(name, { selector: "dt" })?.nextElementSibling?.textContent;
const preview = () => within(screen.getByRole("complementary", { name: "Preview" }));
const recordFor = (track: string, timestamp: number) =>
  preview().getAllByRole("listitem").find((li) => li.textContent?.includes(track) && li.querySelector(".rs-edit__meta")?.textContent === formatted(timestamp))!;
const formatted = (t: number) => formatPlayedShort(t);

async function openWithRadioheadSelected(website: FakeLastFmWebsite) {
  lastFmHistory(plays);
  const view = await renderSignedIn(true, website);
  await waitFor(() => expect(fact("Scrobbles")).toBe("4"));
  await view.user.click(screen.getByRole("button", { name: /^Filter$/ }));
  const editor = within(screen.getByRole("form", { name: "New filter" }));
  await view.user.selectOptions(editor.getByLabelText("Field"), "artist");
  await view.user.selectOptions(editor.getByLabelText("Match"), "exact");
  await view.user.type(editor.getByLabelText("Value"), "Radiohead");
  await view.user.click(editor.getByRole("button", { name: "Add filter" }));
  return view;
}

const websiteWith = (list: Play[]) => new FakeLastFmWebsite(list.map((p) => siteScrobble(p.timestamp, p.artist, p.track)));

describe("deleting selected Scrobbles", () => {
  it("previews exactly what will go and marks deletes that can't be undone", async () => {
    const website = websiteWith(plays);
    const { user } = await openWithRadioheadSelected(website);

    await user.click(screen.getByRole("button", { name: "Delete 3 scrobbles" }));

    expect(preview().getByRole("heading", { name: "Delete 3 scrobbles" })).toBeInTheDocument();
    expect(preview().getAllByRole("listitem")).toHaveLength(3);
    expect(preview().getByText(/^1 of these are older than 14 days\. Deleting them can't be undone/)).toBeInTheDocument();
    expect(within(recordFor("Let Down - Remastered", plays[2]!.timestamp)).getByText("Can't be undone")).toBeInTheDocument();
    expect(within(recordFor("Airbag - Remastered", plays[0]!.timestamp)).queryByText("Can't be undone")).not.toBeInTheDocument();
    expect(website.calls).toEqual([]);
  });

  it("cancelling sends nothing", async () => {
    const website = websiteWith(plays);
    const { user } = await openWithRadioheadSelected(website);
    await user.click(screen.getByRole("button", { name: "Delete 3 scrobbles" }));

    await user.click(preview().getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("complementary", { name: "Preview" })).not.toBeInTheDocument();
    expect(website.calls).toEqual([]);
  });

  it("deletes after confirmation, reading each Track once, and drops them from the Mirror", async () => {
    const website = websiteWith(plays);
    const { user } = await openWithRadioheadSelected(website);
    await user.click(screen.getByRole("button", { name: "Delete 3 scrobbles" }));

    await user.click(preview().getByRole("button", { name: "Delete 3 scrobbles" }));

    expect(await preview().findByText("3 deleted")).toBeInTheDocument();
    expect(preview().getAllByText("Deleted")).toHaveLength(3);
    expect(website.library.map((s) => s.track)).toEqual(["Believe"]);
    expect(website.calls.map((c) => `${c.op} ${c.track}`)).toEqual([
      "listTrack Airbag - Remastered",
      "deleteScrobble Airbag - Remastered",
      "deleteScrobble Airbag - Remastered",
      "listTrack Let Down - Remastered",
      "deleteScrobble Let Down - Remastered",
    ]);
    expect(fact("Scrobbles")).toBe("1");
    expect(preview().getByText(/rescrobble opened last.fm in a background tab/)).toBeInTheDocument();
  });

  it("skips a Scrobble that no longer exists on Last.fm as not found", async () => {
    const website = websiteWith(plays.filter((p) => p !== plays[1]));
    const { user } = await openWithRadioheadSelected(website);
    await user.click(screen.getByRole("button", { name: "Delete 3 scrobbles" }));

    await user.click(preview().getByRole("button", { name: "Delete 3 scrobbles" }));

    expect(await preview().findByText("2 deleted · 1 not found")).toBeInTheDocument();
    expect(within(recordFor("Airbag - Remastered", plays[1]!.timestamp)).getByText("Not found")).toBeInTheDocument();
    expect(website.calls.filter((c) => c.op === "deleteScrobble")).toHaveLength(2);
  });

  it("stops and says what to do when last.fm is logged out", async () => {
    const website = websiteWith(plays);
    website.failNext("listTrack", { ok: false, reason: "loggedOut" });
    const { user } = await openWithRadioheadSelected(website);
    await user.click(screen.getByRole("button", { name: "Delete 3 scrobbles" }));

    await user.click(preview().getByRole("button", { name: "Delete 3 scrobbles" }));

    expect(await preview().findByRole("alert")).toHaveTextContent("Log in to last.fm in this browser, then try again.");
    expect(website.calls.filter((c) => c.op === "deleteScrobble")).toHaveLength(0);
    expect(fact("Scrobbles")).toBe("4");
  });

  it("spaces website requests apart", async () => {
    jobTiming.requestSpacingMs = 60;
    const website = websiteWith(plays);
    const { user } = await openWithRadioheadSelected(website);
    await user.click(screen.getByRole("button", { name: "Delete 3 scrobbles" }));

    await user.click(preview().getByRole("button", { name: "Delete 3 scrobbles" }));

    await preview().findByText("3 deleted", {}, { timeout: 3000 });
    const gaps = website.calls.slice(1).map((c, i) => c.at - website.calls[i]!.at);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(55);
  });
});
