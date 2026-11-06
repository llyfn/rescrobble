import type { SubmitResult } from "./scrobbles.ts";
import { strings } from "./strings.ts";

const f = strings.failure;

/** The message for a failed submission. A 401 has none: the app has already returned to signed out. */
export function describeFailure(result: Extract<SubmitResult, { ok: false }>): string | null {
  if (result.status === 401) return null;
  if (result.status === 503) return f.unavailable;
  if (result.status === 429 && result.error === "dailyLimit") {
    const seconds = result.retryAfterSeconds ?? 3600;
    return seconds >= 3600 ? f.dailyLimitHours(Math.round(seconds / 3600)) : f.dailyLimitMinutes(Math.max(1, Math.ceil(seconds / 60)));
  }
  if (result.status === 429) return f.tooManyRequests(result.retryAfterSeconds ?? 10);
  return f.generic;
}
