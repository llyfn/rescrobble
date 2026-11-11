export const LASTFM_API_URL = "https://ws.audioscrobbler.com/2.0/";

export interface TrackMatch {
  artist: string;
  track: string;
}

export interface AlbumMatch {
  artist: string;
  album: string;
  /** Album art, or null when Last.fm has none. */
  image: string | null;
}

/** The album Last.fm files a track under. */
export interface TrackAlbum {
  album: string;
  image: string | null;
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

/** One recorded play as Last.fm's history reports it. */
export interface RecentScrobble {
  artist: string;
  track: string;
  album: string;
  timestamp: number;
}

export interface RecentTracksPage {
  scrobbles: RecentScrobble[];
  page: number;
  totalPages: number;
  total: number;
}

/** Last.fm's code for an artist, album or track it doesn't know. */
const NOT_FOUND = 6;

/** Last.fm's grey star, sent in place of art it doesn't have. */
const PLACEHOLDER_IMAGE = "2a96cbd8b46e442fc41c2b86b821562f";

/** The 174px art (crisp at 40px on high-density screens), or null for none or the placeholder. */
function imageUrl(images: LastFmImage[] | undefined): string | null {
  const url = images?.find((i) => i.size === "large")?.["#text"];
  return url && !url.includes(PLACEHOLDER_IMAGE) ? url : null;
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

  async searchAlbums(album: string, options: { limit?: number; signal?: AbortSignal } = {}): Promise<AlbumMatch[]> {
    const body = await this.get("album.search", { album, limit: String(options.limit ?? 8) }, options.signal);
    const matches = asList((body as AlbumSearchResponse).results?.albummatches?.album);
    return matches.map((m) => ({ artist: m.artist, album: m.name, image: imageUrl(m.image) }));
  }

  async searchArtists(artist: string, options: { limit?: number; signal?: AbortSignal } = {}): Promise<string[]> {
    const body = await this.get("artist.search", { artist, limit: String(options.limit ?? 8) }, options.signal);
    return asList((body as ArtistSearchResponse).results?.artistmatches?.artist).map((m) => m.name);
  }

  /** The album of a track, or null when Last.fm doesn't know the track or files it under no album. */
  async getTrackAlbum(artist: string, track: string, options: { signal?: AbortSignal } = {}): Promise<TrackAlbum | null> {
    let body: unknown;
    try {
      body = await this.get("track.getInfo", { artist, track, autocorrect: "1" }, options.signal);
    } catch (e) {
      if (e instanceof LastFmError && e.code === NOT_FOUND) return null;
      throw e;
    }
    const album = (body as TrackInfoResponse).track?.album;
    return album?.title ? { album: album.title, image: imageUrl(album.image) } : null;
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

  /**
   * One page of a user's history, newest first, at most 200 per page. The track playing right now
   * has no timestamp yet and is left out.
   */
  async getRecentTracks(
    user: string,
    options: { page?: number; limit?: number; from?: number; to?: number; signal?: AbortSignal } = {},
  ): Promise<RecentTracksPage> {
    const params: Record<string, string> = { user, page: String(options.page ?? 1), limit: String(options.limit ?? 200) };
    if (options.from !== undefined) params.from = String(options.from);
    if (options.to !== undefined) params.to = String(options.to);
    const body = (await this.get("user.getrecenttracks", params, options.signal)) as RecentTracksResponse;
    const attr = body.recenttracks?.["@attr"];
    const scrobbles = asList(body.recenttracks?.track)
      .filter((t) => t["@attr"]?.nowplaying !== "true" && t.date?.uts)
      .map((t) => ({
        artist: t.artist["#text"],
        track: t.name,
        album: t.album?.["#text"] ?? "",
        timestamp: Number(t.date!.uts),
      }));
    return {
      scrobbles,
      page: Number(attr?.page ?? 1),
      totalPages: Number(attr?.totalPages ?? 0),
      total: Number(attr?.total ?? 0),
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

interface RecentTrack {
  name: string;
  artist: { "#text": string };
  album?: { "#text": string };
  date?: { uts: string };
  "@attr"?: { nowplaying?: string };
}

interface RecentTracksResponse {
  recenttracks?: {
    track?: RecentTrack | RecentTrack[];
    "@attr"?: { page: string; totalPages: string; total: string };
  };
}

interface LastFmImage {
  "#text": string;
  size: string;
}

interface AlbumSearchMatch {
  name: string;
  artist: string;
  image?: LastFmImage[];
}

interface AlbumSearchResponse {
  results?: { albummatches?: { album?: AlbumSearchMatch | AlbumSearchMatch[] } };
}

interface ArtistSearchResponse {
  results?: { artistmatches?: { artist?: { name: string } | { name: string }[] } };
}

interface TrackInfoResponse {
  track?: { album?: { title?: string; image?: LastFmImage[] } };
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
