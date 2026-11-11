import type { AccountLimits } from "./limits.ts";

/** The Worker's bindings, vars and secrets. Any var or secret may be missing from a misconfigured deployment. */
export interface Env {
  ASSETS: Fetcher;
  LIMITS: DurableObjectNamespace<AccountLimits>;
  LASTFM_API_KEY?: string;
  LASTFM_SHARED_SECRET?: string;
  SESSION_ENCRYPTION_KEY?: string;
  PUBLIC_BASE_URL?: string;
  EXTENSION_ID?: string;
}

export interface Config {
  lastFmApiKey: string;
  lastFmSharedSecret: string;
  sessionEncryptionKey: Uint8Array;
  /** The Web App's origin, without a trailing slash. */
  publicBaseUrl: string;
  extensionId: string;
}

const REQUIRED = ["LASTFM_API_KEY", "LASTFM_SHARED_SECRET", "SESSION_ENCRYPTION_KEY", "PUBLIC_BASE_URL", "EXTENSION_ID"] as const;
const SESSION_KEY_BYTES = 32;

export class ConfigError extends Error {}

export function readConfig(env: Env): Config {
  const missing = REQUIRED.filter((name) => !env[name]?.trim());
  if (missing.length > 0) throw new ConfigError(`Missing required configuration: ${missing.join(", ")}`);

  const sessionEncryptionKey = decodeBase64(env.SESSION_ENCRYPTION_KEY!);
  if (sessionEncryptionKey?.length !== SESSION_KEY_BYTES) {
    throw new ConfigError(`SESSION_ENCRYPTION_KEY must be ${SESSION_KEY_BYTES} random bytes, base64-encoded`);
  }
  return {
    lastFmApiKey: env.LASTFM_API_KEY!,
    lastFmSharedSecret: env.LASTFM_SHARED_SECRET!,
    sessionEncryptionKey,
    publicBaseUrl: env.PUBLIC_BASE_URL!.replace(/\/+$/, ""),
    extensionId: env.EXTENSION_ID!,
  };
}

function decodeBase64(value: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(value.trim()), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}
