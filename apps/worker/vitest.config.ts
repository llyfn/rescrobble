import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { setupFiles: ["./test/setup.ts"] },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc", environment: "test" },
      // Set here so they win over a developer's local .dev.vars.
      miniflare: {
        bindings: {
          LASTFM_API_KEY: "test-api-key",
          LASTFM_SHARED_SECRET: "test-shared-secret",
          SESSION_ENCRYPTION_KEY: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
          PUBLIC_BASE_URL: "https://rescrobble.test",
          EXTENSION_ID: "testextensionid",
        },
      },
    }),
  ],
});
