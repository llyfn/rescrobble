import { defineConfig } from "wxt";

import { DEFAULT_BACKEND_ORIGIN } from "./src/backendOrigin.ts";

/** The rescrobble backend this build talks to. Set WXT_BACKEND_ORIGIN for production builds. */
const backendOrigin = process.env.WXT_BACKEND_ORIGIN || DEFAULT_BACKEND_ORIGIN;

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "rescrobble",
    description: "Find, fix and remove Last.fm scrobbles in bulk, and add the plays Last.fm missed.",
    // Public half of the signing key. It pins the extension ID, which the Last.fm sign-in redirect and the backend's CORS rules depend on.
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAw4R7Icq2XFCuaH8/b5XX0f2+MCxl6uTD34KIYlJWlbI9nMNIPzWSZ+wpsgD26sc8fAWS4Z1ulq69HcarLN89kZs96D4yHRtzE6ejx8ESEDORRXSV4pVbxQl9M/ZEXwuq9DHn6xq104lr5UikWU6mfsUVNRwObyxe8Q8Fmlczf7K07wW5IKkHvtthv3a7YpD8DA4bUdhc6NA0qGw36nJyjE7DAMpuSYmH1r8vfQKPOAwvctKVIEgYEfLubCPtNLuF3/DA15Hey/Tk64RByR6KPdyxtzWm7KohxLBTPsl7ZJoRLx7s6p3h5wSFrJtxdsMXnuI98BqZYvik/GD29LEfKQIDAQAB",
    action: { default_title: "Open rescrobble" },
    permissions: ["identity", "storage", "tabs", "scripting", "unlimitedStorage"],
    host_permissions: ["https://www.last.fm/*", "https://ws.audioscrobbler.com/*", `${backendOrigin}/*`],
  },
});
