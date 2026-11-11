import { lastFmFailure, signedInUser } from "./http.ts";
import { INVALID_SESSION, LastFmApiError, type LastFmClient } from "./lastfm.ts";
import type { SessionCodec } from "./session.ts";

export async function me(request: Request, lastFm: LastFmClient, sessions: SessionCodec): Promise<Response> {
  const session = await signedInUser(request, sessions);
  if (!session) return new Response(null, { status: 401 });
  let pro: boolean | null;
  try {
    pro = (await lastFm.getAuthenticatedUser(session.sessionKey)).pro;
  } catch (e) {
    // Only a revoked session ends sign-in; an outage still lets the user see who they are.
    if (e instanceof LastFmApiError && e.code === INVALID_SESSION) return lastFmFailure(e);
    pro = null;
  }
  return Response.json({ username: session.username, pro });
}
