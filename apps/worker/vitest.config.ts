import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc", environment: "test" },
      // Set here so they win over a developer's local .dev.vars.
      miniflare: {
        bindings: {
          LASTFM_API_KEY: "test-api-key",
          LASTFM_SHARED_SECRET: "test-shared-secret",
          SESSION_ENCRYPTION_KEY: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
          PUBLIC_BASE_URL: "https://rescrobble.example",
          EXTENSION_ID: "abcdefghijklmnopabcdefghijklmnop",
        },
      },
    }),
  ],
});
