import { LastFmError, type LastFmReader, type RecentTracksPage } from "@rescrobble/core";
import { scrobbleId, type MirrorDb, type Scrobble, type SyncState } from "./db.ts";
import type { MirrorStore } from "./store.ts";

/** About one request per second, and a growing pause when Last.fm asks us to slow down. */
export const syncTiming = {
  pageDelayMs: 1000,
  retryDelaysMs: [5_000, 10_000, 20_000, 40_000, 60_000],
};

/** Last.fm API errors that mean "try again later": rate limit, service offline, temporary error. */
const RETRYABLE = new Set([8, 11, 16, 29]);

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Copies a user's Last.fm history into the Mirror: new plays first, then the rest of the first sync. */
export class MirrorSync {
  private running: Promise<void> | null = null;
  private controller = new AbortController();

  constructor(
    private readonly db: MirrorDb,
    private readonly store: MirrorStore,
    private readonly reader: LastFmReader,
    private readonly username: string,
  ) {}

  /** Loads what's stored, then syncs. Calling it while a sync runs joins that sync. */
  start(): Promise<void> {
    this.running ??= this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  async rebuild(): Promise<void> {
    this.stop();
    await this.running?.catch(() => undefined);
    this.controller = new AbortController();
    await this.db.clear();
    this.store.update({ replaceAll: [], firstSyncTotal: null, lastSyncedAt: null });
    return this.start();
  }

  stop() {
    this.controller.abort();
  }

  private async run() {
    const signal = this.controller.signal;
    try {
      let state = await this.db.state();
      if (!state || state.username !== this.username) {
        await this.db.clear();
        const now = nowSeconds();
        state = { username: this.username, full: { to: now, nextPage: 1, totalPages: null, total: null, done: false }, newestSynced: now, lastSyncedAt: null };
        await this.db.putState(state);
      }
      this.store.update({
        replaceAll: await this.db.all(),
        lastSyncedAt: state.lastSyncedAt,
        firstSyncTotal: state.full.done ? null : state.full.total,
        phase: "syncing",
      });

      state = await this.syncNewer(state, signal);
      state = await this.syncFirst(state, signal);

      state = { ...state, lastSyncedAt: Date.now() };
      await this.db.putState(state);
      this.store.update({ phase: "idle", lastSyncedAt: state.lastSyncedAt, firstSyncTotal: null });
    } catch (e) {
      if (!signal.aborted) this.store.update({ phase: "failed" });
      if (!(e instanceof Error) || !signal.aborted) throw e;
    }
  }

  private async syncNewer(state: SyncState, signal: AbortSignal): Promise<SyncState> {
    const from = state.newestSynced + 1;
    let newest = state.newestSynced;
    for (let page = 1; ; page++) {
      const result = await this.fetch(() => this.reader.getRecentTracks(this.username, { page, from, signal }), signal);
      const scrobbles = result.scrobbles.map((s) => ({ ...s, id: scrobbleId(s) }));
      newest = Math.max(newest, ...scrobbles.map((s) => s.timestamp));
      state = { ...state, newestSynced: page >= result.totalPages ? newest : state.newestSynced };
      await this.save(scrobbles, state);
      if (page >= result.totalPages) return state;
      await sleep(syncTiming.pageDelayMs, signal);
    }
  }

  private async syncFirst(state: SyncState, signal: AbortSignal): Promise<SyncState> {
    while (!state.full.done) {
      await sleep(syncTiming.pageDelayMs, signal);
      const { full } = state;
      const result = await this.fetch(() => this.reader.getRecentTracks(this.username, { page: full.nextPage, to: full.to, signal }), signal);
      const done = full.nextPage >= result.totalPages;
      state = { ...state, full: { ...full, nextPage: full.nextPage + 1, totalPages: result.totalPages, total: result.total, done } };
      await this.save(result.scrobbles.map((s) => ({ ...s, id: scrobbleId(s) })), state);
      this.store.update({ firstSyncTotal: done ? null : result.total });
    }
    return state;
  }

  private async save(scrobbles: Scrobble[], state: SyncState) {
    await this.db.putPage(scrobbles, state);
    this.store.update({ add: scrobbles });
  }

  /** Retries Last.fm's "try again later" answers and network failures with a growing pause. */
  private async fetch(call: () => Promise<RecentTracksPage>, signal: AbortSignal): Promise<RecentTracksPage> {
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await call();
        if (attempt > 0) this.store.update({ phase: "syncing" });
        return result;
      } catch (e) {
        if (signal.aborted) throw e;
        const retryable = !(e instanceof LastFmError) || (e.code !== undefined && RETRYABLE.has(e.code));
        if (!retryable) throw e;
        this.store.update({ phase: "waiting" });
        await sleep(syncTiming.retryDelaysMs[Math.min(attempt, syncTiming.retryDelaysMs.length - 1)]!, signal);
      }
    }
  }
}
