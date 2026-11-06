import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { LASTFM_API_URL } from "@rescrobble/core";
import { server } from "./test/server.ts";
import { renderSignedIn, scrobbleEndpoint } from "./test/app.tsx";

interface Search { track: string | null; artist: string | null; apiKey: string | null }

/** Answers track.search with `matches(query)` and records each search. */
function lastFmTrackSearch(matches: (query: string) => [string, string][], latency: (query: string) => number = () => 0) {
  const searches: Search[] = [];
  server.use(http.get(LASTFM_API_URL, async ({ request }) => {
    const url = new URL(request.url);
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
