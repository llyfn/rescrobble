import { describe, expect, it } from "vitest";
import fixture from "../../../fixtures/timestamp-rule-cases.json";
import { checkTimestamp, type TimestampCheck } from "./timestamp.ts";

describe("the shared timestamp rule", () => {
  it("has cases to check", () => {
    expect(fixture.cases.length).toBeGreaterThan(0);
  });

  it.each(fixture.cases)("$name", ({ now, timestamp, expected }) => {
    expect(checkTimestamp(timestamp, now)).toBe(expected as TimestampCheck);
  });
});
