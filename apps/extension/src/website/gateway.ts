/** A Scrobble as the last.fm website shows it, with the exact values its forms carry. */
export interface SiteScrobble {
  artist: string;
  track: string;
  album: string;
  albumArtist: string;
  timestamp: number;
}

export interface TrackOnSite {
  scrobbles: SiteScrobble[];
  /** Whether the page offers editing, which only Last.fm Pro accounts get. */
  canEdit: boolean;
}

export type Failure =
  | { ok: false; reason: "rateLimited"; status: number }
  | { ok: false; reason: "blocked" }
  | { ok: false; reason: "loggedOut" }
  | { ok: false; reason: "notFound" }
  | { ok: false; reason: "editUnavailable" }
  | { ok: false; reason: "unexpected"; detail: string };

export type Result<T = object> = ({ ok: true } & T) | Failure;

export interface ScrobbleRef {
  artist: string;
  track: string;
  timestamp: number;
}

export interface NewValues {
  artist: string;
  track: string;
  album: string;
  albumArtist: string;
}

/** The narrow interface the app uses to change Scrobbles through the last.fm website. */
export interface WebsiteGateway {
  /** Every Scrobble of one Track in `user`'s library, across all pages. */
  listTrack(user: string, artist: string, track: string): Promise<Result<TrackOnSite>>;
  deleteScrobble(user: string, scrobble: ScrobbleRef): Promise<Result>;
  /**
   * Edits one Scrobble, identified by its exact current values. With `editAll`, Last.fm applies the
   * edit to every past Scrobble carrying those same values.
   */
  editScrobble(user: string, original: SiteScrobble, updated: NewValues, editAll: boolean): Promise<Result>;
}
