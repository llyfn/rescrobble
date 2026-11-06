import { describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { openApp } from "./openApp.ts";

describe("the toolbar icon", () => {
  it("opens rescrobble in a new tab", async () => {
    await openApp();

    const tabs = await fakeBrowser.tabs.query({});
    expect(tabs.map((t: { url?: string }) => t.url)).toContain(fakeBrowser.runtime.getURL("/app.html"));
  });

  it("focuses the open rescrobble tab instead of opening another", async () => {
    await openApp();
    const other = await fakeBrowser.tabs.create({ url: "https://example.com", active: true });

    await openApp();

    const tabs = await fakeBrowser.tabs.query({});
    const appTabs = tabs.filter((t: { url?: string }) => t.url?.startsWith(fakeBrowser.runtime.getURL("/app.html")));
    expect(appTabs).toHaveLength(1);
    expect(appTabs[0]?.active).toBe(true);
    expect((await fakeBrowser.tabs.get(other.id!)).active).toBe(false);
  });
});
