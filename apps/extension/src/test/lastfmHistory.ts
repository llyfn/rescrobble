import { http, HttpResponse } from "msw";
import { LASTFM_API_URL } from "@rescrobble/core";
import { server } from "./server.ts";

export interface Play { timestamp: number; artist: string; track: string; album?: string }

/** Generates `count` plays, one every 4 minutes, ending at `newest`. */
export function plays(count: number, newest = 1_790_000_000, artist = "Radiohead"): Play[] {
  return Array.from({ length: count }, (_, i) => ({ timestamp: newest - i * 240, artist, track: `Track ${count - i}`, album: "OK Computer" }));
}

export interface RecentRequest { page: number; from: number | null; to: number | null; user: string | null }

/**
 * A scripted Last.fm history answering user.getrecenttracks like Last.fm does: newest first, 200 per
 * page, honouring from and to, with an optional now-playing track on top. `respond` can intercept a request.
 */
export function lastFmHistory(history: Play[], options: { nowPlaying?: boolean; respond?: (req: RecentRequest) => Promise<Response | undefined> | Response | undefined } = {}) {
  const requests: RecentRequest[] = [];
  server.use(http.get(LASTFM_API_URL, async ({ request }) => {
    const params = new URL(request.url).searchParams;
    if (params.get("method") !== "user.getrecenttracks") return HttpResponse.json({ results: {} });
    const req: RecentRequest = {
      page: Number(params.get("page")),
      from: params.has("from") ? Number(params.get("from")) : null,
      to: params.has("to") ? Number(params.get("to")) : null,
      user: params.get("user"),
    };
    requests.push(req);
    const intercepted = await options.respond?.(req);
    if (intercepted) return intercepted;

    const limit = Number(params.get("limit"));
    const matching = [...history]
      .sort((a, b) => b.timestamp - a.timestamp)
      .filter((p) => (req.from === null || p.timestamp >= req.from) && (req.to === null || p.timestamp <= req.to));
    const pageItems = matching.slice((req.page - 1) * limit, req.page * limit);
    const track = pageItems.map((p) => ({
      name: p.track, artist: { "#text": p.artist }, album: { "#text": p.album ?? "" }, date: { uts: String(p.timestamp) },
    }));
    if (options.nowPlaying && req.page === 1) {
      track.unshift({ name: "Playing Now", artist: { "#text": "Someone" }, album: { "#text": "" }, "@attr": { nowplaying: "true" } } as never);
    }
    return HttpResponse.json({
      recenttracks: {
        track,
        "@attr": { page: String(req.page), totalPages: String(Math.ceil(matching.length / limit)), total: String(matching.length), perPage: String(limit) },
      },
    });
  }));
  return { requests, history };
}
