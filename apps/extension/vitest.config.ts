import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: "jsdom",
    setupFiles: ["fake-indexeddb/auto", "./src/test/setup.ts"],
  },
});
