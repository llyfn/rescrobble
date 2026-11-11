import { callback, exchange, login, logout } from "./auth.ts";
import { ConfigError, readConfig, type Config, type Env } from "./config.ts";
import { preflight, withCors } from "./http.ts";
import { LastFmClient } from "./lastfm.ts";
import { me } from "./me.ts";
import { submitScrobbles } from "./scrobbles.ts";
import { SessionCodec } from "./session.ts";

export { AccountLimits } from "./limits.ts";

interface Services {
  env: Env;
  config: Config;
  lastFm: LastFmClient;
  sessions: SessionCodec;
}

type Handler = (request: Request, services: Services) => Promise<Response> | Response;

const routes: Record<string, Handler> = {
  "GET /health": () => new Response("ok"),
  "GET /api/config": (_request, { config }) =>
    Response.json({ lastFmApiKey: config.lastFmApiKey }, { headers: { "Cache-Control": "public, max-age=3600" } }),
  "GET /api/me": (request, { lastFm, sessions }) => me(request, lastFm, sessions),
  "POST /api/scrobbles": (request, { env, config, lastFm, sessions }) => submitScrobbles(request, config, lastFm, sessions, env.LIMITS),
  "GET /auth/login": (_request, { config }) => login(config),
  "GET /auth/callback": (request, { config, lastFm, sessions }) => callback(request, config, lastFm, sessions),
  "POST /auth/session": (request, { lastFm, sessions }) => exchange(request, lastFm, sessions),
  "POST /auth/logout": (request, { config }) => logout(request, config),
};

/** Paths the Worker owns; everything else is the Web App. Matches `run_worker_first` in the Wrangler config. */
function isServerPath(path: string): boolean {
  return path === "/health" || /^\/(api|auth)(\/|$)/.test(path);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let config: Config;
    try {
      config = readConfig(env);
    } catch (e) {
      if (!(e instanceof ConfigError)) throw e;
      console.error(e.message);
      return new Response(e.message, { status: 500 });
    }
    const path = new URL(request.url).pathname;
    if (!isServerPath(path)) return env.ASSETS.fetch(request);
    if (request.method === "OPTIONS") return preflight(request, config);

    const handler = routes[`${request.method} ${path}`];
    const services = {
      env,
      config,
      lastFm: new LastFmClient(config.lastFmApiKey, config.lastFmSharedSecret),
      sessions: new SessionCodec(config.sessionEncryptionKey),
    };
    return withCors(request, config, handler ? await handler(request, services) : new Response(null, { status: 404 }));
  },
} satisfies ExportedHandler<Env>;
