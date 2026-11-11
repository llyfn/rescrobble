import { afterAll, afterEach, beforeAll } from "vitest";
import { reset } from "cloudflare:test";
import { network } from "./lastfm.ts";

beforeAll(() => network.enable());
afterEach(async () => {
  network.resetHandlers();
  // Each test starts with fresh per-account limits, as every account would on a new deployment.
  await reset();
});
afterAll(() => network.disable());
