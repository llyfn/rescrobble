import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { LASTFM_API_URL } from "@rescrobble/core";

export const BACKEND = "http://localhost:8080";

export const server = setupServer(
  http.get(`${BACKEND}/api/config`, () => HttpResponse.json({ lastFmApiKey: "test-api-key" })),
  http.get(`${BACKEND}/api/me`, () => new HttpResponse(null, { status: 401 })),
  http.get(LASTFM_API_URL, () => HttpResponse.json({ results: {} })),
);
