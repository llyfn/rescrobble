import type { Config } from "./config.ts";
import type { SessionCodec, UserSession } from "./session.ts";

export const SESSION_COOKIE = "rescrobble_session";
/** Last.fm session keys don't expire, so the cookie lasts long enough to survive between visits. */
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

export const errorResponse = (status: number, error: string, headers?: HeadersInit) => Response.json({ error }, { status, headers });

export function sessionCookie(config: Config, value: string, maxAge = COOKIE_MAX_AGE): string {
  const secure = config.publicBaseUrl.startsWith("https://") ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly${secure}; SameSite=Lax`;
}

function cookieValue(request: Request, name: string): string | null {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

/**
 * The signed-in user from either the Extension's bearer token or the Web App's cookie.
 * A request that sends an Authorization header is judged by that header alone.
 */
export async function signedInUser(request: Request, sessions: SessionCodec): Promise<UserSession | null> {
  const authorization = request.headers.get("Authorization");
  if (authorization === null) {
    const cookie = cookieValue(request, SESSION_COOKIE);
    return cookie ? sessions.decode(cookie) : null;
  }
  const match = /^bearer\s+(\S+)\s*$/i.exec(authorization.trim());
  return match ? sessions.decode(match[1]!) : null;
}

/**
 * A cookie rides along on any request to this site, including ones another site triggers, so a
 * state-changing request authenticated by cookie must come from the Web App's own origin.
 * Bearer requests carry their credential explicitly and need no such check.
 */
export function isCookieRequestFromElsewhere(request: Request, config: Config): boolean {
  if (request.headers.get("Authorization") !== null) return false;
  const origin = request.headers.get("Origin");
  return origin === null || origin.toLowerCase() !== new URL(config.publicBaseUrl).origin;
}

/**
 * Only the Web App and the Extension may call the backend from a browser. Credentials are not
 * allowed cross-origin: the Web App is served from the same origin, and the Extension sends a bearer token.
 */
function allowedOrigin(request: Request, config: Config): string | null {
  const origin = request.headers.get("Origin");
  if (origin === null) return null;
  const allowed = [new URL(config.publicBaseUrl).origin, `chrome-extension://${config.extensionId}`];
  return allowed.includes(origin.toLowerCase()) ? origin : null;
}

export function preflight(request: Request, config: Config): Response {
  const origin = allowedOrigin(request, config);
  if (origin === null) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  });
}

export function withCors(request: Request, config: Config, response: Response): Response {
  const origin = allowedOrigin(request, config);
  if (origin === null) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.append("Vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
