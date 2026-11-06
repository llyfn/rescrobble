import { describe, expect, it } from "vitest";
import { applyFilter, conditionError, matchedRange, type Condition, type FilterableScrobble, type TextMode } from "./filters.ts";

const s = (timestamp: number, artist: string, track: string, album = ""): FilterableScrobble => ({ timestamp, artist, track, album });
const text = (field: "artist" | "track" | "album", mode: TextMode, value: string, caseSensitive = false): Condition =>
  ({ kind: "text", field, mode, value, caseSensitive });
const tracks = (list: FilterableScrobble[]) => list.map((x) => x.track);

const library = [
  s(100, "Radiohead", "Paranoid Android - Remastered", "OK Computer OKNOTOK"),
  s(200, "radiohead", "Airbag - Remaster 2017", "OK Computer OKNOTOK"),
  s(300, "Radiohead", "Let Down", ""),
  s(400, "Sigur Rós", "Hoppípolla", "Takk..."),
  s(500, "아이유", "밤편지", "팔레트"),
  s(600, "Cher", "Believe (1+1) [Live]", "  "),
];

describe("text conditions", () => {
  it.each<[string, Condition, string[]]>([
    ["exact, ignoring case", text("artist", "exact", "RADIOHEAD"), ["Paranoid Android - Remastered", "Airbag - Remaster 2017", "Let Down"]],
    ["exact, case-sensitive", text("artist", "exact", "Radiohead", true), ["Paranoid Android - Remastered", "Let Down"]],
    ["contains, ignoring case", text("track", "contains", "remaster"), ["Paranoid Android - Remastered", "Airbag - Remaster 2017"]],
    ["contains, case-sensitive", text("track", "contains", "remaster", true), []],
    ["regex anchored to the end", text("track", "regex", " - Remaster(ed)?( \\d{4})?$"), ["Paranoid Android - Remastered", "Airbag - Remaster 2017"]],
    ["regex with characters that are special elsewhere", text("track", "regex", "\\(1\\+1\\) \\[Live\\]"), ["Believe (1+1) [Live]"]],
    ["contains treats regex characters literally", text("track", "contains", "(1+1) [live]"), ["Believe (1+1) [Live]"]],
    ["empty album, counting blank as empty", text("album", "empty", ""), ["Let Down", "Believe (1+1) [Live]"]],
    ["non-Latin contains", text("track", "contains", "밤"), ["밤편지"]],
    ["accents are kept distinct", text("artist", "contains", "ros"), []],
    ["accented exact", text("artist", "exact", "sigur rós"), ["Hoppípolla"]],
  ])("%s", (_name, condition, expected) => {
    expect(tracks(applyFilter(library, [condition]))).toEqual(expected);
  });

  it("combines conditions with AND", () => {
    const result = applyFilter(library, [text("artist", "exact", "radiohead"), text("album", "contains", "OK Computer")]);
    expect(tracks(result)).toEqual(["Paranoid Android - Remastered", "Airbag - Remaster 2017"]);
  });

  it("flags an invalid regex, which then matches nothing", () => {
    const broken = text("track", "regex", "Remaster(");
    expect(conditionError(broken)).toMatch(/./);
    expect(conditionError(text("track", "regex", "ok"))).toBeNull();
    expect(applyFilter(library, [text("artist", "exact", "Cher"), broken])).toEqual([]);
  });
});

describe("matched ranges", () => {
  it.each<[Condition, string, [number, number] | null]>([
    [text("track", "contains", "remaster"), "Airbag - Remaster 2017", [9, 17]],
    [text("track", "regex", " - Remaster(ed)?$"), "Paranoid Android - Remastered", [16, 29]],
    [text("artist", "exact", "cher"), "Cher", [0, 4]],
    [text("album", "empty", ""), "", null],
    [text("track", "contains", "zzz"), "Believe", null],
  ])("%o in %s", (condition, value, range) => {
    expect(matchedRange(condition as Extract<Condition, { kind: "text" }>, value)).toEqual(range);
  });
});

describe("date range", () => {
  it.each<[number | null, number | null, string[]]>([
    [200, 400, ["Airbag - Remaster 2017", "Let Down", "Hoppípolla"]],
    [null, 200, ["Paranoid Android - Remastered", "Airbag - Remaster 2017"]],
    [500, null, ["밤편지", "Believe (1+1) [Live]"]],
  ])("from %s to %s, inclusive", (from, to, expected) => {
    expect(tracks(applyFilter(library, [{ kind: "dateRange", from, to }]))).toEqual(expected);
  });
});

describe("Duplicates", () => {
  const plays = [
    s(1000, "Cher", "Believe"),
    s(1030, "cher", "BELIEVE"),
    s(1061, "Cher", "Believe"),
    s(1100, "Cher", "Strong Enough"),
    s(1120, "Cher", "Believe"),
  ];

  it("matches repeats within N seconds of the play before, keeping the first", () => {
    expect(applyFilter(plays, [{ kind: "duplicates", withinSeconds: 30 }]).map((p) => p.timestamp)).toEqual([1030]);
  });

  it("includes a repeat exactly N seconds later and excludes one at N + 1", () => {
    expect(applyFilter(plays, [{ kind: "duplicates", withinSeconds: 31 }]).map((p) => p.timestamp)).toEqual([1030, 1061]);
    expect(applyFilter([s(0, "A", "B"), s(31, "A", "B")], [{ kind: "duplicates", withinSeconds: 30 }])).toEqual([]);
  });

  it("only counts the play immediately before, not an earlier one", () => {
    expect(applyFilter(plays, [{ kind: "duplicates", withinSeconds: 120 }]).map((p) => p.timestamp)).toEqual([1030, 1061]);
  });

  it("works on Scrobbles given newest first", () => {
    expect(applyFilter([...plays].reverse(), [{ kind: "duplicates", withinSeconds: 30 }]).map((p) => p.timestamp)).toEqual([1030]);
  });
});
