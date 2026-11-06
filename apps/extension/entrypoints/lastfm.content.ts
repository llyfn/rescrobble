import { LastFmSite } from "../src/website/lastfmPages.ts";
import type { SiteRequest, SiteResponse } from "../src/website/messages.ts";

declare global {
  interface Window {
    __rescrobbleSite?: boolean;
  }
}

/**
 * Injected into the background last.fm tab on demand. Its requests are same-origin, so they carry the
 * user's own last.fm login and pass the site's CSRF and Origin checks.
 */
export default defineContentScript({
  matches: ["https://www.last.fm/*"],
  registration: "runtime",
  main() {
    if (window.__rescrobbleSite) return;
    window.__rescrobbleSite = true;
    const site = new LastFmSite(
      (input, init) => window.fetch(input, init),
      () => document.cookie.match(/(?:^|; )csrftoken=([^;]+)/)?.[1] ?? null,
    );

    browser.runtime.onMessage.addListener((message: SiteRequest, _sender, sendResponse: (r: SiteResponse) => void) => {
      if (message?.target !== "rescrobble-site") return;
      const reply =
        message.op === "listTrack" ? site.listTrack(message.user, message.artist, message.track)
        : message.op === "deleteScrobble" ? site.deleteScrobble(message.user, message.scrobble)
        : site.editScrobble(message.user, message.original, message.updated, message.editAll);
      reply
        .catch((e: unknown): SiteResponse => ({ ok: false, reason: "unexpected", detail: String(e) }))
        .then(sendResponse);
      return true;
    });
  },
});
