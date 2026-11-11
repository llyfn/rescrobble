import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browser, EXTENSION, sessionCookieOf } from "./browser.ts";
import { freezeClock, HOUR_AGO } from "./clock.ts";
import { lastFm, lastFmError, lastFmJson, sessionJson } from "./lastfm.ts";

freezeClock();
const METHODS = ["log", "info", "warn", "error", "debug"] as const;
let logged: string[] = [];

beforeEach(() => {
  logged = [];
  for (const method of METHODS) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    });
  }
});
afterEach(() => vi.restoreAllMocks());

describe("logs", () => {
  it("never contain tokens, session keys or the shared secret across sign-in, me, submitting and logout", async () => {
    lastFm((method, form) => {
      if (method === "user.getInfo" || method === "track.scrobble") return lastFmError(9, "Invalid session key - Please re-authenticate");
      if (form.get("token") === "secret-token-ok") return lastFmJson(sessionJson("rj", "secret-session-key"));
      return lastFmError(4, "Invalid authentication token supplied");
    });

    const cookie = sessionCookieOf(await browser().get("/auth/callback?token=secret-token-ok"))!;
    const cookieHeader = { Cookie: `${cookie.name}=${cookie.value}` };
    await browser().get("/api/me", { headers: cookieHeader });
    await browser().post("/api/scrobbles", { headers: cookieHeader, body: { scrobbles: [{ artist: "Cher", track: "Believe", timestamp: HOUR_AGO }] } });
    await browser().post("/auth/logout", { headers: cookieHeader });
    await browser().get("/auth/callback?token=secret-token-bad");

    const { token } = await (await browser(EXTENSION).post("/auth/session", { body: { token: "secret-token-ok" } })).json() as { token: string };
    await browser(EXTENSION).get("/api/me", { headers: { Authorization: `Bearer ${token}` } });
    await browser(EXTENSION).post("/auth/session", { body: { token: "secret-token-bad" } });

    const text = logged.join("\n");
    for (const secret of ["secret-token-ok", "secret-token-bad", "secret-session-key", "test-shared-secret", token, cookie.value]) {
      expect(text, `'${secret}' appeared in logs`).not.toContain(secret);
    }
  });
});
