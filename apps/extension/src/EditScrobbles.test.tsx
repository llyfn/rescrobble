import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { lastFmHistory, type Play } from "./test/lastfmHistory.ts";
import { FakeLastFmWebsite, siteScrobble } from "./test/fakeWebsite.ts";
import { renderSignedIn } from "./test/extension.tsx";

const now = Math.floor(Date.now() / 1000);
const DAY = 86_400;
const album = "OK Computer OKNOTOK 1997 2017";
const plays: Play[] = [
  { timestamp: now - 2 * DAY, artist: "Radiohead", track: "Airbag - Remastered", album },
  { timestamp: now - 3 * DAY, artist: "Radiohead", track: "Airbag - Remastered", album },
  { timestamp: now - 30 * DAY, artist: "Radiohead", track: "Let Down - Remastered", album },
  { timestamp: now - 40 * DAY, artist: "Radiohead", track: "Lucky", album },
];

const fact = (name: string) => screen.queryByText(name, { selector: "dt" })?.nextElementSibling?.textContent;
const preview = () => within(screen.getByRole("complementary", { name: "Preview" }));
const websiteWith = (list: Play[]) => new FakeLastFmWebsite(list.map((p) => siteScrobble(p.timestamp, p.artist, p.track, p.album)));

async function openWithRadioheadSelected(website: FakeLastFmWebsite, pro: boolean | null = true) {
  lastFmHistory(plays);
  const view = await renderSignedIn(pro, website);
  await waitFor(() => expect(fact("Scrobbles")).toBe("4"));
  await view.user.click(screen.getByRole("button", { name: /^Filter$/ }));
  const editor = within(screen.getByRole("form", { name: "New filter" }));
  await view.user.selectOptions(editor.getByLabelText("Field"), "artist");
  await view.user.type(editor.getByLabelText("Value"), "Radiohead");
  await view.user.click(editor.getByRole("button", { name: "Add filter" }));
  return view;
}

async function describeRemoveRemastered(user: Awaited<ReturnType<typeof renderSignedIn>>["user"]) {
  await user.click(screen.getByRole("button", { name: "Edit 4 scrobbles" }));
  const changes = within(preview().getByRole("group", { name: "Changes" }));
  await user.type(changes.getByLabelText("Find"), " - Remastered");
}

describe("editing selected Scrobbles", () => {
  it("previews each change as an edit record and leaves out Scrobbles it wouldn't change", async () => {
    const { user } = await openWithRadioheadSelected(websiteWith(plays));

    await describeRemoveRemastered(user);

    expect(preview().getByRole("heading", { name: "Edit 3 scrobbles" })).toBeInTheDocument();
    expect(preview().getAllByText("- Remastered", { selector: "del" })).toHaveLength(3);
    expect(preview().getByText("1 selected scrobble wouldn't change and is left out.")).toBeInTheDocument();
    expect(preview().queryByText("Lucky")).not.toBeInTheDocument();
  });

  it("sets a field to a value", async () => {
    const { user } = await openWithRadioheadSelected(websiteWith(plays));
    await user.click(screen.getByRole("button", { name: "Edit 4 scrobbles" }));
    const changes = within(preview().getByRole("group", { name: "Changes" }));

    await user.selectOptions(changes.getByLabelText("Field"), "album");
    await user.selectOptions(changes.getByLabelText("Change"), "set");
    await user.type(changes.getByLabelText("New value"), "OK Computer");

    expect(preview().getByRole("heading", { name: "Edit 4 scrobbles" })).toBeInTheDocument();
    expect(preview().getAllByText("OKNOTOK 1997 2017", { exact: false, selector: "del" }).length).toBeGreaterThan(0);
  });

  it("flags an invalid regex and won't start", async () => {
    const { user } = await openWithRadioheadSelected(websiteWith(plays));
    await user.click(screen.getByRole("button", { name: "Edit 4 scrobbles" }));
    const changes = within(preview().getByRole("group", { name: "Changes" }));

    await user.click(changes.getByLabelText("Regex"));
    await user.type(changes.getByLabelText("Find"), "Remaster(");

    expect(changes.getByRole("alert")).toHaveTextContent(/^Not a valid regex:/);
    expect(preview().getByRole("button", { name: "Edit 0 scrobbles" })).toBeDisabled();
  });

  it("applies the Edit, once for a Track whose every Scrobble is selected, and updates the Mirror", async () => {
    const website = websiteWith(plays);
    const { user } = await openWithRadioheadSelected(website);
    await describeRemoveRemastered(user);

    await user.click(preview().getByRole("button", { name: "Edit 3 scrobbles" }));

    expect(await preview().findByText("3 edited")).toBeInTheDocument();
    const edits = website.calls.filter((c) => c.op === "editScrobble");
    expect(edits.map((c) => [c.track, c.updated?.track, c.editAll])).toEqual([
      ["Airbag - Remastered", "Airbag", true],
      ["Let Down - Remastered", "Let Down", false],
    ]);
    expect(edits[0]!.original).toMatchObject({ album, albumArtist: "Radiohead" });
    expect(website.library.map((s) => s.track).sort()).toEqual(["Airbag", "Airbag", "Let Down", "Lucky"]);
    await waitFor(() => expect(screen.getByRole("table", { name: "Scrobbles" })).toHaveTextContent("Let Down"));
    expect(screen.getByRole("table", { name: "Scrobbles" })).not.toHaveTextContent("Remastered");
  });

  it("edits one at a time when some of a Track's Scrobbles aren't selected", async () => {
    const website = websiteWith([...plays, { timestamp: now - 400 * DAY, artist: "Radiohead", track: "Airbag - Remastered", album }]);
    const { user } = await openWithRadioheadSelected(website);
    await describeRemoveRemastered(user);

    await user.click(preview().getByRole("button", { name: "Edit 3 scrobbles" }));

    await preview().findByText("3 edited");
    expect(website.calls.filter((c) => c.op === "editScrobble").map((c) => c.editAll)).toEqual([false, false, false]);
  });

  it("isn't offered to accounts without Last.fm Pro", async () => {
    await openWithRadioheadSelected(websiteWith(plays), false);

    expect(screen.getByRole("button", { name: "Edit 4 scrobbles" })).toBeDisabled();
    expect(screen.getByText("Editing needs Last.fm Pro. You can still delete scrobbles.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete 4 scrobbles" })).toBeEnabled();
  });

  it("stops if the website shows editing isn't available, whatever the account flag said", async () => {
    const website = websiteWith(plays);
    website.pro = false;
    const { user } = await openWithRadioheadSelected(website, true);
    await describeRemoveRemastered(user);

    await user.click(preview().getByRole("button", { name: "Edit 3 scrobbles" }));

    expect(await preview().findByRole("alert")).toHaveTextContent("Last.fm doesn't offer editing on this account. Editing needs Last.fm Pro.");
    expect(website.calls.filter((c) => c.op === "editScrobble")).toHaveLength(0);
  });
});
