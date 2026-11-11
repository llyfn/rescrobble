import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { lastFmHistory, type Play } from "./test/lastfmHistory.ts";
import { FakeLastFmWebsite, siteScrobble } from "./test/fakeWebsite.ts";
import { BACKEND, server } from "./test/server.ts";
import { renderSignedIn } from "./test/extension.tsx";

const now = Math.floor(Date.now() / 1000);
const DAY = 86_400;
const album = "OK Computer OKNOTOK 1997 2017";
const plays: Play[] = [
  { timestamp: now - 2 * DAY, artist: "Radiohead", track: "Airbag - Remastered", album },
  { timestamp: now - 14 * DAY + 60, artist: "Radiohead", track: "Let Down - Remastered", album },
  { timestamp: now - 14 * DAY - 60, artist: "Radiohead", track: "Lucky - Remastered", album },
];

const fact = (name: string) => screen.queryByText(name, { selector: "dt" })?.nextElementSibling?.textContent;
const preview = () => within(screen.getByRole("complementary", { name: "Preview" }));
const websiteWith = (list: Play[]) =>
  new FakeLastFmWebsite(list.map((p) => ({ ...siteScrobble(p.timestamp, p.artist, p.track, p.album), albumArtist: "Radiohead (Band)" })));

async function applyJob(kind: "edit" | "delete", website: FakeLastFmWebsite, pro: boolean | null = true) {
  lastFmHistory(plays);
  const view = await renderSignedIn(pro, website);
  await waitFor(() => expect(fact("Scrobbles")).toBe("3"));
  await view.user.click(screen.getByRole("button", { name: /^Filter$/ }));
  const editor = within(screen.getByRole("form", { name: "New filter" }));
  await view.user.selectOptions(editor.getByLabelText("Field"), "artist");
  await view.user.type(editor.getByLabelText("Value"), "Radiohead");
  await view.user.click(editor.getByRole("button", { name: "Add filter" }));
  await view.user.click(screen.getByRole("checkbox", { name: "Select all matching scrobbles" }));
  if (kind === "edit") {
    await view.user.click(screen.getByRole("button", { name: "Edit 3 scrobbles" }));
    await view.user.type(within(preview().getByRole("group", { name: "Changes" })).getByLabelText("Find"), " - Remastered");
    await view.user.click(preview().getByRole("button", { name: "Edit 3 scrobbles" }));
    await preview().findByText("3 edited");
  } else {
    await view.user.click(screen.getByRole("button", { name: "Delete 3 scrobbles" }));
    await view.user.click(preview().getByRole("button", { name: "Delete 3 scrobbles" }));
    await preview().findByText("3 deleted");
  }
  await view.user.click(preview().getByRole("button", { name: "Done" }));
  await view.user.click(screen.getByRole("link", { name: "Change log" }));
  return view;
}

const entry = (name: RegExp) => within(screen.getByRole("region", { name }));

describe("the Change Log", () => {
  it("records each applied change with its before and after values", async () => {
    await applyJob("edit", websiteWith(plays));

    const edited = entry(/^Edited 3 scrobbles/);
    expect(edited.getAllByText("- Remastered", { selector: "del" })).toHaveLength(3);
    expect(edited.getByRole("button", { name: "Undo" })).toBeEnabled();
  });

  it("undoes an Edit by restoring the exact values Last.fm had, album artist included", async () => {
    const website = websiteWith(plays);
    const { user } = await applyJob("edit", website);

    await user.click(entry(/^Edited 3 scrobbles/).getByRole("button", { name: "Undo" }));
    expect(preview().getByRole("heading", { name: "Undo edit of 3 scrobbles" })).toBeInTheDocument();
    expect(preview().getAllByText("- Remastered", { selector: "ins" })).toHaveLength(3);
    await user.click(preview().getByRole("button", { name: "Restore 3 scrobbles" }));

    expect(await preview().findByText("3 edited")).toBeInTheDocument();
    expect(website.library.map((s) => s.track).sort()).toEqual(["Airbag - Remastered", "Let Down - Remastered", "Lucky - Remastered"]);
    const restores = website.calls.filter((c) => c.op === "editScrobble").slice(-3);
    expect(restores.every((c) => c.editAll === false && c.updated?.albumArtist === "Radiohead (Band)")).toBe(true);
    await waitFor(() => expect(entry(/^Edited 3 scrobbles/).getByText("Undone")).toBeInTheDocument());
    expect(entry(/^Edited 3 scrobbles/).queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("undoes a Delete only for Scrobbles Last.fm will accept again", async () => {
    const submitted: { bearer: string | null; scrobbles: { track: string; timestamp: number; album?: string }[] }[] = [];
    server.use(http.post(`${BACKEND}/api/scrobbles`, async ({ request }) => {
      const body = (await request.json()) as { scrobbles: { artist: string; track: string; timestamp: number; album?: string }[] };
      submitted.push({ bearer: request.headers.get("Authorization"), scrobbles: body.scrobbles });
      return HttpResponse.json({ results: body.scrobbles.map((e) => ({ status: "accepted", artist: e.artist, artistCorrected: false, track: e.track, trackCorrected: false })) });
    }));
    const { user } = await applyJob("delete", websiteWith(plays));
    expect(screen.queryByRole("table", { name: "Scrobbles" })).not.toBeInTheDocument();

    await user.click(entry(/^Deleted 3 scrobbles/).getByRole("button", { name: "Undo" }));

    expect(preview().getByText("1 scrobble is older than 14 days. Last.fm won't accept it again, so it can't be restored.")).toBeInTheDocument();
    expect(within(preview().getAllByRole("listitem").find((li) => li.textContent?.includes("Lucky"))!).getByText("Can't be restored")).toBeInTheDocument();
    await user.click(preview().getByRole("button", { name: "Scrobble 2 scrobbles again" }));

    expect(await preview().findByText("2 restored")).toBeInTheDocument();
    expect(submitted).toHaveLength(1);
    expect(submitted[0]!.bearer).toBe("Bearer rescrobble-token");
    expect(submitted[0]!.scrobbles.map((s) => [s.track, s.timestamp, s.album])).toEqual([
      ["Airbag - Remastered", plays[0]!.timestamp, album],
      ["Let Down - Remastered", plays[1]!.timestamp, album],
    ]);
    await user.click(screen.getByRole("link", { name: "History" }));
    expect(fact("Scrobbles")).toBe("2");
  });

  it("exports the Change Log as JSON", async () => {
    await applyJob("delete", websiteWith(plays));
    const created: Blob[] = [];
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => (created.push(blob as Blob), "blob:change-log"));
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    screen.getByRole("button", { name: "Export as JSON" }).click();

    expect(click).toHaveBeenCalledOnce();
    const exported = JSON.parse(await created[0]!.text());
    expect(exported[0].kind).toBe("delete");
    expect(exported[0].entries.map((e: { target: { track: string } }) => e.target.track)).toContain("Airbag - Remastered");
    createObjectURL.mockRestore();
  });

  it("clears after confirmation", async () => {
    const { user } = await applyJob("delete", websiteWith(plays));

    await user.click(screen.getByRole("button", { name: "Clear change log" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Clear all 1 entries?");
    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(await screen.findByText(/^Edits and deletes you apply are recorded here/)).toBeInTheDocument();
  });
});

describe("Undo without Pro", () => {
  it("can't undo an Edit, and says why", async () => {
    const website = websiteWith(plays);
    const first = await applyJob("edit", website);
    first.unmount();

    const second = await renderSignedIn(false, website);
    await second.user.click(screen.getByRole("link", { name: "Change log" }));

    const edited = entry(/^Edited 3 scrobbles/);
    expect(edited.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(edited.getByText("Undoing an edit needs Last.fm Pro.")).toBeInTheDocument();
  });
});
