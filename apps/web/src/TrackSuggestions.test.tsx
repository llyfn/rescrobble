import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { LASTFM_API_URL } from "@rescrobble/core";
import { server } from "./test/server.ts";
import { renderSignedIn, scrobbleEndpoint } from "./test/app.tsx";

interface Search { track: string | null; artist: string | null; apiKey: string | null }

/** Answers track.search with `matches(query)` and records each search. Tracks are filed under no album unless `albums` names one. */
function lastFmTrackSearch(
  matches: (query: string) => [string, string][],
  latency: (query: string) => number = () => 0,
  albums: Record<string, string> = {},
) {
  const searches: Search[] = [];
  server.use(http.get(LASTFM_API_URL, async ({ request }) => {
    const url = new URL(request.url);
    const method = url.searchParams.get("method");
    if (method === "track.getInfo") {
      const album = albums[url.searchParams.get("track") ?? ""];
      return HttpResponse.json({ track: { name: url.searchParams.get("track"), ...(album ? { album: { title: album, image: [] } } : {}) } });
    }
    if (method !== "track.search") return HttpResponse.json({ results: {} });
    const query = url.searchParams.get("track") ?? "";
    searches.push({ track: query, artist: url.searchParams.get("artist"), apiKey: url.searchParams.get("api_key") });
    await delay(latency(query));
    const track = matches(query).map(([artist, name]) => ({ name, artist, url: "", listeners: "1" }));
    return HttpResponse.json({ results: { trackmatches: { track: track.length === 1 ? track[0] : track } } });
  }));
  return searches;
}

const suggestionList = () => screen.findByRole("listbox", { name: "Track suggestions" });

describe("track suggestions", () => {
  it("suggests tracks from Last.fm and fills Artist and Track when one is picked", async () => {
    const searches = lastFmTrackSearch(() => [["Cher", "Believe"], ["Cher", "Believe (Almighty Mix)"]]);
    const { user } = await renderSignedIn();

    await user.type(screen.getByLabelText("Track", { selector: "input" }), "belie");
    await user.click(within(await suggestionList()).getByRole("option", { name: /Believe \(Almighty Mix\)/ }));

    expect(screen.getByLabelText("Artist", { selector: "input" })).toHaveValue("Cher");
    expect(screen.getByLabelText("Track", { selector: "input" })).toHaveValue("Believe (Almighty Mix)");
    expect(screen.queryByRole("listbox", { name: "Track suggestions" })).not.toBeInTheDocument();
    expect(searches.at(-1)).toEqual({ track: "belie", artist: null, apiKey: "test-api-key" });
  });

  it("can be driven by keyboard and closed with Escape", async () => {
    lastFmTrackSearch(() => [["Cher", "Believe"], ["Cher", "Strong Enough"]]);
    const { user } = await renderSignedIn();

    await user.type(screen.getByLabelText("Track", { selector: "input" }), "cher");
    await suggestionList();
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(screen.getByLabelText("Track", { selector: "input" })).toHaveValue("Strong Enough");

    await user.type(screen.getByLabelText("Track", { selector: "input" }), "!");
    await suggestionList();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox", { name: "Track suggestions" })).not.toBeInTheDocument();
  });

  it("narrows the search by the artist already entered", async () => {
    const searches = lastFmTrackSearch(() => [["Cher", "Believe"]]);
    const { user } = await renderSignedIn();

    await user.type(screen.getByLabelText("Artist", { selector: "input" }), "Cher");
    await user.type(screen.getByLabelText("Track", { selector: "input" }), "be");
    await suggestionList();

    expect(searches.at(-1)).toMatchObject({ track: "be", artist: "Cher" });
  });

  it("waits for two characters and a pause before searching", async () => {
    const searches = lastFmTrackSearch(() => [["Cher", "Believe"]]);
    const { user } = await renderSignedIn();

    await user.type(screen.getByLabelText("Track", { selector: "input" }), "b");
    await new Promise((r) => setTimeout(r, 400));
    expect(searches).toHaveLength(0);

    await user.type(screen.getByLabelText("Track", { selector: "input" }), "elieve");
    await suggestionList();
    expect(searches.map((s) => s.track)).toEqual(["believe"]);
  });

  it("never lets a slow earlier answer replace newer suggestions", async () => {
    lastFmTrackSearch(
      (query) => (query === "bel" ? [["Old", "Stale Result"]] : [["Cher", "Believe"]]),
      (query) => (query === "bel" ? 600 : 0),
    );
    const { user } = await renderSignedIn();

    await user.type(screen.getByLabelText("Track", { selector: "input" }), "bel");
    await new Promise((r) => setTimeout(r, 350));
    await user.type(screen.getByLabelText("Track", { selector: "input" }), "ieve");
    const list = await suggestionList();
    await new Promise((r) => setTimeout(r, 700));

    expect(within(list).getByRole("option", { name: /Believe/ })).toBeInTheDocument();
    expect(screen.queryByText("Stale Result")).not.toBeInTheDocument();
  });

  it("stays out of the way when Last.fm search fails", async () => {
    server.use(http.get(LASTFM_API_URL, () => HttpResponse.json({ error: 11, message: "Service Offline" }, { status: 503 })));
    const requests = scrobbleEndpoint();
    const { user } = await renderSignedIn();

    await user.type(screen.getByLabelText("Artist", { selector: "input" }), "Cher");
    await user.type(screen.getByLabelText("Track", { selector: "input" }), "Believe");
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryByRole("listbox", { name: "Track suggestions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add scrobble" }));
    await waitFor(() => expect(requests).toHaveLength(1));
  });
});

const input = (label: string) => screen.getByLabelText(label, { selector: "input" });

describe("the Add track form", () => {
  it("asks for the track first, then the artist and album", async () => {
    await renderSignedIn();

    const fields = [...document.querySelectorAll("form label")].map((l) => l.textContent);
    expect(fields).toEqual(["Track", "Artist", "Album", "Played at"]);
  });

  it("fills Album with the picked track's album", async () => {
    lastFmTrackSearch(() => [["Radiohead", "Paranoid Android"], ["Radiohead", "Let Down"]], undefined, { "Paranoid Android": "OK Computer" });
    const { user } = await renderSignedIn();

    await user.type(input("Track"), "paranoid");
    await user.click(within(await suggestionList()).getByRole("option", { name: /Paranoid Android/ }));

    await waitFor(() => expect(input("Album")).toHaveValue("OK Computer"));
  });

  it("replaces a filled-in album when another track is picked, and keeps one the user typed", async () => {
    lastFmTrackSearch(() => [["Radiohead", "Paranoid Android"], ["Radiohead", "Let Down"]], undefined, { "Paranoid Android": "OK Computer" });
    const { user } = await renderSignedIn();

    await user.type(input("Track"), "paranoid");
    await user.click(within(await suggestionList()).getByRole("option", { name: /Paranoid Android/ }));
    await waitFor(() => expect(input("Album")).toHaveValue("OK Computer"));

    await user.clear(input("Track"));
    await user.type(input("Track"), "let");
    await user.click(within(await suggestionList()).getByRole("option", { name: /Let Down/ }));
    await waitFor(() => expect(input("Album")).toHaveValue(""));

    await user.type(input("Album"), "My Mixtape");
    await user.clear(input("Track"));
    await user.type(input("Track"), "paranoid");
    await user.click(within(await suggestionList()).getByRole("option", { name: /Paranoid Android/ }));
    await new Promise((r) => setTimeout(r, 50));
    expect(input("Album")).toHaveValue("My Mixtape");
  });

  it("suggests artists and fills Artist when one is picked", async () => {
    server.use(http.get(LASTFM_API_URL, ({ request }) => {
      const params = new URL(request.url).searchParams;
      if (params.get("method") !== "artist.search") return HttpResponse.json({ results: {} });
      return HttpResponse.json({ results: { artistmatches: { artist: [{ name: "Radiohead" }, { name: "Radio Dept." }] } } });
    }));
    const { user } = await renderSignedIn();

    await user.type(input("Artist"), "radio");
    await user.click(within(await screen.findByRole("listbox", { name: "Artist suggestions" })).getByRole("option", { name: "Radiohead" }));

    expect(input("Artist")).toHaveValue("Radiohead");
  });

  it("suggests albums with their art, and fills the artist from a picked album when none is entered", async () => {
    server.use(http.get(LASTFM_API_URL, ({ request }) => {
      const params = new URL(request.url).searchParams;
      if (params.get("method") !== "album.search") return HttpResponse.json({ results: {} });
      return HttpResponse.json({ results: { albummatches: { album: [
        { name: "OK Computer", artist: "Radiohead", image: [{ size: "large", "#text": "https://lastfm.freetls.fastly.net/i/u/174s/ok.png" }] },
        { name: "OK Computer", artist: "Tribute", image: [{ size: "large", "#text": "" }] },
      ] } } });
    }));
    const { user, container } = await renderSignedIn();

    await user.type(input("Album"), "ok comp");
    const list = await screen.findByRole("listbox", { name: "Album suggestions" });

    expect([...container.querySelectorAll(".rs-listbox .rs-art")].map((a) => a.getAttribute("src"))).toEqual(["https://lastfm.freetls.fastly.net/i/u/174s/ok.png", null]);
    await user.click(within(list).getByRole("option", { name: /Radiohead/ }));
    expect(input("Album")).toHaveValue("OK Computer");
    expect(input("Artist")).toHaveValue("Radiohead");
  });

  it("empties a field with its clear button, which appears only once there is text", async () => {
    const { user } = await renderSignedIn();

    expect(screen.queryByRole("button", { name: "Clear Track" })).not.toBeInTheDocument();
    await user.type(input("Track"), "Believe");
    await user.click(screen.getByRole("button", { name: "Clear Track" }));

    expect(input("Track")).toHaveValue("");
    expect(input("Track")).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Clear Track" })).not.toBeInTheDocument();
  });
});
