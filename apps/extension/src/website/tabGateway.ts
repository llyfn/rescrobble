import { browser } from "wxt/browser";
import type { Result, ScrobbleRef, TrackOnSite, WebsiteGateway } from "./gateway.ts";
import { SITE } from "./lastfmPages.ts";
import type { SiteRequest, SiteResponse } from "./messages.ts";

const CONTENT_SCRIPT = "/content-scripts/lastfm.js";

function loaded(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const check = async () => {
      const tab = await browser.tabs.get(tabId).catch(() => null);
      if (!tab || tab.status === "complete") {
        browser.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    };
    const onUpdated = (id: number, info: { status?: string }) => {
      if (id === tabId && info.status === "complete") void check();
    };
    browser.tabs.onUpdated.addListener(onUpdated);
    void check();
  });
}

/**
 * Sends website requests through a last.fm tab opened in the background, kept from being discarded,
 * with the content script injected. A closed or reloaded tab is reopened or re-injected on demand.
 */
export class TabGateway implements WebsiteGateway {
  private tabId: number | null = null;

  listTrack(user: string, artist: string, track: string): Promise<Result<TrackOnSite>> {
    return this.send({ target: "rescrobble-site", op: "listTrack", user, artist, track }) as Promise<Result<TrackOnSite>>;
  }

  deleteScrobble(user: string, scrobble: ScrobbleRef): Promise<Result> {
    return this.send({ target: "rescrobble-site", op: "deleteScrobble", user, scrobble });
  }

  private async send(request: SiteRequest): Promise<SiteResponse> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const tabId = await this.tab();
      try {
        await browser.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT] });
        return (await browser.tabs.sendMessage(tabId, request)) as SiteResponse;
      } catch {
        this.tabId = null;
      }
    }
    return { ok: false, reason: "unexpected", detail: "the last.fm tab didn't respond" };
  }

  private async tab(): Promise<number> {
    if (this.tabId !== null) {
      const tab = await browser.tabs.get(this.tabId).catch(() => null);
      if (tab?.url?.startsWith(SITE)) return this.tabId;
    }
    const tab = await browser.tabs.create({ url: `${SITE}/`, active: false });
    this.tabId = tab.id!;
    await browser.tabs.update(this.tabId, { autoDiscardable: false });
    await loaded(this.tabId);
    return this.tabId;
  }
}
