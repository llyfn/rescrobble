import type { RecentScrobble } from "@rescrobble/core";

export interface Scrobble extends RecentScrobble {
  /** Timestamp, artist and track together: one recorded play. */
  id: string;
}

export interface SyncState {
  username: string;
  /** The first sync pages back from `to`, which is fixed so new plays can't shift its pages. */
  full: { to: number; nextPage: number; totalPages: number | null; total: number | null; done: boolean };
  /** Everything newer than this is fetched by an incremental sync. */
  newestSynced: number;
  lastSyncedAt: number | null;
}

export function scrobbleId(s: RecentScrobble): string {
  return `${s.timestamp}\u0000${s.artist}\u0000${s.track}`;
}

const DB_NAME = "rescrobble-mirror";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** The Mirror's IndexedDB: Scrobbles keyed by id, and the sync state. */
export class MirrorDb {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(): Promise<MirrorDb> {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("scrobbles", { keyPath: "id" }).createIndex("timestamp", "timestamp");
      db.createObjectStore("meta");
    };
    return new MirrorDb(await request(req));
  }

  async all(): Promise<Scrobble[]> {
    return request(this.db.transaction("scrobbles").objectStore("scrobbles").getAll());
  }

  /** Stores Scrobbles and the sync state in one transaction, so a page is never half-recorded. */
  async putPage(scrobbles: Scrobble[], state: SyncState): Promise<void> {
    const tx = this.db.transaction(["scrobbles", "meta"], "readwrite");
    const store = tx.objectStore("scrobbles");
    for (const s of scrobbles) store.put(s);
    tx.objectStore("meta").put(state, "sync");
    await done(tx);
  }

  async state(): Promise<SyncState | null> {
    return (await request(this.db.transaction("meta").objectStore("meta").get("sync"))) ?? null;
  }

  async putState(state: SyncState): Promise<void> {
    const tx = this.db.transaction("meta", "readwrite");
    tx.objectStore("meta").put(state, "sync");
    await done(tx);
  }

  async clear(): Promise<void> {
    const tx = this.db.transaction(["scrobbles", "meta"], "readwrite");
    tx.objectStore("scrobbles").clear();
    tx.objectStore("meta").clear();
    await done(tx);
  }

  close() {
    this.db.close();
  }
}
