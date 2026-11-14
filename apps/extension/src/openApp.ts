import { browser } from "wxt/browser";

export const APP_PATH = "/app.html";

/**
 * Focuses the open rescrobble tab, or opens one. There is never more than one. A `screen` is set as the
 * URL hash, which the full view follows without reloading.
 */
export async function openApp(screen?: string) {
  const appUrl = browser.runtime.getURL(APP_PATH);
  const tabs = await browser.tabs.query({});
  const existing = tabs.find((tab) => tab.url?.startsWith(appUrl));
  if (existing?.id === undefined) {
    await browser.tabs.create({ url: screen ? `${appUrl}#${screen}` : appUrl });
    return;
  }
  // Only the hash may change: a different query string would reload the tab and stop a running Job.
  const url = screen && existing.url ? `${existing.url.split("#")[0]}#${screen}` : null;
  await browser.tabs.update(existing.id, url ? { active: true, url } : { active: true });
  if (existing.windowId !== undefined) await browser.windows.update(existing.windowId, { focused: true });
}
