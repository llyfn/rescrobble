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
