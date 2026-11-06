import { applyEdit, caseOnlyFields, changedFields, type EditableValues, type FieldChange } from "@rescrobble/core";

export type TargetStatus = "queued" | "done" | "notFound" | "failed" | "unchanged" | "cancelled";

export interface JobTarget {
  id: string;
  artist: string;
  track: string;
  album: string;
  timestamp: number;
}

/** What an Edit makes of a Scrobble's current values, or null when Last.fm wouldn't change anything. */
export function editedValues(onSite: EditableValues, changes: FieldChange[]): EditableValues | null {
  const current: EditableValues = { artist: onSite.artist, track: onSite.track, album: onSite.album, albumArtist: onSite.albumArtist };
  const after = applyEdit(current, changes);
  const caseOnly = new Set(caseOnlyFields(current, after));
  const real = changedFields(current, after).filter((f) => !caseOnly.has(f));
  if (real.length === 0) return null;
  for (const f of caseOnly) after[f] = current[f];
  return after;
}
