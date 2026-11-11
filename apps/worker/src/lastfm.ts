export const API_URL = "https://ws.audioscrobbler.com/2.0/";
export const AUTH_URL = "https://www.last.fm/api/auth/";
/** Last.fm's code for a session key that was revoked or never valid. */
export const INVALID_SESSION = 9;
export const MAX_BATCH = 50;

export interface LastFmSession {
  username: string;
  sessionKey: string;
}

export interface LastFmUser {
  name: string;
  /** Null when Last.fm doesn't say. */
  pro: boolean | null;
}

export interface ScrobbleSubmission {
  artist: string;
  track: string;
  timestamp: number;
  album?: string;
  albumArtist?: string;
}

export type ScrobbleOutcome =
  | { status: "accepted"; artist: string; artistCorrected: boolean; track: string; trackCorrected: boolean }
  | { status: "ignored"; code: number; message: string };

interface ScrobbleEntryJson {
  artist?: { "#text"?: string; corrected?: string };
  track?: { "#text"?: string; corrected?: string };
  ignoredMessage?: { code?: string; "#text"?: string };
}

/** Last.fm answered with an API error code. */
export class LastFmApiError extends Error {
  constructor(readonly code: number, message: string) {
    super(`Last.fm error ${code}: ${message}`);
  }
}

/** Last.fm could not be reached or answered with something other than an API response. */
export class LastFmUnavailable extends Error {}

/**
 * Last.fm signs every parameter except `format` and `callback`, sorted by name in code-unit order
 * (so `artist[10]` comes before `artist[1]`), followed by the shared secret, hashed with MD5.
 */
export async function signature(params: Record<string, string>, sharedSecret: string): Promise<string> {
  const payload = Object.keys(params)
    .filter((k) => k !== "format" && k !== "callback")
    .sort()
    .map((k) => k + params[k])
    .join("") + sharedSecret;
  // MD5 isn't in the Web Crypto standard; the Workers runtime supports it.
  const digest = await crypto.subtle.digest("MD5", new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class LastFmClient {
  constructor(private readonly apiKey: string, private readonly sharedSecret: string) {}

  async getSession(token: string): Promise<LastFmSession> {
    const session = (await this.signedCall("auth.getSession", { token })).session as { name?: string; key?: string } | undefined;
    if (!session?.name || !session.key) throw new LastFmUnavailable("auth.getSession response has no session");
    return { username: session.name, sessionKey: session.key };
  }

  /** Signed with the session key and no `user`, so Last.fm answers for, and validates, that session. */
  async getAuthenticatedUser(sessionKey: string): Promise<LastFmUser> {
    const user = (await this.signedCall("user.getInfo", { sk: sessionKey })).user as { name?: string; subscriber?: unknown } | undefined;
    if (!user?.name) throw new LastFmUnavailable("user.getInfo response has no user");
    // Last.fm doesn't define `subscriber`; clients read it as the Pro flag, sent as "1"/"0".
    const flag = String(user.subscriber);
    return { name: user.name, pro: flag === "1" || flag === "true" ? true : flag === "0" || flag === "false" ? false : null };
  }

  /** Submits up to 50 Scrobbles in one batch; outcomes come back in submission order. */
  async scrobble(sessionKey: string, submissions: ScrobbleSubmission[]): Promise<ScrobbleOutcome[]> {
    const params: Record<string, string> = { sk: sessionKey };
    submissions.forEach((s, i) => {
      params[`artist[${i}]`] = s.artist;
      params[`track[${i}]`] = s.track;
      params[`timestamp[${i}]`] = String(s.timestamp);
      if (s.album !== undefined) params[`album[${i}]`] = s.album;
      if (s.albumArtist !== undefined) params[`albumArtist[${i}]`] = s.albumArtist;
    });
    const scrobbles = (await this.signedCall("track.scrobble", params)).scrobbles as { scrobble?: ScrobbleEntryJson | ScrobbleEntryJson[] } | undefined;
    if (!scrobbles) throw new LastFmUnavailable("track.scrobble response has no scrobbles");
    // Last.fm's JSON collapses a one-element list into a bare object.
    const entries = Array.isArray(scrobbles.scrobble) ? scrobbles.scrobble : scrobbles.scrobble ? [scrobbles.scrobble] : [];
    if (entries.length !== submissions.length) {
      throw new LastFmUnavailable(`track.scrobble returned ${entries.length} results for ${submissions.length} Scrobbles`);
    }
    return entries.map(outcomeOf);
  }

  protected async signedCall(method: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    const signed = { ...params, method, api_key: this.apiKey };
    const form = { ...signed, api_sig: await signature(signed, this.sharedSecret), format: "json" };

    let text: string;
    try {
      text = await (await fetch(API_URL, { method: "POST", body: new URLSearchParams(form) })).text();
    } catch {
      throw new LastFmUnavailable("Last.fm request failed");
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new LastFmUnavailable("Last.fm returned a non-JSON response");
    }
    if (typeof json !== "object" || json === null || Array.isArray(json)) throw new LastFmUnavailable("Last.fm returned a non-object response");
    const body = json as Record<string, unknown>;
    if (body.error !== undefined) throw new LastFmApiError(Number(body.error), String(body.message ?? ""));
    return body;
  }
}

function outcomeOf(entry: ScrobbleEntryJson): ScrobbleOutcome {
  const ignoredCode = Number(entry.ignoredMessage?.code ?? 0) || 0;
  if (ignoredCode !== 0) return { status: "ignored", code: ignoredCode, message: entry.ignoredMessage?.["#text"] ?? "" };
  return {
    status: "accepted",
    artist: entry.artist?.["#text"] ?? "",
    artistCorrected: entry.artist?.corrected === "1",
    track: entry.track?.["#text"] ?? "",
    trackCorrected: entry.track?.corrected === "1",
  };
}
