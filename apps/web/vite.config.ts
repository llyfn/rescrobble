import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const backend = "http://localhost:8080";

export default defineConfig({
  plugins: [react()],
  server: {
    // The Last.fm callback and the session cookie go through these, so local sign-in works over plain http.
    proxy: { "/api": backend, "/auth": backend },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
