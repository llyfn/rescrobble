import type { Failure, NewValues, Result, ScrobbleRef, SiteScrobble, TrackOnSite, WebsiteGateway } from "../website/gateway.ts";

export interface GatewayCall {
  op: "listTrack" | "deleteScrobble" | "editScrobble";
  artist: string;
  track: string;
  timestamp?: number;
  updated?: NewValues;
  original?: SiteScrobble;
  editAll?: boolean;
  at: number;
}

/** An in-memory last.fm library behind the website gateway, scriptable per test. */
export class FakeLastFmWebsite implements WebsiteGateway {
  readonly calls: GatewayCall[] = [];
  pro = true;
  private failures: { op: GatewayCall["op"]; failure: Failure }[] = [];

  constructor(public library: SiteScrobble[]) {}

  /** The next call of `op` fails with `failure`. Queue several to fail several times. */
  failNext(op: GatewayCall["op"], failure: Failure) {
    this.failures.push({ op, failure });
  }

  private takeFailure(op: GatewayCall["op"]): Failure | null {
    const i = this.failures.findIndex((f) => f.op === op);
    return i < 0 ? null : this.failures.splice(i, 1)[0]!.failure;
  }

  async listTrack(_user: string, artist: string, track: string): Promise<Result<TrackOnSite>> {
    this.calls.push({ op: "listTrack", artist, track, at: Date.now() });
    const failure = this.takeFailure("listTrack");
    if (failure) return failure;
    const same = (s: SiteScrobble) => s.artist.toLowerCase() === artist.toLowerCase() && s.track.toLowerCase() === track.toLowerCase();
    return { ok: true, scrobbles: this.library.filter(same), canEdit: this.pro };
  }

  async deleteScrobble(_user: string, ref: ScrobbleRef): Promise<Result> {
    this.calls.push({ op: "deleteScrobble", artist: ref.artist, track: ref.track, timestamp: ref.timestamp, at: Date.now() });
    const failure = this.takeFailure("deleteScrobble");
    if (failure) return failure;
    const before = this.library.length;
    this.library = this.library.filter((s) => !(s.timestamp === ref.timestamp && s.track === ref.track && s.artist === ref.artist));
    return this.library.length < before ? { ok: true } : { ok: false, reason: "notFound" };
  }

  async editScrobble(_user: string, original: SiteScrobble, updated: NewValues, editAll: boolean): Promise<Result> {
    this.calls.push({ op: "editScrobble", artist: original.artist, track: original.track, timestamp: original.timestamp, original, updated, editAll, at: Date.now() });
    const failure = this.takeFailure("editScrobble");
    if (failure) return failure;
    if (!this.pro) return { ok: false, reason: "editUnavailable" };
    const matches = (s: SiteScrobble) =>
      s.artist === original.artist && s.track === original.track && s.album === original.album && s.albumArtist === original.albumArtist
      && (editAll || s.timestamp === original.timestamp);
    let edited = 0;
    this.library = this.library.map((s) => (matches(s) ? (edited++, { ...s, ...updated }) : s));
    return edited > 0 ? { ok: true } : { ok: false, reason: "notFound" };
  }
}

export function siteScrobble(timestamp: number, artist: string, track: string, album = ""): SiteScrobble {
  return { timestamp, artist, track, album, albumArtist: artist };
}
