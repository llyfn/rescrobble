import { setupNetwork } from "@msw/cloudflare";
import { http, HttpResponse, type JsonBodyType } from "msw";

const API_URL = "https://ws.audioscrobbler.com/2.0/";

/**
 * Answers any Last.fm call a test didn't script with a 501, so unexpected calls surface as errors,
 * and fails any other outbound request, so no test can reach the real network.
 */
export const network = setupNetwork();
network.configure({
  handlers: [http.all(API_URL, () => new HttpResponse(null, { status: 501 }))],
  onUnhandledFrame: "error",
});

export interface LastFmRequest {
  method: string;
  url: string;
  form: URLSearchParams;
}

/** A scripted Last.fm that records every request it receives. */
export function lastFm(reply: (method: string, form: URLSearchParams) => Response): LastFmRequest[] {
  const requests: LastFmRequest[] = [];
  network.use(http.all(API_URL, async ({ request }) => {
    const form = new URLSearchParams(await request.text());
    requests.push({ method: request.method, url: request.url, form });
    return reply(form.get("method") ?? "", form);
  }));
  return requests;
}

export const lastFmJson = (body: JsonBodyType, status = 200) => HttpResponse.json(body, { status }) as Response;
export const lastFmError = (code: number, message: string) => lastFmJson({ error: code, message }, 403);
export const lastFmDown = () => new HttpResponse("<html>bad gateway</html>", { status: 502 }) as Response;

export const sessionJson = (username: string, sessionKey: string) => ({ session: { name: username, key: sessionKey, subscriber: 0 } });
export const userInfoJson = (name: string, subscriber = "0") => ({ user: { name, realname: "", subscriber, playcount: "1234", type: "user" } });

/** One Last.fm `scrobble` entry as Last.fm's JSON format renders it. */
export function scrobbleEntryJson(
  artist: string,
  track: string,
  timestamp: string,
  { artistCorrected = false, trackCorrected = false, ignoredCode = 0, ignoredMessage = "" } = {},
) {
  return {
    artist: { corrected: artistCorrected ? "1" : "0", "#text": artist },
    track: { corrected: trackCorrected ? "1" : "0", "#text": track },
    album: { corrected: "0", "#text": "" },
    albumArtist: { corrected: "0", "#text": "" },
    timestamp,
    ignoredMessage: { code: String(ignoredCode), "#text": ignoredMessage },
  };
}

/** Wraps entries the way Last.fm does, including collapsing a single entry into a bare object. */
export function scrobblesJson(entries: ReturnType<typeof scrobbleEntryJson>[]) {
  const ignored = entries.filter((e) => e.ignoredMessage.code !== "0").length;
  return { scrobbles: { scrobble: entries.length === 1 ? entries[0]! : entries, "@attr": { accepted: entries.length - ignored, ignored } } };
}

/** Echoes every submitted Scrobble back as accepted and uncorrected. */
export function acceptAll(form: URLSearchParams) {
  const count = [...form.keys()].filter((k) => k.startsWith("artist[")).length;
  return scrobblesJson(Array.from({ length: count }, (_, i) => scrobbleEntryJson(form.get(`artist[${i}]`)!, form.get(`track[${i}]`)!, form.get(`timestamp[${i}]`)!)));
}

/** Signs in normally and answers track.scrobble with `scrobble`, by default accepting everything. */
export function scrobblingLastFm(scrobble: (form: URLSearchParams) => Response = (form) => lastFmJson(acceptAll(form))) {
  const requests = lastFm((method, form) => {
    if (method === "auth.getSession") return lastFmJson(sessionJson("rj", "session-key-123"));
    if (method === "track.scrobble") return scrobble(form);
    throw new Error(`unexpected Last.fm method ${method}`);
  });
  return { requests, scrobbleForms: () => requests.map((r) => r.form).filter((f) => f.get("method") === "track.scrobble") };
}
