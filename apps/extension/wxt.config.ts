import { defineConfig } from "wxt";

import { DEFAULT_BACKEND_ORIGIN } from "./src/backendOrigin.ts";

/** The rescrobble backend this build talks to. Set WXT_BACKEND_ORIGIN for production builds. */
const backendOrigin = process.env.WXT_BACKEND_ORIGIN || DEFAULT_BACKEND_ORIGIN;

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  zip: { name: "rescrobble" },
  manifest: {
    name: "rescrobble",
    description: "Find, fix and remove Last.fm scrobbles in bulk, and add the plays Last.fm missed.",
    // The Chrome Web Store's public key for this item. It gives local builds the store's extension ID, which the Last.fm sign-in redirect and the backend's CORS rules depend on.
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtxTATOmzGRxzNs6KgeZ5W1VC/LgdlYWM3RXi9lpaU+dCrScf0h9SgMljm8ErZtXV7BaK6jtzq19XIJD1ggpQofmcicv5RFPB4JpNekf62No1FcSLR89jjMEN8ZVsf1BqzXp99kyqq3zBXTk8xbukpVhTK/UIAOCCipLxjVc1mmlFz/3lkvtc+DEt83V46wW84/++1a55TDRwOIRo72KNumAVTv7SNPiyjXnLM8WwWBAfg4Shb/0FpITs6vLHLqjmFf/i1wpBqAuWzV90nusmBZysVRw/BUTnIn+k5j2b8VftqcYvCh+yfLXwfmOQQnMDgbPlzYq+saymPM44WUPxfQIDAQAB",
    action: { default_title: "rescrobble" },
    permissions: ["identity", "storage", "tabs", "scripting", "unlimitedStorage"],
    host_permissions: ["https://www.last.fm/*", "https://ws.audioscrobbler.com/*", `${backendOrigin}/*`],
  },
});
