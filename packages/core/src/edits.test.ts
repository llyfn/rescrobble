import { describe, expect, it } from "vitest";
import { applyEdit, caseOnlyFields, changeError, changedFields, diffValues, type EditableValues, type FieldChange } from "./edits.ts";

const values: EditableValues = { artist: "Radiohead", track: "Paranoid Android - Remastered", album: "OK Computer OKNOTOK 1997 2017", albumArtist: "Radiohead" };
const replace = (field: FieldChange["field"], find: string, replaceWith: string, regex = false, caseSensitive = false): FieldChange =>
  ({ field, kind: "replace", find, replaceWith, regex, caseSensitive });

describe("applying an Edit", () => {
  it.each<[string, FieldChange[], Partial<EditableValues>]>([
    ["sets a field", [{ field: "album", kind: "set", value: "OK Computer" }], { album: "OK Computer" }],
    ["removes text with a plain replace", [replace("track", " - Remastered", "")], { track: "Paranoid Android" }],
    ["matches plain text ignoring case", [replace("track", " - remastered", "")], { track: "Paranoid Android" }],
    ["respects Match case", [replace("track", " - remastered", "", false, true)], {}],
    ["treats plain text with regex characters literally", [replace("album", "1997 2017", "(Remaster)")], { album: "OK Computer OKNOTOK (Remaster)" }],
    ["replaces every occurrence", [replace("artist", "a", "4")], { artist: "R4diohe4d" }],
    ["supports regex groups", [replace("album", "^(.*) OKNOTOK \\d{4} \\d{4}$", "$1", true)], { album: "OK Computer" }],
    ["keeps $ literal in plain replacements", [replace("track", "Android", "$1 Android")], { track: "Paranoid $1 Android - Remastered" }],
    ["applies changes in order", [replace("track", " - Remastered", ""), { field: "albumArtist", kind: "set", value: "Radiohead & Friends" }], { track: "Paranoid Android", albumArtist: "Radiohead & Friends" }],
  ])("%s", (_name, changes, expected) => {
    expect(applyEdit(values, changes)).toEqual({ ...values, ...expected });
  });

  it("works on non-Latin text", () => {
    expect(applyEdit({ ...values, artist: "아이유 (IU)" }, [replace("artist", " (IU)", "")]).artist).toBe("아이유");
  });

  it("flags an invalid regex and leaves values alone", () => {
    const broken = replace("track", "Remaster(", "", true);
    expect(changeError(broken)).toMatch(/./);
    expect(applyEdit(values, [broken])).toEqual(values);
  });
});

describe("what an Edit changes", () => {
  it("lists changed fields, empty when nothing changes", () => {
    expect(changedFields(values, applyEdit(values, [replace("track", " - Remastered", "")]))).toEqual(["track"]);
    expect(changedFields(values, applyEdit(values, [replace("track", "Live", "")]))).toEqual([]);
  });

  it("spots changes that only alter letter case", () => {
    expect(caseOnlyFields(values, { ...values, artist: "RADIOHEAD", track: "Paranoid Android" })).toEqual(["artist"]);
  });
});

describe("diffing values", () => {
  it.each([
    ["Paranoid Android - Remastered", "Paranoid Android", { prefix: "Paranoid Android", removed: " - Remastered", inserted: "", suffix: "" }],
    ["Beatles", "The Beatles", { prefix: "", removed: "", inserted: "The ", suffix: "Beatles" }],
    ["sigur ros", "Sigur Rós", { prefix: "", removed: "sigur ro", inserted: "Sigur Ró", suffix: "s" }],
    ["same", "same", { prefix: "same", removed: "", inserted: "", suffix: "" }],
  ])("%s → %s", (before, after, expected) => {
    expect(diffValues(before, after)).toEqual(expected);
  });
});
