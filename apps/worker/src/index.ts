import { ConfigError, readConfig, type Config, type Env } from "./config.ts";

type Handler = (request: Request, config: Config) => Promise<Response> | Response;

const routes: Record<string, Handler> = {
  "GET /health": () => new Response("ok"),
  "GET /api/config": (_request, config) =>
    Response.json({ lastFmApiKey: config.lastFmApiKey }, { headers: { "Cache-Control": "public, max-age=3600" } }),
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
    const handler = routes[`${request.method} ${path}`];
    if (handler) return handler(request, config);
    return isServerPath(path) ? new Response(null, { status: 404 }) : env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
