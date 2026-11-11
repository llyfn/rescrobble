import { describe, expect, it } from "vitest";
import { browser, EXTENSION } from "./browser.ts";
import { lastFm, lastFmDown, lastFmError, lastFmJson, sessionJson } from "./lastfm.ts";

const extensionLastFm = () => lastFm((method, form) => {
  if (method === "auth.getSession" && form.get("token") === "good-token") return lastFmJson(sessionJson("rj", "session-key-123"));
  if (method === "auth.getSession") return lastFmError(14, "Unauthorized Token - This token has not been authorized");
  throw new Error(`unexpected Last.fm method ${method}`);
});

const exchange = (token: string) => browser(EXTENSION).post("/auth/session", { body: { token } });

describe("Extension sign-in", () => {
  it("returns the username and a rescrobble token for a valid approval token", async () => {
    extensionLastFm();

    const response = await exchange("good-token");

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, string>;
    expect(Object.keys(body).sort()).toEqual(["token", "username"]);
    expect(body.username).toBe("rj");
    expect(body.token).not.toBe("");
  });

  it("never reveals the Last.fm session key in the rescrobble token", async () => {
    extensionLastFm();

    expect(await (await exchange("good-token")).text()).not.toContain("session-key-123");
  });

  it("sends the approval token to auth.getSession", async () => {
    const requests = extensionLastFm();

    await exchange("good-token");

    expect(requests).toHaveLength(1);
    expect(requests[0]!.form.get("method")).toBe("auth.getSession");
    expect(requests[0]!.form.get("token")).toBe("good-token");
  });

  it("refuses an unauthorized or used approval token without a rescrobble token", async () => {
    extensionLastFm();

    const response = await exchange("used-token");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalidToken" });
  });

  it("treats Last.fm being unavailable during the exchange as retryable", async () => {
    lastFm(lastFmDown);

    const response = await exchange("good-token");

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "lastFmUnavailable" });
  });

  it("answers a request body without an approval token with a bad request", async () => {
    for (const body of [{}, "not json"]) {
      expect((await browser(EXTENSION).post("/auth/session", { body })).status).toBe(400);
    }
  });
});
