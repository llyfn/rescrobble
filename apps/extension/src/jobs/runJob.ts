import { applyEdit, caseOnlyFields, changedFields, type EditableValues, type FieldChange } from "@rescrobble/core";
import type { Failure, SiteScrobble, WebsiteGateway } from "../website/gateway.ts";

/** Website requests go one at a time, about a second apart. */
export const jobTiming = { requestSpacingMs: 1000 };

export type JobKind = { kind: "delete" } | { kind: "edit"; changes: FieldChange[] };

export type TargetStatus = "queued" | "done" | "notFound" | "failed" | "unchanged";

export interface JobTarget {
  id: string;
  artist: string;
  track: string;
  album: string;
  timestamp: number;
}

export interface JobEvents {
  /** `after` carries an edited Scrobble's new values. */
  onStatus: (id: string, status: TargetStatus, after?: EditableValues) => void;
  /** The Job stopped early because continuing can't work: blocked, logged out, or editing not available. */
  onStopped: (reason: Failure["reason"]) => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const lower = (s: string) => s.toLocaleLowerCase();
const sameTrack = (a: { artist: string; track: string }, b: { artist: string; track: string }) =>
  lower(a.artist) === lower(b.artist) && lower(a.track) === lower(b.track);
const sameValues = (a: EditableValues, b: EditableValues) =>
  a.artist === b.artist && a.track === b.track && a.album === b.album && a.albumArtist === b.albumArtist;

function byTrack(targets: JobTarget[]): JobTarget[][] {
  const groups = new Map<string, JobTarget[]>();
  for (const t of targets) {
    const key = `${lower(t.artist)}\u0000${lower(t.track)}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return [...groups.values()];
}

const STOPPING = new Set<Failure["reason"]>(["blocked", "loggedOut", "editUnavailable"]);

/** What an Edit makes of a Scrobble's current values, or null when Last.fm wouldn't change anything. */
export function editedValues(onSite: EditableValues, changes: FieldChange[]): EditableValues | null {
  const after = applyEdit(onSite, changes);
  const caseOnly = new Set(caseOnlyFields(onSite, after));
  const real = changedFields(onSite, after).filter((f) => !caseOnly.has(f));
  if (real.length === 0) return null;
  for (const f of caseOnly) after[f] = onSite[f];
  return after;
}

/**
 * Runs a Job through the website. For every Track, its scrobbles are read once to confirm each target
 * still exists at its timestamp and to get the exact values the website's forms need; a target that's
 * gone is skipped as "not found". An Edit covering every Scrobble of a Track with the same values and
 * the same result is sent once, applied to all of them.
 */
export async function runJob(gateway: WebsiteGateway, user: string, targets: JobTarget[], job: JobKind, events: JobEvents): Promise<void> {
  let first = true;
  const pace = async () => {
    if (!first) await sleep(jobTiming.requestSpacingMs);
    first = false;
  };
  const settle = (id: string, result: { ok: true } | Failure, after?: EditableValues): boolean => {
    if (result.ok) {
      events.onStatus(id, "done", after);
      return true;
    }
    if (STOPPING.has(result.reason)) {
      events.onStopped(result.reason);
      return false;
    }
    events.onStatus(id, result.reason === "notFound" ? "notFound" : "failed");
    return true;
  };

  for (const group of byTrack(targets)) {
    await pace();
    const listed = await gateway.listTrack(user, group[0]!.artist, group[0]!.track);
    if (!listed.ok) {
      if (STOPPING.has(listed.reason)) return events.onStopped(listed.reason);
      for (const t of group) events.onStatus(t.id, listed.reason === "notFound" ? "notFound" : "failed");
      continue;
    }
    if (job.kind === "edit" && !listed.canEdit) return events.onStopped("editUnavailable");

    const found: { target: JobTarget; onSite: SiteScrobble }[] = [];
    for (const target of group) {
      const onSite = listed.scrobbles.find((s) => s.timestamp === target.timestamp && sameTrack(s, target));
      if (onSite) found.push({ target, onSite });
      else events.onStatus(target.id, "notFound");
    }

    if (job.kind === "delete") {
      for (const { target, onSite } of found) {
        await pace();
        if (!settle(target.id, await gateway.deleteScrobble(user, onSite))) return;
      }
      continue;
    }

    const edits = found.flatMap(({ target, onSite }) => {
      const after = editedValues(onSite, job.changes);
      if (!after) events.onStatus(target.id, "unchanged");
      return after ? [{ target, onSite, after }] : [];
    });
    const coversTrack = edits.length > 1 && edits.length === listed.scrobbles.length
      && edits.every((e) => sameValues(e.onSite, edits[0]!.onSite) && sameValues(e.after, edits[0]!.after));
    if (coversTrack) {
      await pace();
      const result = await gateway.editScrobble(user, edits[0]!.onSite, edits[0]!.after, true);
      for (const e of edits) if (!settle(e.target.id, result, e.after)) return;
      continue;
    }
    for (const { target, onSite, after } of edits) {
      await pace();
      if (!settle(target.id, await gateway.editScrobble(user, onSite, after, false), after)) return;
    }
  }
}
