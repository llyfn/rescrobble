import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { resetLastFmReader } from "@rescrobble/scrobble-ui";
import { server } from "./server.ts";

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => fakeBrowser.reset());
afterEach(() => {
  cleanup();
  server.resetHandlers();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  resetLastFmReader();
});
afterAll(() => server.close());
