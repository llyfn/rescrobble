import { checkTimestamp } from "@rescrobble/core";
import type { Config } from "./config.ts";
import { errorResponse, isCookieRequestFromElsewhere, lastFmFailure, signedInUser } from "./http.ts";
import { MAX_BATCH, type LastFmClient, type ScrobbleOutcome, type ScrobbleSubmission } from "./lastfm.ts";
import type { SessionCodec } from "./session.ts";

type Rejected = { status: "rejected"; reason: "missingField"; field: "artist" | "track" | "timestamp" } | { status: "rejected"; reason: "tooOld" | "inFuture" };
type Checked = { valid: ScrobbleSubmission } | { invalid: Rejected };

const present = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

function validate(entry: Record<string, unknown>, nowSeconds: number): Checked {
  if (!present(entry.artist)) return { invalid: { status: "rejected", reason: "missingField", field: "artist" } };
  if (!present(entry.track)) return { invalid: { status: "rejected", reason: "missingField", field: "track" } };
  if (typeof entry.timestamp !== "number" || !Number.isInteger(entry.timestamp)) {
    return { invalid: { status: "rejected", reason: "missingField", field: "timestamp" } };
  }
  const check = checkTimestamp(entry.timestamp, nowSeconds);
  if (check !== "acceptable") return { invalid: { status: "rejected", reason: check } };
  const submission: ScrobbleSubmission = { artist: entry.artist, track: entry.track, timestamp: entry.timestamp };
  if (present(entry.album)) submission.album = entry.album;
  if (present(entry.albumArtist)) submission.albumArtist = entry.albumArtist;
  return { valid: submission };
}

export async function submitScrobbles(request: Request, config: Config, lastFm: LastFmClient, sessions: SessionCodec): Promise<Response> {
  if (isCookieRequestFromElsewhere(request, config)) return new Response(null, { status: 403 });
  const session = await signedInUser(request, sessions);
  if (!session) return new Response(null, { status: 401 });

  const body = await request.json().catch(() => null) as { scrobbles?: unknown } | null;
  const entries = body?.scrobbles;
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAX_BATCH) return errorResponse(400, "batchSize");

  const nowSeconds = Math.floor(Date.now() / 1000);
  const checked = entries.map((e) => validate(typeof e === "object" && e !== null ? e as Record<string, unknown> : {}, nowSeconds));
  const submissions = checked.flatMap((c) => ("valid" in c ? [c.valid] : []));

  let outcomes: ScrobbleOutcome[];
  try {
    outcomes = submissions.length === 0 ? [] : await lastFm.scrobble(session.sessionKey, submissions);
  } catch (e) {
    return lastFmFailure(e);
  }
  let next = 0;
  return Response.json({ results: checked.map((c) => ("valid" in c ? outcomes[next++]! : c.invalid)) });
}
