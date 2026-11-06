import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse, type JsonBodyType } from "msw";
import { App } from "../App.tsx";
import { server } from "./server.ts";

/** Renders the app signed in as `rj` and waits for the Add scrobbles screen. */
export async function renderSignedIn() {
  server.use(http.get("/api/me", () => HttpResponse.json({ username: "rj", pro: false })));
  const user = userEvent.setup();
  const view = render(<App />);
  await screen.findByRole("heading", { name: "Add scrobbles" });
  return { user, ...view };
}

export interface SentEntry { artist: string; track: string; timestamp: number; album?: string; albumArtist?: string }

/** Answers /api/scrobbles with `respond` and records every request body. */
export function scrobbleEndpoint(respond: (entries: SentEntry[]) => JsonBodyType = acceptAll) {
  const requests: SentEntry[][] = [];
  server.use(http.post("/api/scrobbles", async ({ request }) => {
    const body = await request.json() as { scrobbles: SentEntry[] };
    requests.push(body.scrobbles);
    return HttpResponse.json(respond(body.scrobbles));
  }));
  return requests;
}

export function acceptAll(entries: SentEntry[]) {
  return {
    results: entries.map((e) => ({ status: "accepted", artist: e.artist, artistCorrected: false, track: e.track, trackCorrected: false })),
  };
}
