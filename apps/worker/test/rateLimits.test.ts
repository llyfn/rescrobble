import { describe, expect, it } from "vitest";
import { env, listDurableObjectIds } from "cloudflare:test";
import type { Env } from "../src/config.ts";
import { BURST_REQUESTS, BURST_WINDOW_MS, DAILY_SCROBBLES } from "../src/limits.ts";
import { browser, signInWithBearer } from "./browser.ts";
import { freezeClock } from "./clock.ts";
import { acceptAll, lastFm, lastFmError, lastFmJson, sessionJson } from "./lastfm.ts";

const clock = freezeClock();

/** Each approval token signs in a different account, with session key `sk-<token>`. */
function accountsLastFm() {
  const state = { down: false };
  const requests = lastFm((method, form) => {
    if (method === "auth.getSession") return lastFmJson(sessionJson(`user-${form.get("token")}`, `sk-${form.get("token")}`));
    if (method === "track.scrobble" && state.down) return lastFmError(16, "There was a temporary error processing your request");
    if (method === "track.scrobble") return lastFmJson(acceptAll(form));
    throw new Error(`unexpected Last.fm method ${method}`);
  });
  const scrobblesSent = () =>
    requests.filter((r) => r.form.get("method") === "track.scrobble").reduce((n, r) => n + [...r.form.keys()].filter((k) => k.startsWith("artist[")).length, 0);
  return { state, scrobblesSent };
}

function submit(auth: string, count: number, valid = true) {
  const timestamp = valid ? Math.floor(Date.now() / 1000) - 60 : 0;
  const scrobbles = Array.from({ length: count }, (_, i) => ({ artist: "Artist", track: `Track ${i}`, timestamp }));
  return browser().post("/api/scrobbles", { headers: { Authorization: auth }, body: { scrobbles } });
}

/** Uses up `scrobbles` of the account's daily allowance, pacing requests to stay under the burst limit. */
async function useUp(auth: string, scrobbles: number) {
  for (let left = scrobbles; left > 0; left -= 50) {
    expect((await submit(auth, Math.min(left, 50))).status).toBe(200);
    clock.advance(2);
  }
}

describe("per-account rate limits", () => {
  it("lets the whole daily allowance be used, and refuses the next Scrobble", async () => {
    const lastFm = accountsLastFm();
    const auth = await signInWithBearer("a");
    await useUp(auth, DAILY_SCROBBLES);

    const response = await submit(auth, 1);

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "dailyLimit" });
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(lastFm.scrobblesSent()).toBe(DAILY_SCROBBLES);
  });

  it("refuses a batch that would cross the allowance whole, while a smaller one still fits", async () => {
    const lastFm = accountsLastFm();
    const auth = await signInWithBearer("a");
    await useUp(auth, DAILY_SCROBBLES - 10);

    expect((await submit(auth, 11)).status).toBe(429);
    expect((await submit(auth, 10)).status).toBe(200);
    expect(lastFm.scrobblesSent()).toBe(DAILY_SCROBBLES);
  });

  it("doesn't count rejected entries against the allowance", async () => {
    accountsLastFm();
    const auth = await signInWithBearer("a");
    await useUp(auth, DAILY_SCROBBLES);

    const response = await submit(auth, 5, false);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("tooOld");
  });

  it("frees the allowance up as the 24-hour window rolls past", async () => {
    accountsLastFm();
    const auth = await signInWithBearer("a");
    await useUp(auth, DAILY_SCROBBLES);
    const retryAfter = Number((await submit(auth, 50)).headers.get("Retry-After"));

    clock.advance(retryAfter);

    expect((await submit(auth, 50)).status).toBe(200);
  });

  it("returns Scrobbles that fail at Last.fm to the allowance", async () => {
    const lastFm = accountsLastFm();
    const auth = await signInWithBearer("a");
    await useUp(auth, DAILY_SCROBBLES - 50);

    lastFm.state.down = true;
    expect((await submit(auth, 50)).status).toBe(503);
    lastFm.state.down = false;
    clock.advance(2);

    expect((await submit(auth, 50)).status).toBe(200);
  });

  it("refuses a burst of requests beyond the burst limit until the window passes", async () => {
    const lastFm = accountsLastFm();
    const auth = await signInWithBearer("a");
    for (let i = 0; i < BURST_REQUESTS; i++) expect((await submit(auth, 1)).status).toBe(200);

    const refused = await submit(auth, 1);

    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: "tooManyRequests" });
    expect(refused.headers.get("Retry-After")).toBe(String(BURST_WINDOW_MS / 1000));
    expect(lastFm.scrobblesSent()).toBe(BURST_REQUESTS);

    clock.advance(BURST_WINDOW_MS / 1000);
    expect((await submit(auth, 1)).status).toBe(200);
  });

  it("keeps one account reaching its limits from affecting another", async () => {
    accountsLastFm();
    const first = await signInWithBearer("a");
    const second = await signInWithBearer("b");
    await useUp(first, DAILY_SCROBBLES);
    for (let i = 0; i < BURST_REQUESTS; i++) await submit(first, 1, false);

    expect((await submit(first, 1)).status).toBe(429);
    expect((await submit(second, 50)).status).toBe(200);
  });

  it("names each account's counter by a hash of the session key, never the key itself", async () => {
    accountsLastFm();
    await submit(await signInWithBearer("a"), 1);

    const ids = await listDurableObjectIds((env as Env).LIMITS);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("sk-a"));
    const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");

    const listed = ids.map((id) => id.toString());
    expect(listed).toContain((env as Env).LIMITS.idFromName(hash).toString());
    expect(listed).not.toContain((env as Env).LIMITS.idFromName("sk-a").toString());
  });
});
