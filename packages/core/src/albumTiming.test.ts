import { describe, expect, it } from "vitest";
import { DEFAULT_TRACK_SECONDS, timeAlbum } from "./albumTiming.ts";

describe("album timing", () => {
  it("starts each track when the one before it ends", () => {
    const timing = timeAlbum(1000, [{ durationSeconds: 284 }, { durationSeconds: 383 }, { durationSeconds: 267 }]);

    expect(timing.tracks.map((t) => t.startsAt)).toEqual([1000, 1284, 1667]);
    expect(timing.totalSeconds).toBe(934);
    expect(timing.endsAt).toBe(1934);
  });

  it.each([null, 0, -5])("uses 3:30 for a track whose length is %s, and marks it estimated", (length) => {
    const timing = timeAlbum(0, [{ durationSeconds: length }, { durationSeconds: 100 }]);

    expect(timing.tracks[0]).toEqual({ startsAt: 0, durationSeconds: DEFAULT_TRACK_SECONDS, estimated: true });
    expect(timing.tracks[1]).toEqual({ startsAt: 210, durationSeconds: 100, estimated: false });
  });

  it("skips tracks that aren't included, without leaving a gap", () => {
    const timing = timeAlbum(0, [
      { durationSeconds: 100 },
      { durationSeconds: 999, included: false },
      { durationSeconds: 50 },
    ]);

    expect(timing.tracks.map((t) => t.startsAt)).toEqual([0, null, 100]);
    expect(timing.totalSeconds).toBe(150);
    expect(timing.endsAt).toBe(150);
  });

  it("handles an album with nothing included", () => {
    const timing = timeAlbum(500, [{ durationSeconds: 100, included: false }]);

    expect(timing).toEqual({ tracks: [{ startsAt: null, durationSeconds: 100, estimated: false }], totalSeconds: 0, endsAt: 500 });
  });
});
