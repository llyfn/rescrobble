import type { NewValues, Result, ScrobbleRef, SiteScrobble, TrackOnSite } from "./gateway.ts";

/** Messages from the app to the content script in the last.fm tab. */
export type SiteRequest =
  | { target: "rescrobble-site"; op: "listTrack"; user: string; artist: string; track: string }
  | { target: "rescrobble-site"; op: "deleteScrobble"; user: string; scrobble: ScrobbleRef }
  | { target: "rescrobble-site"; op: "editScrobble"; user: string; original: SiteScrobble; updated: NewValues; editAll: boolean };

export type SiteResponse = Result<TrackOnSite> | Result;
