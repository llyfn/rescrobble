import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import worker from "../src/index.ts";
import { readConfig, type Env } from "../src/config.ts";

const complete: Env = env as Env;
const healthWith = (overrides: Partial<Record<Exclude<keyof Env, "ASSETS" | "LIMITS">, string | undefined>>) =>
  worker.fetch(new Request("https://rescrobble.test/health"), { ...complete, ...overrides });

describe("configuration", () => {
  it("loads every required value", () => {
    const config = readConfig(complete);

    expect(config).toMatchObject({
      lastFmApiKey: "test-api-key",
      lastFmSharedSecret: "test-shared-secret",
      publicBaseUrl: "https://rescrobble.test",
      extensionId: "testextensionid",
    });
    expect(config.sessionEncryptionKey).toHaveLength(32);
  });

  it("drops a trailing slash on the public base URL", () => {
    expect(readConfig({ ...complete, PUBLIC_BASE_URL: "https://rescrobble.test/" }).publicBaseUrl).toBe("https://rescrobble.test");
  });

  it("answers every request with a 500 naming every missing value at once", async () => {
    const response = await healthWith({ LASTFM_SHARED_SECRET: undefined, EXTENSION_ID: undefined });

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("Missing required configuration: LASTFM_SHARED_SECRET, EXTENSION_ID");
  });

  it("counts a blank value as missing", async () => {
    expect(await (await healthWith({ PUBLIC_BASE_URL: "  " })).text()).toBe("Missing required configuration: PUBLIC_BASE_URL");
  });

  it("refuses a session encryption key that isn't 32 base64-encoded bytes", async () => {
    for (const key of ["not base64!", btoa("too short")]) {
      const response = await healthWith({ SESSION_ENCRYPTION_KEY: key });
      expect(response.status).toBe(500);
      expect(await response.text()).toBe("SESSION_ENCRYPTION_KEY must be 32 random bytes, base64-encoded");
    }
  });
});
