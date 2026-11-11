import { describe, expect, it } from "vitest";
import { browser, sessionCookieOf } from "./browser.ts";
import { lastFm, lastFmDown, lastFmError, lastFmJson, sessionJson } from "./lastfm.ts";

const signedInLastFm = () => lastFm((method) => {
  if (method === "auth.getSession") return lastFmJson(sessionJson("rj", "session-key-123"));
  throw new Error(`unexpected Last.fm method ${method}`);
});

describe("Web App sign-in", () => {
  it("redirects login to the Last.fm approval page with the API key and callback", async () => {
    const response = await browser().get("/auth/login");

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("Location")!);
    expect(location.host).toBe("www.last.fm");
    expect(location.pathname).toBe("/api/auth/");
    expect(location.searchParams.get("api_key")).toBe("test-api-key");
    expect(location.searchParams.get("cb")).toBe("https://rescrobble.test/auth/callback");
  });

  it("signs the user in with a valid token and redirects into the Web App", async () => {
    signedInLastFm();

    const response = await browser().get("/auth/callback?token=test-token");

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/");
    expect(sessionCookieOf(response)).not.toBeNull();
  });

  it("exchanges the token with a correctly signed auth.getSession call", async () => {
    const requests = signedInLastFm();

    await browser().get("/auth/callback?token=test-token");

    const request = requests.find((r) => r.form.get("method") === "auth.getSession")!;
    expect(request.method).toBe("POST");
    expect(request.url).toBe("https://ws.audioscrobbler.com/2.0/");
    expect(Object.fromEntries(request.form)).toEqual({
      method: "auth.getSession",
      api_key: "test-api-key",
      token: "test-token",
      format: "json",
      // md5("api_keytest-api-keymethodauth.getSessiontokentest-token" + "test-shared-secret")
      api_sig: "66979c65d39e148d1bfd0e1dac411a05",
    });
  });

  it("keeps the session cookie unreadable as plain text", async () => {
    lastFm(() => lastFmJson(sessionJson("distinctive-username", "distinctive-session-key")));

    const cookie = sessionCookieOf(await browser().get("/auth/callback?token=test-token"))!;

    expect(cookie.value).not.toContain("distinctive-session-key");
    expect(cookie.value).not.toContain("distinctive-username");
  });

  it("sets no cookie for an invalid token and reports the failure to the Web App", async () => {
    lastFm(() => lastFmError(4, "Invalid authentication token supplied"));

    const response = await browser().get("/auth/callback?token=bad-token");

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/?signIn=failed");
    expect(sessionCookieOf(response)).toBeNull();
  });

  it("reports a callback without a token without calling Last.fm", async () => {
    const requests = lastFm(() => lastFmJson(sessionJson("rj", "k")));

    const response = await browser().get("/auth/callback");

    expect(response.headers.get("Location")).toBe("/?signIn=failed");
    expect(sessionCookieOf(response)).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it("reports Last.fm being unreachable during sign-in", async () => {
    lastFm(lastFmDown);

    const response = await browser().get("/auth/callback?token=test-token");

    expect(response.headers.get("Location")).toBe("/?signIn=failed");
    expect(sessionCookieOf(response)).toBeNull();
  });

  it("clears the session cookie on logout", async () => {
    signedInLastFm();
    const cookie = sessionCookieOf(await browser().get("/auth/callback?token=test-token"))!;

    const response = await browser().post("/auth/logout", { headers: { Cookie: `${cookie.name}=${cookie.value}` } });

    expect(response.status).toBe(204);
    const cleared = sessionCookieOf(response)!;
    expect(cleared.value).toBe("");
    expect(cleared.attributes.get("max-age")).toBe("0");
  });

});

describe("the test network", () => {
  it("answers unscripted Last.fm calls with a 501 and fails every other outbound request", async () => {
    expect((await fetch("https://ws.audioscrobbler.com/2.0/", { method: "POST" })).status).toBe(501);
    await expect(fetch("https://www.last.fm/")).rejects.toThrow();
  });
});
