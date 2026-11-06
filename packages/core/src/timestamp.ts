/** Last.fm silently ignores Scrobbles older than this. Observed behaviour, not documented. */
export const SCROBBLE_WINDOW_SECONDS = 14 * 24 * 60 * 60;

export type TimestampCheck = "acceptable" | "tooOld" | "inFuture";

/** Classifies a Scrobble's Unix-seconds timestamp against the current time. */
export function checkTimestamp(timestamp: number, nowSeconds: number): TimestampCheck {
  if (timestamp > nowSeconds) return "inFuture";
  if (timestamp < nowSeconds - SCROBBLE_WINDOW_SECONDS) return "tooOld";
  return "acceptable";
}
