import { browser } from "wxt/browser";

export const APP_PATH = "/app.html";

/** Focuses the open rescrobble tab, or opens one. There is never more than one. */
export async function openApp() {
  const appUrl = browser.runtime.getURL(APP_PATH);
  const tabs = await browser.tabs.query({});
  const existing = tabs.find((tab) => tab.url?.startsWith(appUrl));
  if (existing?.id === undefined) {
    await browser.tabs.create({ url: appUrl });
    return;
  }
  await browser.tabs.update(existing.id, { active: true });
  if (existing.windowId !== undefined) await browser.windows.update(existing.windowId, { focused: true });
}
