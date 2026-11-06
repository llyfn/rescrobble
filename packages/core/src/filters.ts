export type TextField = "artist" | "track" | "album";
export type TextMode = "exact" | "contains" | "regex" | "empty";

export type Condition =
  | { kind: "text"; field: TextField; mode: TextMode; value: string; caseSensitive: boolean }
  /** Inclusive bounds in Unix seconds; null leaves that side open. */
  | { kind: "dateRange"; from: number | null; to: number | null }
  | { kind: "duplicates"; withinSeconds: number };

export interface FilterableScrobble {
  artist: string;
  track: string;
  album: string;
  timestamp: number;
}

/** Why a condition can't be applied, or null when it can. An invalid regex is the only such case. */
export function conditionError(condition: Condition): string | null {
  if (condition.kind !== "text" || condition.mode !== "regex") return null;
  try {
    new RegExp(condition.value, "u");
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

type TextCondition = Extract<Condition, { kind: "text" }>;

function regexOf(c: TextCondition): RegExp {
  return new RegExp(c.value, c.caseSensitive ? "u" : "iu");
}

/** Where a text condition matches inside `value`, as [start, end), or null when it marks nothing. */
export function matchedRange(condition: TextCondition, value: string): [number, number] | null {
  if (conditionError(condition)) return null;
  const haystack = condition.caseSensitive ? value : value.toLocaleLowerCase();
  const needle = condition.caseSensitive ? condition.value : condition.value.toLocaleLowerCase();
  switch (condition.mode) {
    case "empty":
      return null;
    case "exact":
      return haystack === needle ? [0, value.length] : null;
    case "contains": {
      if (!needle) return null;
      const at = haystack.indexOf(needle);
      return at < 0 ? null : [at, at + needle.length];
    }
    case "regex": {
      const match = regexOf(condition).exec(value);
      return match && match[0].length > 0 ? [match.index, match.index + match[0].length] : null;
    }
  }
}

function matchesText(c: TextCondition, value: string): boolean {
  if (c.mode === "empty") return value.trim() === "";
  if (c.mode === "regex") return regexOf(c).test(value);
  if (c.mode === "contains" && !c.value) return true;
  return matchedRange(c, value) !== null;
}

const sameTrack = (a: FilterableScrobble, b: FilterableScrobble) =>
  a.artist.toLocaleLowerCase() === b.artist.toLocaleLowerCase() && a.track.toLocaleLowerCase() === b.track.toLocaleLowerCase();

/**
 * Scrobbles that repeat the Scrobble just before them in time (same Track, at most `withinSeconds`
 * later). The first play of a run is never one of them.
 */
function duplicatesOf<T extends FilterableScrobble>(scrobbles: readonly T[], withinSeconds: number): Set<T> {
  const byTime = [...scrobbles].sort((a, b) => a.timestamp - b.timestamp);
  const repeats = new Set<T>();
  for (let i = 1; i < byTime.length; i++) {
    const previous = byTime[i - 1]!;
    const current = byTime[i]!;
    if (sameTrack(previous, current) && current.timestamp - previous.timestamp <= withinSeconds) repeats.add(current);
  }
  return repeats;
}

/** The Scrobbles meeting every condition, in their original order. An invalid condition matches nothing. */
export function applyFilter<T extends FilterableScrobble>(scrobbles: readonly T[], conditions: readonly Condition[]): T[] {
  if (conditions.some((c) => conditionError(c) !== null)) return [];
  const duplicateSets = conditions
    .filter((c): c is Extract<Condition, { kind: "duplicates" }> => c.kind === "duplicates")
    .map((c) => duplicatesOf(scrobbles, c.withinSeconds));
  return scrobbles.filter((s) =>
    conditions.every((c) => {
      if (c.kind === "text") return matchesText(c, s[c.field]);
      if (c.kind === "dateRange") return (c.from === null || s.timestamp >= c.from) && (c.to === null || s.timestamp <= c.to);
      return true;
    }) && duplicateSets.every((set) => set.has(s)),
  );
}
