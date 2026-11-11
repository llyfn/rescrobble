export const API_URL = "https://ws.audioscrobbler.com/2.0/";
export const AUTH_URL = "https://www.last.fm/api/auth/";
/** Last.fm's code for a session key that was revoked or never valid. */
export const INVALID_SESSION = 9;

export interface LastFmSession {
  username: string;
  sessionKey: string;
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
