import type { Config } from "./config.ts";
import { errorResponse, isCookieRequestFromElsewhere, sessionCookie } from "./http.ts";
import { AUTH_URL, LastFmApiError, type LastFmClient } from "./lastfm.ts";
import type { SessionCodec } from "./session.ts";

export const SIGN_IN_FAILED_PATH = "/?signIn=failed";
/** Last.fm's codes for an invalid, unauthorized, or expired approval token. */
const INVALID_TOKEN_CODES = new Set([4, 14, 15]);

const redirect = (location: string, headers: Record<string, string> = {}) =>
  new Response(null, { status: 302, headers: { Location: location, ...headers } });

export function login(config: Config): Response {
  const approval = new URL(AUTH_URL);
  approval.searchParams.set("api_key", config.lastFmApiKey);
  approval.searchParams.set("cb", `${config.publicBaseUrl}/auth/callback`);
  return redirect(approval.toString());
}

export async function callback(request: Request, config: Config, lastFm: LastFmClient, sessions: SessionCodec): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token");
  if (!token?.trim()) return redirect(SIGN_IN_FAILED_PATH);
  try {
    const session = await lastFm.getSession(token);
    return redirect("/", { "Set-Cookie": sessionCookie(config, await sessions.encode(session)) });
  } catch {
    return redirect(SIGN_IN_FAILED_PATH);
  }
}

export async function exchange(request: Request, lastFm: LastFmClient, sessions: SessionCodec): Promise<Response> {
  const body = await request.json().catch(() => null) as { token?: unknown } | null;
  if (typeof body?.token !== "string" || !body.token) return errorResponse(400, "missingToken");
  try {
    const session = await lastFm.getSession(body.token);
    return Response.json({ username: session.username, token: await sessions.encode(session) });
  } catch (e) {
    if (e instanceof LastFmApiError && INVALID_TOKEN_CODES.has(e.code)) return errorResponse(401, "invalidToken");
    return errorResponse(503, "lastFmUnavailable");
  }
}

export function logout(request: Request, config: Config): Response {
  if (isCookieRequestFromElsewhere(request, config)) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: { "Set-Cookie": sessionCookie(config, "", 0) } });
}
