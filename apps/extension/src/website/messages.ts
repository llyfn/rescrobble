import type { Result, ScrobbleRef, TrackOnSite } from "./gateway.ts";

/** Messages from the app to the content script in the last.fm tab. */
export type SiteRequest =
  | { target: "rescrobble-site"; op: "listTrack"; user: string; artist: string; track: string }
  | { target: "rescrobble-site"; op: "deleteScrobble"; user: string; scrobble: ScrobbleRef };

export type SiteResponse = Result<TrackOnSite> | Result;
