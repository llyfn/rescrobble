import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../test/server.ts";
import { FIXTURE_CSRF, libraryPage, rateLimitedPage, type FixtureRow } from "./fixtures/pages.ts";
import { LastFmSite, parseTrackPage, pathName, trackPageUrl } from "./lastfmPages.ts";

const row = (timestamp: number, over: Partial<FixtureRow> = {}): FixtureRow => ({
  artist: "Radiohead", track: "Airbag - Remastered", album: "OK Computer OKNOTOK 1997 2017", albumArtist: "Radiohead", timestamp, ...over,
});

const site = () => new LastFmSite((input, init) => fetch(input, init));

function servePages(pages: string[]) {
  const seen: string[] = [];
  server.use(http.get("https://www.last.fm/user/:user/library/music/*", ({ request }) => {
    seen.push(request.url);
    const page = Number(new URL(request.url).searchParams.get("page") ?? 1);
    return new HttpResponse(pages[page - 1], { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }));
  return seen;
}

describe("last.fm library pages", () => {
  it("names a Track's page the way last.fm does", () => {
    expect(pathName("Sigur Rós")).toBe("Sigur+R%C3%B3s");
    expect(pathName("AC/DC")).toBe("AC%2FDC");
    expect(pathName("1+1")).toBe("1%2B1");
    expect(trackPageUrl("rj", "Sigur Rós", "Hoppípolla", 2)).toBe(
      "https://www.last.fm/user/rj/library/music/+noredirect/Sigur+R%C3%B3s/_/Hopp%C3%ADpolla?page=2",
    );
  });

  it("reads each scrobble's exact values from the page's own forms", () => {
    const page = parseTrackPage(libraryPage("rj", [row(1790000600, { album: "Café & \"Live\"" }), row(1790000300)]));

    expect(page.scrobbles).toEqual([
      { artist: "Radiohead", track: "Airbag - Remastered", album: "Café & \"Live\"", albumArtist: "Radiohead", timestamp: 1790000600 },
      { artist: "Radiohead", track: "Airbag - Remastered", album: "OK Computer OKNOTOK 1997 2017", albumArtist: "Radiohead", timestamp: 1790000300 },
    ]);
    expect(page.canEdit).toBe(true);
    expect(page.ownLibrary).toBe(true);
    expect(page.csrf).toBe(FIXTURE_CSRF);
    expect(page.deleteAction).toBe("/user/rj/library/delete");
  });

  it("sees that a non-Pro library offers no editing", () => {
    expect(parseTrackPage(libraryPage("rj", [row(1)], { pro: false })).canEdit).toBe(false);
  });

  it("reads scrobbles across every page of a Track", async () => {
    const seen = servePages([
      libraryPage("rj", [row(3), row(2)], { page: 1, pages: 2 }),
      libraryPage("rj", [row(1)], { page: 2, pages: 2 }),
    ]);

    const result = await site().listTrack("rj", "Radiohead", "Airbag - Remastered");

    expect(result.ok && result.scrobbles.map((s) => s.timestamp)).toEqual([3, 2, 1]);
    expect(seen.map((u) => new URL(u).searchParams.get("page"))).toEqual(["1", "2"]);
  });

  it("reports logged out when the rows carry no delete forms", async () => {
    servePages([libraryPage("rj", [row(1)], { own: false })]);

    expect(await site().listTrack("rj", "Radiohead", "Airbag - Remastered")).toEqual({ ok: false, reason: "loggedOut" });
  });

  it.each([
    [406, { ok: false, reason: "blocked" }],
    [429, { ok: false, reason: "rateLimited", status: 429 }],
    [503, { ok: false, reason: "rateLimited", status: 503 }],
    [404, { ok: false, reason: "notFound" }],
  ])("maps HTTP %i to a typed result", async (status, expected) => {
    server.use(http.get("https://www.last.fm/user/:user/library/music/*", () => new HttpResponse(rateLimitedPage, { status })));

    expect(await site().listTrack("rj", "Radiohead", "Airbag - Remastered")).toEqual(expected);
  });
});

describe("deleting through the website", () => {
  it("posts exactly the form the page's delete button would", async () => {
    servePages([libraryPage("rj", [row(1790000300)])]);
    const posts: { url: string; headers: Headers; body: URLSearchParams }[] = [];
    server.use(http.post("https://www.last.fm/user/rj/library/delete", async ({ request }) => {
      posts.push({ url: request.url, headers: request.headers, body: new URLSearchParams(await request.text()) });
      return HttpResponse.json({ result: true });
    }));
    const lastfm = site();
    await lastfm.listTrack("rj", "Radiohead", "Airbag - Remastered");

    const result = await lastfm.deleteScrobble("rj", { artist: "Radiohead", track: "Airbag - Remastered", timestamp: 1790000300 });

    expect(result).toEqual({ ok: true });
    expect(Object.fromEntries(posts[0]!.body)).toEqual({
      csrfmiddlewaretoken: FIXTURE_CSRF, artist_name: "Radiohead", track_name: "Airbag - Remastered", timestamp: "1790000300", ajax: "1",
    });
    expect(posts[0]!.headers.get("content-type")).toContain("application/x-www-form-urlencoded");
  });

  it("falls back to the csrftoken cookie when no page has been read", async () => {
    let token = "";
    server.use(http.post("https://www.last.fm/user/rj/library/delete", async ({ request }) => {
      token = new URLSearchParams(await request.text()).get("csrfmiddlewaretoken") ?? "";
      return HttpResponse.json({ result: true });
    }));

    await new LastFmSite((i, init) => fetch(i, init), () => "cookie-token").deleteScrobble("rj", { artist: "A", track: "B", timestamp: 1 });

    expect(token).toBe("cookie-token");
  });

  it("treats an unconfirmed delete as unexpected, and a 406 as blocked", async () => {
    servePages([libraryPage("rj", [row(1)])]);
    const lastfm = site();
    await lastfm.listTrack("rj", "Radiohead", "Airbag - Remastered");
    server.use(http.post("https://www.last.fm/user/rj/library/delete", () => HttpResponse.json({ result: false })));
    expect(await lastfm.deleteScrobble("rj", { artist: "Radiohead", track: "Airbag - Remastered", timestamp: 1 })).toMatchObject({ ok: false, reason: "unexpected" });

    server.use(http.post("https://www.last.fm/user/rj/library/delete", () => new HttpResponse(rateLimitedPage, { status: 406 })));
    expect(await lastfm.deleteScrobble("rj", { artist: "Radiohead", track: "Airbag - Remastered", timestamp: 1 })).toEqual({ ok: false, reason: "blocked" });
  });
});

describe("editing through the website", () => {
  const original = { artist: "Radiohead", track: "Airbag - Remastered", album: "OK Computer OKNOTOK 1997 2017", albumArtist: "Radiohead", timestamp: 1790000300 };
  const updated = { artist: "Radiohead", track: "Airbag", album: "OK Computer", albumArtist: "Radiohead" };

  function editEndpoint(html: string, status = 200) {
    const posts: { url: string; body: URLSearchParams }[] = [];
    server.use(http.post("https://www.last.fm/user/rj/library/edit", async ({ request }) => {
      posts.push({ url: request.url, body: new URLSearchParams(await request.text()) });
      return new HttpResponse(html, { status, headers: { "Content-Type": "text/html" } });
    }));
    return posts;
  }

  it("posts the edit form with the exact original values and the new ones", async () => {
    servePages([libraryPage("rj", [row(1790000300)])]);
    const posts = editEndpoint('<div><p class="big-modal-alert alert-success">Success</p></div>');
    const lastfm = site();
    await lastfm.listTrack("rj", "Radiohead", "Airbag - Remastered");

    expect(await lastfm.editScrobble("rj", original, updated, false)).toEqual({ ok: true });
    expect(new URL(posts[0]!.url).searchParams.get("edited-variation")).toBe("library-track-scrobble");
    expect(Object.fromEntries(posts[0]!.body)).toEqual({
      csrfmiddlewaretoken: FIXTURE_CSRF,
      artist_name: "Radiohead", artist_name_original: "Radiohead",
      track_name: "Airbag", track_name_original: "Airbag - Remastered",
      album_name: "OK Computer", album_name_original: "OK Computer OKNOTOK 1997 2017",
      album_artist_name: "Radiohead", album_artist_name_original: "Radiohead",
      timestamp: "1790000300", submit: "edit-scrobble", ajax: "1",
    });
  });

  it("asks Last.fm to apply it to every matching Scrobble with edit_all", async () => {
    const posts = editEndpoint('<p class="alert-success">Success</p>');

    await new LastFmSite((i, init) => fetch(i, init), () => "cookie").editScrobble("rj", original, updated, true);

    expect(posts[0]!.body.get("edit_all")).toBe("1");
  });

  it("reports an edit Last.fm didn't confirm, with its message", async () => {
    editEndpoint('<div class="alert alert-danger">Something went wrong</div>');

    const result = await new LastFmSite((i, init) => fetch(i, init), () => "cookie").editScrobble("rj", original, updated, false);

    expect(result).toEqual({ ok: false, reason: "unexpected", detail: "Something went wrong" });
  });
});
