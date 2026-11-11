import { describe, expect, it } from "vitest";
import { browser, EXTENSION, sessionCookieOf, signInWithBearer, signInWithCookie, WEB_APP } from "./browser.ts";
import { HOUR_AGO, freezeClock } from "./clock.ts";
import { lastFm, lastFmJson, scrobblingLastFm, sessionJson } from "./lastfm.ts";

freezeClock();
const oneScrobble = { scrobbles: [{ artist: "Cher", track: "Believe", timestamp: HOUR_AGO }] };

const ELSEWHERE = "https://evil.example";
const signedIn = () => lastFm(() => lastFmJson(sessionJson("rj", "session-key-123")));

const preflight = (origin: string) =>
  browser(origin).options("/api/scrobbles", {
    headers: { "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization, content-type" },
  });

describe("cross-site protection", () => {
  it("lets a cookie submission from the Web App's own origin through", async () => {
    const lastFm = scrobblingLastFm();
    const cookie = await signInWithCookie();

    expect((await browser(WEB_APP).post("/api/scrobbles", { headers: { Cookie: cookie }, body: oneScrobble })).status).toBe(200);
    expect(lastFm.scrobbleForms()).toHaveLength(1);
  });

  it("refuses a cookie submission triggered by another site or without an Origin", async () => {
    const lastFm = scrobblingLastFm();
    const cookie = await signInWithCookie();

    for (const origin of [ELSEWHERE, null]) {
      expect((await browser(origin).post("/api/scrobbles", { headers: { Cookie: cookie }, body: oneScrobble })).status, `Origin: ${origin}`).toBe(403);
    }
    expect(lastFm.scrobbleForms()).toHaveLength(0);
  });

  it("accepts the Extension's bearer submission from its origin with CORS approval, and from a client without an Origin", async () => {
    scrobblingLastFm();
    const auth = await signInWithBearer();

    const fromExtension = await browser(EXTENSION).post("/api/scrobbles", { headers: { Authorization: auth }, body: oneScrobble });
    const withoutOrigin = await browser(null).post("/api/scrobbles", { headers: { Authorization: auth }, body: oneScrobble });

    expect(fromExtension.status).toBe(200);
    expect(fromExtension.headers.get("Access-Control-Allow-Origin")).toBe(EXTENSION);
    expect(fromExtension.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    expect(withoutOrigin.status).toBe(200);
  });

  it("refuses a logout triggered by another site or without an Origin, keeping the session", async () => {
    signedIn();
    const cookie = await signInWithCookie();

    for (const origin of [ELSEWHERE, null]) {
      const response = await browser(origin).post("/auth/logout", { headers: { Cookie: cookie } });

      expect(response.status, `Origin: ${origin}`).toBe(403);
      expect(response.headers.get("Set-Cookie")).toBeNull();
    }
  });

  it("approves preflights from the Web App and the Extension", async () => {
    for (const origin of [WEB_APP, EXTENSION]) {
      const response = await preflight(origin);

      expect(response.status, origin).toBe(200);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
      const allowedHeaders = response.headers.get("Access-Control-Allow-Headers")!.toLowerCase();
      expect(allowedHeaders).toContain("authorization");
      expect(allowedHeaders).toContain("content-type");
      expect(response.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    }
  });

  it("gives preflights and requests from any other origin no CORS approval", async () => {
    for (const origin of [ELSEWHERE, "chrome-extension://someotherextension", "http://rescrobble.test"]) {
      expect((await preflight(origin)).headers.get("Access-Control-Allow-Origin"), origin).toBeNull();
      expect((await browser(origin).get("/api/config")).headers.get("Access-Control-Allow-Origin"), origin).toBeNull();
    }
  });

  it("makes the session cookie HttpOnly, Secure, SameSite=Lax and site-wide on sign-in and logout", async () => {
    signedIn();
    const issued = await browser().get("/auth/callback?token=approval");
    const cookie = sessionCookieOf(issued)!;
    const cleared = await browser().post("/auth/logout", { headers: { Cookie: `${cookie.name}=${cookie.value}` } });

    for (const response of [issued, cleared]) {
      const { attributes } = sessionCookieOf(response)!;
      expect(attributes.has("httponly")).toBe(true);
      expect(attributes.has("secure")).toBe(true);
      expect(attributes.get("path")).toBe("/");
      expect(attributes.get("samesite")).toBe("Lax");
    }
  });
});
