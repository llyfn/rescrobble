import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";

const get = (path: string) => SELF.fetch(`https://rescrobble.test${path}`);
const ENTRY_PAGE = "<!doctype html><title>rescrobble</title>";

describe("health and config", () => {
  it("answers the health check", async () => {
    const response = await get("/health");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it("returns the public API key without signing in, and lets it be cached", async () => {
    const response = await get("/api/config");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ lastFmApiKey: "test-api-key" });
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
  });

  it("never exposes the shared secret or the session encryption key in config", async () => {
    const body = await (await get("/api/config")).text();

    expect(body).not.toContain("test-shared-secret");
    expect(body).not.toContain("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=");
  });
});

describe("serving the Web App", () => {
  it("serves the entry page at the root", async () => {
    const response = await get("/");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toMatch(/^text\/html/);
    expect(await response.text()).toBe(ENTRY_PAGE);
  });

  it("serves static files with their content types", async () => {
    const script = await get("/assets/app.js");
    const style = await get("/assets/app.css");

    expect(await script.text()).toBe("console.log('rescrobble')");
    expect(script.headers.get("Content-Type")).toMatch(/^(text|application)\/javascript/);
    expect(style.headers.get("Content-Type")).toMatch(/^text\/css/);
  });

  it("falls back to the entry page for a deep link inside the Web App", async () => {
    const response = await get("/scrobble/album?artist=Cher");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(ENTRY_PAGE);
  });

  it("still answers API, auth and health routes alongside the Web App", async () => {
    expect(await (await get("/health")).text()).toBe("ok");
    expect((await get("/api/me")).status).toBe(401);
    expect((await SELF.fetch("https://rescrobble.test/auth/login", { redirect: "manual" })).status).toBe(302);
  });

  it("keeps unknown API and auth paths 404, even for a browser navigation", async () => {
    for (const path of ["/api/unknown", "/api/me/extra", "/auth/unknown", "/api", "/auth"]) {
      const response = await SELF.fetch(`https://rescrobble.test${path}`, { headers: { "Sec-Fetch-Mode": "navigate", Accept: "text/html" } });
      expect(response.status, path).toBe(404);
    }
  });
});
