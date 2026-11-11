import { afterEach, beforeEach, vi } from "vitest";

export const NOW = Date.parse("2026-01-15T12:00:00Z") / 1000;
export const HOUR_AGO = NOW - 3600;

/** Freezes the Worker's clock at NOW for each test in the calling file; `advance` moves it on. */
export function useTestClock() {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW * 1000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  return { advance: (seconds: number) => vi.setSystemTime(Date.now() + seconds * 1000) };
}
