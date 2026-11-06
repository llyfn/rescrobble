export const LASTFM_API_URL = "https://ws.audioscrobbler.com/2.0/";

export interface TrackMatch {
  artist: string;
  track: string;
}

/** Last.fm's JSON sends a one-item list as a bare object, and an empty one as nothing at all. */
export function asList<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Unsigned read calls to the public Last.fm API. Only the public API key is needed. */
export class LastFmReader {
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
  ) {}

  async searchTracks(track: string, options: { artist?: string; limit?: number; signal?: AbortSignal } = {}): Promise<TrackMatch[]> {
    const params: Record<string, string> = { track, limit: String(options.limit ?? 8) };
    if (options.artist) params.artist = options.artist;
    const body = await this.get("track.search", params, options.signal);
    const matches = asList((body as TrackSearchResponse).results?.trackmatches?.track);
    return matches.map((m) => ({ artist: m.artist, track: m.name }));
  }

  private async get(method: string, params: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    const url = new URL(LASTFM_API_URL);
    for (const [key, value] of Object.entries({ ...params, method, api_key: this.apiKey, format: "json" })) {
      url.searchParams.set(key, value);
    }
    const response = await this.fetchFn(url, { signal });
    const body = await response.json() as { error?: number; message?: string };
    if (!response.ok || body.error) throw new Error(`Last.fm ${method} failed: ${body.message ?? response.status}`);
    return body;
  }
}

interface TrackSearchResponse {
  results?: { trackmatches?: { track?: { name: string; artist: string } | { name: string; artist: string }[] } };
}
