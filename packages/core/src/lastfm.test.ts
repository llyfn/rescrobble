import { describe, expect, it } from "vitest";
import { asList } from "./lastfm.ts";

describe("asList", () => {
  it("normalises Last.fm's single-item and empty lists", () => {
    expect(asList({ a: 1 })).toEqual([{ a: 1 }]);
    expect(asList([{ a: 1 }, { a: 2 }])).toEqual([{ a: 1 }, { a: 2 }]);
    expect(asList(undefined)).toEqual([]);
    expect(asList(null)).toEqual([]);
  });
});
