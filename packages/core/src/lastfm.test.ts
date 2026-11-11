import { describe, expect, it } from "vitest";
import { LastFmReader, asList } from "./lastfm.ts";

describe("asList", () => {
  it("normalises Last.fm's single-item and empty lists", () => {
    expect(asList({ a: 1 })).toEqual([{ a: 1 }]);
    expect(asList([{ a: 1 }, { a: 2 }])).toEqual([{ a: 1 }, { a: 2 }]);
    expect(asList(undefined)).toEqual([]);
    expect(asList(null)).toEqual([]);
  });
});

/** A reader whose every request is answered with `body`, recording the requested URLs. */
function readerAnswering(body: unknown, status = 200) {
  const urls: URL[] = [];
  const reader = new LastFmReader("key", async (input) => {
    urls.push(new URL(String(input)));
    return new Response(JSON.stringify(body), { status });
  });
  return { reader, urls };
}

const art = (hash: string) => [
  { size: "small", "#text": `https://lastfm.freetls.fastly.net/i/u/34s/${hash}.png` },
  { size: "large", "#text": `https://lastfm.freetls.fastly.net/i/u/174s/${hash}.png` },
];

describe("LastFmReader", () => {
  it("gives each album match its art, and none for Last.fm's placeholder star or a blank", async () => {
    const { reader } = readerAnswering({
      results: { albummatches: { album: [
        { name: "OK Computer", artist: "Radiohead", image: art("62d26c6cb4ac4bdccb8f3a2a0fd55421") },
        { name: "OK Computer", artist: "Tribute Band", image: art("2a96cbd8b46e442fc41c2b86b821562f") },
        { name: "OK Computer", artist: "Nobody", image: [{ size: "large", "#text": "" }] },
      ] } },
    });

    expect((await reader.searchAlbums("ok computer")).map((m) => m.image)).toEqual([
      "https://lastfm.freetls.fastly.net/i/u/174s/62d26c6cb4ac4bdccb8f3a2a0fd55421.png",
      null,
      null,
    ]);
  });

  it("suggests artists by name", async () => {
    const { reader, urls } = readerAnswering({ results: { artistmatches: { artist: [{ name: "Radiohead" }, { name: "Radiohead Tribute" }] } } });

    expect(await reader.searchArtists("radioh")).toEqual(["Radiohead", "Radiohead Tribute"]);
    expect(urls[0]!.searchParams.get("method")).toBe("artist.search");
  });

  it("finds the album a track is filed under, with its art", async () => {
    const { reader, urls } = readerAnswering({ track: { name: "Paranoid Android", album: { title: "OK Computer", image: art("62d26c6cb4ac4bdccb8f3a2a0fd55421") } } });

    expect(await reader.getTrackAlbum("Radiohead", "Paranoid Android")).toEqual({
      album: "OK Computer",
      image: "https://lastfm.freetls.fastly.net/i/u/174s/62d26c6cb4ac4bdccb8f3a2a0fd55421.png",
    });
    expect(Object.fromEntries(urls[0]!.searchParams)).toMatchObject({ method: "track.getInfo", artist: "Radiohead", track: "Paranoid Android", autocorrect: "1" });
  });

  it("finds no album for a track Last.fm files under none or doesn't know", async () => {
    expect(await readerAnswering({ track: { name: "Demo" } }).reader.getTrackAlbum("Someone", "Demo")).toBeNull();
    expect(await readerAnswering({ error: 6, message: "Track not found" }, 404).reader.getTrackAlbum("Someone", "Nothing")).toBeNull();
  });
});
