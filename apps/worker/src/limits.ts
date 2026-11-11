import { DurableObject } from "cloudflare:workers";
import type { Env } from "./config.ts";

/** Roughly Last.fm's observed per-account daily scrobble limit; not documented by Last.fm. */
export const DAILY_SCROBBLES = 2800;
export const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const BURST_REQUESTS = 10;
export const BURST_WINDOW_MS = 10 * 1000;

export type Decision =
  | { allowed: true; reservation: number }
  | { allowed: false; reason: "tooManyRequests" | "dailyLimit"; retryAfterSeconds: number };

/**
 * One Last.fm account's limits. Each request is a row: when it came and how many Scrobbles it
 * reserved. The caller passes the time, so the counts don't depend on this object's clock.
 */
export class AccountLimits extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS requests (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, scrobbles INTEGER NOT NULL)");
  }

  tryAcquire(scrobbles: number, now: number): Decision {
    const sql = this.ctx.storage.sql;
    sql.exec("DELETE FROM requests WHERE at <= ?", now - DAILY_WINDOW_MS);

    const burst = sql.exec<{ at: number }>("SELECT at FROM requests WHERE at > ? ORDER BY at", now - BURST_WINDOW_MS).toArray();
    if (burst.length >= BURST_REQUESTS) {
      return { allowed: false, reason: "tooManyRequests", retryAfterSeconds: secondsUntil(burst[0]!.at + BURST_WINDOW_MS, now) };
    }

    const reserved = sql.exec<{ at: number; scrobbles: number }>("SELECT at, scrobbles FROM requests WHERE scrobbles > 0 ORDER BY at").toArray();
    const excess = reserved.reduce((n, r) => n + r.scrobbles, 0) + scrobbles - DAILY_SCROBBLES;
    if (excess > 0) {
      return { allowed: false, reason: "dailyLimit", retryAfterSeconds: dailyRetryAfter(reserved, excess, now) };
    }

    const { id } = sql.exec<{ id: number }>("INSERT INTO requests (at, scrobbles) VALUES (?, ?) RETURNING id", now, scrobbles).one();
    return { allowed: true, reservation: id };
  }

  /** Returns Scrobbles that never reached Last.fm to the allowance; the request still counts toward the burst. */
  refund(reservation: number): void {
    this.ctx.storage.sql.exec("UPDATE requests SET scrobbles = 0 WHERE id = ?", reservation);
  }
}

const secondsUntil = (at: number, now: number) => Math.ceil((at - now) / 1000);

/** When enough of the oldest reservations will have left the 24-hour window to fit `excess` more. */
function dailyRetryAfter(reserved: { at: number; scrobbles: number }[], excess: number, now: number): number {
  let freed = 0;
  for (const r of reserved) {
    freed += r.scrobbles;
    if (freed >= excess) return secondsUntil(r.at + DAILY_WINDOW_MS, now);
  }
  return secondsUntil(now + DAILY_WINDOW_MS, now);
}

/** The account's limits object, named by a hash of the session key so the key itself is never stored. */
export async function limitsFor(namespace: DurableObjectNamespace<AccountLimits>, sessionKey: string): Promise<DurableObjectStub<AccountLimits>> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sessionKey));
  const name = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return namespace.get(namespace.idFromName(name));
}
