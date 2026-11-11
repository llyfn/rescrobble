import { SELF } from "cloudflare:test";

export const WEB_APP = "https://rescrobble.test";
export const EXTENSION = "chrome-extension://testextensionid";
export const SESSION_COOKIE = "rescrobble_session";
/** A different 32-byte key than the test configuration's. */
export const OTHER_SESSION_KEY = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8=";

/** A browser on the Web App's own pages: redirects stay visible, and requests carry the Web App's origin. */
export function browser(origin: string | null = WEB_APP) {
  const send = (method: string, path: string, init: { headers?: Record<string, string>; body?: unknown } = {}) => {
    const headers = new Headers(init.headers);
    if (origin !== null) headers.set("Origin", origin);
    let body: string | undefined;
    if (init.body !== undefined) {
      body = typeof init.body === "string" ? init.body : JSON.stringify(init.body);
      headers.set("Content-Type", "application/json");
    }
    return SELF.fetch(`${WEB_APP}${path}`, { method, headers, body, redirect: "manual" });
  };
  return {
    get: (path: string, init?: { headers?: Record<string, string> }) => send("GET", path, init),
    post: (path: string, init?: { headers?: Record<string, string>; body?: unknown }) => send("POST", path, init),
    options: (path: string, init?: { headers?: Record<string, string> }) => send("OPTIONS", path, init),
  };
}

export interface SetCookie {
  name: string;
  value: string;
  attributes: Map<string, string>;
}

export function sessionCookieOf(response: Response): SetCookie | null {
  for (const header of response.headers.getSetCookie()) {
    const [pair, ...attributes] = header.split(";").map((s) => s.trim());
    const [name, ...value] = pair!.split("=");
    if (name !== SESSION_COOKIE) continue;
    return {
      name,
      value: value.join("="),
      attributes: new Map(attributes.map((a) => {
        const [key, ...rest] = a.split("=");
        return [key!.toLowerCase(), rest.join("=")];
      })),
    };
  }
  return null;
}

/** Signs in through the Web App's callback and returns the Cookie header to send. */
export async function signInWithCookie(): Promise<string> {
  const cookie = sessionCookieOf(await browser().get("/auth/callback?token=approval"))!;
  return `${cookie.name}=${cookie.value}`;
}

/** Signs in as the Extension does and returns the Authorization header to send. */
export async function signInWithBearer(token = "approval"): Promise<string> {
  const body = await (await browser(EXTENSION).post("/auth/session", { body: { token } })).json() as { token: string };
  return `Bearer ${body.token}`;
}
