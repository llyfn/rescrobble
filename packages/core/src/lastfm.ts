export const LASTFM_API_URL = "https://ws.audioscrobbler.com/2.0/";

export interface TrackMatch {
  artist: string;
  track: string;
}

export interface AlbumMatch {
  artist: string;
  album: string;
}

export interface AlbumTrack {
  title: string;
  artist: string;
  durationSeconds: number | null;
}

export interface Album {
  artist: string;
  name: string;
  tracks: AlbumTrack[];
}

/** Last.fm's code for an artist, album or track it doesn't know. */
const NOT_FOUND = 6;

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

  async searchAlbums(album: string, options: { limit?: number; signal?: AbortSignal } = {}): Promise<AlbumMatch[]> {
    const body = await this.get("album.search", { album, limit: String(options.limit ?? 8) }, options.signal);
    const matches = asList((body as AlbumSearchResponse).results?.albummatches?.album);
    return matches.map((m) => ({ artist: m.artist, album: m.name }));
  }

  /** The album with its tracklist, or null when Last.fm doesn't know the album. */
  async getAlbum(artist: string, album: string, options: { signal?: AbortSignal } = {}): Promise<Album | null> {
    let body: unknown;
    try {
      body = await this.get("album.getinfo", { artist, album, autocorrect: "1" }, options.signal);
    } catch (e) {
      if (e instanceof LastFmError && e.code === NOT_FOUND) return null;
      throw e;
    }
    const info = (body as AlbumInfoResponse).album;
    if (!info) return null;
    return {
      artist: info.artist,
      name: info.name,
      tracks: asList(info.tracks?.track).map((t) => ({
        title: t.name,
        artist: t.artist?.name ?? info.artist,
        durationSeconds: Number(t.duration) > 0 ? Number(t.duration) : null,
      })),
    };
  }

  private async get(method: string, params: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    const url = new URL(LASTFM_API_URL);
    for (const [key, value] of Object.entries({ ...params, method, api_key: this.apiKey, format: "json" })) {
      url.searchParams.set(key, value);
    }
    const response = await this.fetchFn(url, { signal });
    const body = await response.json() as { error?: number; message?: string };
    if (!response.ok || body.error) throw new LastFmError(method, body.error, body.message ?? String(response.status));
    return body;
  }
}

export class LastFmError extends Error {
  constructor(method: string, readonly code: number | undefined, message: string) {
    super(`Last.fm ${method} failed: ${message}`);
  }
}

interface AlbumSearchResponse {
  results?: { albummatches?: { album?: { name: string; artist: string } | { name: string; artist: string }[] } };
}

interface AlbumInfoTrack {
  name: string;
  duration?: number | string | null;
  artist?: { name: string };
}

interface AlbumInfoResponse {
  album?: { name: string; artist: string; tracks?: { track?: AlbumInfoTrack | AlbumInfoTrack[] } };
}

interface TrackSearchResponse {
  results?: { trackmatches?: { track?: { name: string; artist: string } | { name: string; artist: string }[] } };
}
