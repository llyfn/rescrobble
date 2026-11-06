import type { Api } from "./api.ts";

export interface ScrobbleEntry {
  artist: string;
  track: string;
  timestamp: number;
  album?: string;
  albumArtist?: string;
}

export type Outcome =
  | { status: "accepted"; artist: string; artistCorrected: boolean; track: string; trackCorrected: boolean }
  | { status: "ignored"; code: number; message: string }
  | { status: "rejected"; reason: string; field?: string };

export type SubmitResult =
  | { ok: true; outcomes: Outcome[] }
  | { ok: false; status: number; error?: string; retryAfterSeconds?: number };

/** Sends up to 50 entries; outcomes come back in the order sent. */
export async function submitScrobbles(api: Api, entries: ScrobbleEntry[]): Promise<SubmitResult> {
  let response: Response;
  try {
    response = await api("/api/scrobbles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scrobbles: entries }),
    });
  } catch {
    return { ok: false, status: 0 };
  }
  if (response.ok) {
    const body: { results: Outcome[] } = await response.json();
    return { ok: true, outcomes: body.results };
  }
  const body = await response.json().catch(() => ({})) as { error?: string };
  const retryAfter = Number(response.headers.get("Retry-After"));
  return {
    ok: false,
    status: response.status,
    error: body.error,
    retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
  };
}

export const MAX_BATCH = 50;

export type BatchResult =
  | { ok: true; entries: ScrobbleEntry[]; outcomes: Outcome[] }
  | { ok: false; entries: ScrobbleEntry[]; outcomes: Outcome[]; failure: Extract<SubmitResult, { ok: false }> };

/**
 * Sends entries in order, at most 50 per request, one request after another. Stops at the first
 * failed request; `entries` and `outcomes` then cover only the batches that went through.
 */
export async function submitInBatches(api: Api, entries: ScrobbleEntry[]): Promise<BatchResult> {
  const sent: ScrobbleEntry[] = [];
  const outcomes: Outcome[] = [];
  for (let i = 0; i < entries.length; i += MAX_BATCH) {
    const batch = entries.slice(i, i + MAX_BATCH);
    const result = await submitScrobbles(api, batch);
    if (!result.ok) return { ok: false, entries: sent, outcomes, failure: result };
    sent.push(...batch);
    outcomes.push(...result.outcomes);
  }
  return { ok: true, entries: sent, outcomes };
}
