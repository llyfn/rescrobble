import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { http, HttpResponse } from "msw";
import worker from "../src/index.ts";
import type { Env } from "../src/config.ts";
import { signature } from "../src/lastfm.ts";
import { browser, EXTENSION, OTHER_SESSION_KEY, signInWithBearer, signInWithCookie } from "./browser.ts";
import { lastFm, lastFmError, lastFmJson, network, sessionJson, userInfoJson } from "./lastfm.ts";

/** Signs in normally, then answers every other Last.fm call with `reply`. */
const signedIn = (reply: (method: string, form: URLSearchParams) => Response = () => lastFmJson(userInfoJson("rj"))) =>
  lastFm((method, form) => (method === "auth.getSession" ? lastFmJson(sessionJson("rj", "session-key-123")) : reply(method, form)));

const me = (headers: Record<string, string>) => browser().get("/api/me", { headers });
const rotatedMe = (headers: Record<string, string>) =>
  worker.fetch(new Request("https://rescrobble.test/api/me", { headers }), { ...(env as Env), SESSION_ENCRYPTION_KEY: OTHER_SESSION_KEY });

describe("the signed-in user", () => {
  it("returns the username and Pro status for the Web App's cookie", async () => {
    signedIn();
    const response = await me({ Cookie: await signInWithCookie() });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ username: "rj", pro: false });
  });

  it("returns the same for the Extension's bearer token", async () => {
    signedIn();
    const response = await browser(EXTENSION).get("/api/me", { headers: { Authorization: await signInWithBearer() } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ username: "rj", pro: false });
  });

  it("is unauthorized without a session", async () => {
    expect((await me({})).status).toBe(401);
  });

  it("reads a tampered cookie as signed out", async () => {
    signedIn();
    const cookie = await signInWithCookie();
    const tampered = cookie.slice(0, -2) + (cookie.endsWith("AA") ? "BB" : "AA");

    expect((await me({ Cookie: tampered })).status).toBe(401);
  });

  it("reads a cookie or token made with a different encryption key as signed out", async () => {
    signedIn();
    const cookie = await signInWithCookie();
    const bearer = await signInWithBearer();

    expect((await rotatedMe({ Cookie: cookie })).status).toBe(401);
    expect((await rotatedMe({ Authorization: bearer })).status).toBe(401);
  });

  it("accepts the bearer scheme in any case", async () => {
    signedIn();
    const token = (await signInWithBearer()).slice("Bearer ".length);

    expect((await me({ Authorization: `bearer ${token}` })).status).toBe(200);
  });

  it("is unauthorized for malformed or undecryptable bearer headers", async () => {
    signedIn();
    const token = (await signInWithBearer()).slice("Bearer ".length);

    for (const header of ["Bearer", "Bearer ", `Basic ${token}`, token, "Bearer not-a-real-token", `Bearer ${token.slice(0, -3)}`]) {
      expect((await me({ Authorization: header })).status, `Authorization: ${header}`).toBe(401);
    }
  });

  it("never lets a valid cookie rescue an invalid bearer header", async () => {
    signedIn();
    const cookie = await signInWithCookie();

    expect((await me({ Cookie: cookie, Authorization: "Bearer not-a-real-token" })).status).toBe(401);
  });
});

describe("Pro status", () => {
  const proFor = async (user: Record<string, unknown>) => {
    signedIn(() => lastFmJson({ user }));
    return ((await (await me({ Authorization: await signInWithBearer() })).json()) as { pro: unknown }).pro;
  };

  it("reports a subscriber as Pro", async () => {
    expect(await proFor({ name: "rj", subscriber: "1" })).toBe(true);
  });

  it("reports a non-subscriber as not Pro", async () => {
    expect(await proFor({ name: "rj", subscriber: "0" })).toBe(false);
  });

  it("reads a numeric subscriber flag the same way", async () => {
    expect(await proFor({ name: "rj", subscriber: 1 })).toBe(true);
  });

  it("leaves Pro unknown when the subscriber field is missing or unrecognised", async () => {
    expect(await proFor({ name: "rj", playcount: "1234" })).toBeNull();
    expect(await proFor({ name: "rj", subscriber: "maybe" })).toBeNull();
  });
});

describe("the signed-in user when Last.fm misbehaves", () => {
  it("asks Last.fm about the session itself", async () => {
    const requests = signedIn();
    await me({ Authorization: await signInWithBearer() });

    const form = requests.map((r) => r.form).find((f) => f.get("method") === "user.getInfo")!;
    expect(form.get("sk")).toBe("session-key-123");
    expect(form.has("user")).toBe(false);
    expect(form.get("api_sig")).toBe(await signature({ method: "user.getInfo", api_key: "test-api-key", sk: "session-key-123" }, "test-shared-secret"));
  });

  it("reports a revoked session as signed out", async () => {
    signedIn(() => lastFmError(9, "Invalid session key - Please re-authenticate"));

    const response = await me({ Authorization: await signInWithBearer() });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "sessionInvalid" });
  });

  it("still answers from the session when Last.fm is down", async () => {
    signedIn();
    const bearer = await signInWithBearer();
    network.use(http.all("https://ws.audioscrobbler.com/2.0/", () => HttpResponse.error()));

    const response = await me({ Authorization: bearer });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ username: "rj", pro: null });
  });
});
