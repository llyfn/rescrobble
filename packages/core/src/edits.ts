export type EditField = "artist" | "track" | "album" | "albumArtist";

export type FieldChange =
  | { field: EditField; kind: "set"; value: string }
  | { field: EditField; kind: "replace"; find: string; replaceWith: string; regex: boolean; caseSensitive: boolean };

export interface EditableValues {
  artist: string;
  track: string;
  album: string;
  albumArtist: string;
}

export const EDIT_FIELDS: readonly EditField[] = ["artist", "track", "album", "albumArtist"];

/** Why a change can't be applied, or null when it can. An invalid regex is the only such case. */
export function changeError(change: FieldChange): string | null {
  if (change.kind !== "replace" || !change.regex) return null;
  try {
    new RegExp(change.find, "gu");
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function applyChange(value: string, change: FieldChange): string {
  if (change.kind === "set") return change.value;
  if (!change.find) return value;
  const flags = change.caseSensitive ? "gu" : "giu";
  if (change.regex) return value.replace(new RegExp(change.find, flags), change.replaceWith);
  return value.replace(new RegExp(escapeRegex(change.find), flags), () => change.replaceWith);
}

/** The values after an Edit: each change applies to its field, in order. */
export function applyEdit(values: EditableValues, changes: readonly FieldChange[]): EditableValues {
  const next = { ...values };
  for (const change of changes) {
    if (changeError(change)) continue;
    next[change.field] = applyChange(next[change.field], change);
  }
  return next;
}

export function changedFields(before: EditableValues, after: EditableValues): EditField[] {
  return EDIT_FIELDS.filter((f) => before[f] !== after[f]);
}

/** Fields whose only difference is letter case, which Last.fm won't apply. */
export function caseOnlyFields(before: EditableValues, after: EditableValues): EditField[] {
  return changedFields(before, after).filter((f) => before[f].toLocaleLowerCase() === after[f].toLocaleLowerCase());
}

export interface Diff {
  prefix: string;
  removed: string;
  inserted: string;
  suffix: string;
}

/** The changed middle of a value, between the unchanged start and end. */
export function diffValues(before: string, after: string): Diff {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  return {
    prefix: before.slice(0, start),
    removed: before.slice(start, before.length - end),
    inserted: after.slice(start, after.length - end),
    suffix: before.slice(before.length - end),
  };
}
