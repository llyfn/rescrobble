import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { LASTFM_API_URL } from "@rescrobble/core";
import { server } from "./test/server.ts";
import { renderSignedIn, scrobbleEndpoint } from "./test/app.tsx";

const now = new Date("2026-11-06T21:10:30Z");
const at = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

interface FakeTrack { name: string; duration: number | null; artist?: string }
const radiohead: FakeTrack[] = [
  { name: "Airbag", duration: 300 },
  { name: "Paranoid Android", duration: 240 },
  { name: "Fitter Happier", duration: null },
  { name: "Lucky", duration: 180 },
];

/** Fakes Last.fm's album.search and album.getinfo for one album. */
function lastFmAlbum(artist: string, name: string, tracks: FakeTrack[] | "notFound") {
  const lookups: string[] = [];
  server.use(http.get(LASTFM_API_URL, ({ request }) => {
    const params = new URL(request.url).searchParams;
    const method = params.get("method");
    if (method === "album.search") {
      return HttpResponse.json({ results: { albummatches: { album: [{ name, artist }, { name: `${name} (Deluxe)`, artist }] } } });
    }
    if (method === "album.getinfo") {
      lookups.push(`${params.get("artist")} / ${params.get("album")}`);
      if (tracks === "notFound") return HttpResponse.json({ error: 6, message: "Album not found" }, { status: 404 });
      const track = tracks.map((t, i) => ({ name: t.name, duration: t.duration, "@attr": { rank: i + 1 }, artist: { name: t.artist ?? artist } }));
      return HttpResponse.json({ album: { name, artist, tracks: tracks.length === 0 ? "" : { track: track.length === 1 ? track[0] : track } } });
    }
    return HttpResponse.json({ results: {} });
  }));
  return lookups;
}

const input = (label: string) => screen.getByLabelText(label, { selector: "input" });
const tracklist = (name: string) => within(screen.getByRole("list", { name }));

async function openAlbumTab() {
  const view = await renderSignedIn();
  await view.user.click(screen.getByRole("tab", { name: "Album" }));
  return view;
}

async function findAlbum(user: Awaited<ReturnType<typeof renderSignedIn>>["user"], artist: string, album: string) {
  await user.type(input("Artist"), artist);
  await user.type(input("Album"), album);
  await user.click(screen.getByRole("button", { name: "Find album" }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
});
afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

describe("finding an album", () => {
  it("asks for the album first, then the artist", async () => {
    await openAlbumTab();

    const fields = [...document.querySelectorAll("form label")].map((l) => l.textContent);
    expect(fields).toEqual(["Album", "Artist"]);
  });

  it("loads the tracklist when an album suggestion is picked", async () => {
    const lookups = lastFmAlbum("Radiohead", "OK Computer", radiohead);
    const { user } = await openAlbumTab();

    await user.type(input("Album"), "ok comp");
    await user.click(await screen.findByRole("option", { name: /^OK Computer\s*Radiohead$/ }));

    expect(await screen.findByRole("list", { name: "OK Computer" })).toBeInTheDocument();
    expect(input("Artist")).toHaveValue("Radiohead");
    expect(lookups).toEqual(["Radiohead / OK Computer"]);
  });

  it("loads the tracklist from the typed artist and album", async () => {
    lastFmAlbum("Radiohead", "OK Computer", radiohead);
    const { user } = await openAlbumTab();

    await findAlbum(user, "Radiohead", "OK Computer");

    expect(await screen.findByRole("list", { name: "OK Computer" })).toBeInTheDocument();
  });

  it("says so when Last.fm has no tracklist for the album", async () => {
    lastFmAlbum("Someone", "Untitled", []);
    const { user } = await openAlbumTab();

    await findAlbum(user, "Someone", "Untitled");

    expect(await screen.findByText("Last.fm has no tracklist for this album.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Scrobble/ })).not.toBeInTheDocument();
  });

  it("says so when Last.fm doesn't know the album", async () => {
    lastFmAlbum("Someone", "Nothing", "notFound");
    const { user } = await openAlbumTab();

    await findAlbum(user, "Someone", "Nothing");

    expect(await screen.findByText("Last.fm doesn't know this album. Check the artist and album names.")).toBeInTheDocument();
  });

  it("keeps the Album tab across a refresh", async () => {
    const { unmount } = await openAlbumTab();
    expect(window.location.search).toBe("?tab=album");

    unmount();
    await renderSignedIn();

    expect(screen.getByRole("tab", { name: "Album" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("timing the album", () => {
  it("starts at now minus the album's length and times each track from the one before", async () => {
    lastFmAlbum("Radiohead", "OK Computer", radiohead);
    const { user } = await openAlbumTab();
    await findAlbum(user, "Radiohead", "OK Computer");

    const list = tracklist(await screen.findByRole("list").then((l) => l.getAttribute("aria-label")!));
    expect(input("Started listening")).toHaveValue("2026-11-06T20:55");
    expect(list.getAllByRole("listitem").map((li) => li.querySelector("time")?.textContent)).toEqual(["20:55", "21:00", "21:04", "21:07"]);
    expect(screen.getByText("4 of 4 tracks · 15:30")).toBeInTheDocument();
    expect(screen.getByText("20:55 – 21:10")).toBeInTheDocument();
  });

  it("marks a track with no length as an estimated 3:30", async () => {
    lastFmAlbum("Radiohead", "OK Computer", radiohead);
    const { user } = await openAlbumTab();
    await findAlbum(user, "Radiohead", "OK Computer");

    const fitter = (await screen.findByText("Fitter Happier")).closest("li")!;
    expect(fitter).toHaveTextContent("3:30");
    expect(within(fitter).getByTitle("Last.fm has no length for this track, so 3:30 is assumed.")).toBeInTheDocument();
  });

  it("retimes the tracks when one is unticked, without moving the start", async () => {
    lastFmAlbum("Radiohead", "OK Computer", radiohead);
    const { user } = await openAlbumTab();
    await findAlbum(user, "Radiohead", "OK Computer");

    await user.click(await screen.findByRole("checkbox", { name: "Include Paranoid Android" }));

    const times = screen.getAllByRole("listitem").filter((li) => li.closest("ol")).map((li) => li.querySelector("time")?.textContent);
    expect(times).toEqual(["20:55", "", "21:00", "21:03"]);
    expect(input("Started listening")).toHaveValue("2026-11-06T20:55");
    expect(screen.getByText("3 of 4 tracks · 11:30")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scrobble 3 tracks" })).toBeInTheDocument();
  });
});

describe("scrobbling the album", () => {
  it("sends every ticked track in order with its album and computed time", async () => {
    lastFmAlbum("Radiohead", "OK Computer", radiohead);
    const requests = scrobbleEndpoint();
    const { user } = await openAlbumTab();
    await findAlbum(user, "Radiohead", "OK Computer");

    await user.click(await screen.findByRole("checkbox", { name: "Include Lucky" }));
    await user.click(screen.getByRole("button", { name: "Scrobble 3 tracks" }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toEqual([
      { artist: "Radiohead", track: "Airbag", album: "OK Computer", timestamp: at("2026-11-06T20:55:00Z") },
      { artist: "Radiohead", track: "Paranoid Android", album: "OK Computer", timestamp: at("2026-11-06T21:00:00Z") },
      { artist: "Radiohead", track: "Fitter Happier", album: "OK Computer", timestamp: at("2026-11-06T21:04:00Z") },
    ]);
    const session = within(screen.getByRole("region", { name: "This session" }));
    expect(await session.findAllByText("Added")).toHaveLength(3);
  });

  it("sends the album artist when it differs from the track artist", async () => {
    lastFmAlbum("Various Artists", "Trainspotting", [
      { name: "Lust for Life", duration: 300, artist: "Iggy Pop" },
      { name: "Born Slippy .NUXX", duration: 300, artist: "Underworld" },
    ]);
    const requests = scrobbleEndpoint();
    const { user } = await openAlbumTab();
    await findAlbum(user, "Various Artists", "Trainspotting");

    await user.click(await screen.findByRole("button", { name: "Scrobble 2 tracks" }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]?.map((e) => [e.artist, e.albumArtist])).toEqual([["Iggy Pop", "Various Artists"], ["Underworld", "Various Artists"]]);
  });

  it("sends a 51-track album as two requests of 50 and 1, in order", async () => {
    lastFmAlbum("Box", "Set", Array.from({ length: 51 }, (_, i) => ({ name: `Part ${i + 1}`, duration: 60 })));
    const requests = scrobbleEndpoint();
    const { user } = await openAlbumTab();
    await findAlbum(user, "Box", "Set");

    await user.click(await screen.findByRole("button", { name: "Scrobble 51 tracks" }));

    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests.map((r) => r.length)).toEqual([50, 1]);
    expect(requests[0]?.[0]?.track).toBe("Part 1");
    expect(requests[1]?.[0]?.track).toBe("Part 51");
  });

  it("after a failure partway through, a retry sends only the tracks that didn't go through", async () => {
    lastFmAlbum("Box", "Set", Array.from({ length: 51 }, (_, i) => ({ name: `Part ${i + 1}`, duration: 60 })));
    const requests: { track: string; timestamp: number }[][] = [];
    let failNext = false;
    server.use(http.post("/api/scrobbles", async ({ request }) => {
      const body = await request.json() as { scrobbles: { artist: string; track: string; timestamp: number }[] };
      requests.push(body.scrobbles);
      if (failNext) {
        failNext = false;
        return HttpResponse.json({ error: "lastFmUnavailable" }, { status: 503 });
      }
      failNext = requests.length === 1;
      return HttpResponse.json({ results: body.scrobbles.map((e) => ({ status: "accepted", artist: e.artist, artistCorrected: false, track: e.track, trackCorrected: false })) });
    }));
    const { user } = await openAlbumTab();
    await findAlbum(user, "Box", "Set");

    await user.click(await screen.findByRole("button", { name: "Scrobble 51 tracks" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Last.fm isn't responding.");
    const timeOfLast = requests[1]?.[0]?.timestamp;
    expect(screen.getByRole("checkbox", { name: "Include Part 1" })).toBeDisabled();
    expect(screen.getAllByText("Sent", { selector: ".sent" })).toHaveLength(50);

    await user.click(screen.getByRole("button", { name: "Scrobble 1 track" }));

    await waitFor(() => expect(requests).toHaveLength(3));
    expect(requests[2]).toEqual([expect.objectContaining({ track: "Part 51", timestamp: timeOfLast })]);
  });

  it("refuses a start that puts tracks more than 14 days back, then accepts the boundary", async () => {
    lastFmAlbum("Radiohead", "OK Computer", radiohead);
    const requests = scrobbleEndpoint();
    vi.setSystemTime(new Date("2026-11-06T21:10:00Z"));
    const { user } = await openAlbumTab();
    await findAlbum(user, "Radiohead", "OK Computer");
    await screen.findByRole("list", { name: "OK Computer" });

    fireEvent.change(input("Started listening"), { target: { value: "2026-10-23T21:05" } });
    await user.click(screen.getByRole("button", { name: "Scrobble 4 tracks" }));
    expect(screen.getByRole("alert")).toHaveTextContent("The first track would be more than 14 days ago.");

    fireEvent.change(input("Started listening"), { target: { value: "2026-10-23T21:00" } });
    await user.click(screen.getByRole("button", { name: "Scrobble 4 tracks" }));
    expect(screen.getByRole("alert")).toHaveTextContent("The first 3 tracks would be more than 14 days ago.");
    expect(requests).toEqual([]);

    fireEvent.change(input("Started listening"), { target: { value: "2026-10-23T21:10" } });
    await user.click(screen.getByRole("button", { name: "Scrobble 4 tracks" }));
    await waitFor(() => expect(requests).toHaveLength(1));
  });

  it("refuses a start that puts tracks in the future", async () => {
    lastFmAlbum("Radiohead", "OK Computer", radiohead);
    const requests = scrobbleEndpoint();
    const { user } = await openAlbumTab();
    await findAlbum(user, "Radiohead", "OK Computer");
    await screen.findByRole("list", { name: "OK Computer" });

    fireEvent.change(input("Started listening"), { target: { value: "2026-11-06T21:05" } });
    await user.click(screen.getByRole("button", { name: "Scrobble 4 tracks" }));

    expect(screen.getByRole("alert")).toHaveTextContent("The last 2 tracks would be in the future.");
    expect(requests).toEqual([]);
  });
});
