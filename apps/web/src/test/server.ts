import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { LASTFM_API_URL } from "@rescrobble/core";

/** By default nobody is signed in; tests override handlers for the scenario they need. */
export const server = setupServer(
  http.get("/api/me", () => new HttpResponse(null, { status: 401 })),
  http.get("/api/config", () => HttpResponse.json({ lastFmApiKey: "test-api-key" })),
  http.get(LASTFM_API_URL, () => HttpResponse.json({ results: {} })),
);
