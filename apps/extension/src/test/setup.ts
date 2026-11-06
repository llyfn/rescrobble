import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { resetLastFmReader } from "@rescrobble/scrobble-ui";
import { IDBFactory } from "fake-indexeddb";
import { syncTiming } from "../mirror/sync.ts";
import { server } from "./server.ts";

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => {
  fakeBrowser.reset();
  globalThis.indexedDB = new IDBFactory();
  syncTiming.pageDelayMs = 0;
  syncTiming.retryDelaysMs = [20, 40];
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  resetLastFmReader();
});
afterAll(() => server.close());
