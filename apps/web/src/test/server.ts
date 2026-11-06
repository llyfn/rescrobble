import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

/** By default nobody is signed in; tests override handlers for the scenario they need. */
export const server = setupServer(
  http.get("/api/me", () => new HttpResponse(null, { status: 401 })),
);
