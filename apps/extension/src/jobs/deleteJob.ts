import type { Failure, SiteScrobble, WebsiteGateway } from "../website/gateway.ts";

/** Website requests go one at a time, about a second apart. */
export const jobTiming = { requestSpacingMs: 1000 };

export type TargetStatus = "queued" | "done" | "notFound" | "failed";

export interface JobTarget {
  id: string;
  artist: string;
  track: string;
  album: string;
  timestamp: number;
}

export interface JobEvents {
  onStatus: (id: string, status: TargetStatus) => void;
  /** The Job stopped early because continuing can't work: blocked by Last.fm, or logged out. */
  onStopped: (reason: Failure["reason"]) => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const sameTrack = (a: { artist: string; track: string }, b: { artist: string; track: string }) =>
  a.artist.toLocaleLowerCase() === b.artist.toLocaleLowerCase() && a.track.toLocaleLowerCase() === b.track.toLocaleLowerCase();

function byTrack(targets: JobTarget[]): JobTarget[][] {
  const groups = new Map<string, JobTarget[]>();
  for (const t of targets) {
    const key = `${t.artist.toLocaleLowerCase()}\u0000${t.track.toLocaleLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return [...groups.values()];
}

const STOPPING = new Set<Failure["reason"]>(["blocked", "loggedOut"]);

/**
 * Deletes each target through the website. For every Track, its scrobbles are read once to confirm
 * each target still exists at its timestamp; one that doesn't is skipped as "not found".
 */
export async function runDeleteJob(gateway: WebsiteGateway, user: string, targets: JobTarget[], events: JobEvents): Promise<void> {
  let first = true;
  const pace = async () => {
    if (!first) await sleep(jobTiming.requestSpacingMs);
    first = false;
  };

  for (const group of byTrack(targets)) {
    await pace();
    const listed = await gateway.listTrack(user, group[0]!.artist, group[0]!.track);
    if (!listed.ok) {
      if (STOPPING.has(listed.reason)) return events.onStopped(listed.reason);
      for (const t of group) events.onStatus(t.id, listed.reason === "notFound" ? "notFound" : "failed");
      continue;
    }
    for (const target of group) {
      const onSite: SiteScrobble | undefined = listed.scrobbles.find((s) => s.timestamp === target.timestamp && sameTrack(s, target));
      if (!onSite) {
        events.onStatus(target.id, "notFound");
        continue;
      }
      await pace();
      const deleted = await gateway.deleteScrobble(user, { artist: onSite.artist, track: onSite.track, timestamp: onSite.timestamp });
      if (deleted.ok) events.onStatus(target.id, "done");
      else if (STOPPING.has(deleted.reason)) return events.onStopped(deleted.reason);
      else events.onStatus(target.id, deleted.reason === "notFound" ? "notFound" : "failed");
    }
  }
}
