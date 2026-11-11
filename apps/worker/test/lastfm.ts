import { setupNetwork } from "@msw/cloudflare";
import { http, HttpResponse, type JsonBodyType } from "msw";

const API_URL = "https://ws.audioscrobbler.com/2.0/";

/**
 * Answers any Last.fm call a test didn't script with a 501, so unexpected calls surface as errors,
 * and fails any other outbound request, so no test can reach the real network.
 */
export const network = setupNetwork();
network.configure({
  handlers: [http.all(API_URL, () => new HttpResponse(null, { status: 501 }))],
  onUnhandledFrame: "error",
});

export interface LastFmRequest {
  method: string;
  url: string;
  form: URLSearchParams;
}

/** A scripted Last.fm that records every request it receives. */
export function lastFm(reply: (method: string, form: URLSearchParams) => Response): LastFmRequest[] {
  const requests: LastFmRequest[] = [];
  network.use(http.all(API_URL, async ({ request }) => {
    const form = new URLSearchParams(await request.text());
    requests.push({ method: request.method, url: request.url, form });
    return reply(form.get("method") ?? "", form);
  }));
  return requests;
}

export const lastFmJson = (body: JsonBodyType, status = 200) => HttpResponse.json(body, { status }) as Response;
export const lastFmError = (code: number, message: string) => lastFmJson({ error: code, message }, 403);
export const lastFmDown = () => new HttpResponse("<html>bad gateway</html>", { status: 502 }) as Response;

export const sessionJson = (username: string, sessionKey: string) => ({ session: { name: username, key: sessionKey, subscriber: 0 } });
export const userInfoJson = (name: string, subscriber = "0") => ({ user: { name, realname: "", subscriber, playcount: "1234", type: "user" } });
