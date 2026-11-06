import type { Scrobble } from "./db.ts";

export type SyncPhase = "idle" | "syncing" | "waiting" | "failed";

export interface MirrorSnapshot {
  /** Bumped on every change, so derived views know when to recompute. */
  version: number;
  scrobbles: ReadonlyMap<string, Scrobble>;
  phase: SyncPhase;
  /** Total Scrobbles Last.fm reports while the first sync is running; null once it has finished. */
  firstSyncTotal: number | null;
  lastSyncedAt: number | null;
}

/** The Mirror in memory, for the UI. The sync engine writes it; components subscribe. */
export class MirrorStore {
  private snapshot: MirrorSnapshot = { version: 0, scrobbles: new Map(), phase: "idle", firstSyncTotal: null, lastSyncedAt: null };
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  update(change: Partial<Omit<MirrorSnapshot, "version" | "scrobbles">> & { add?: Scrobble[]; replaceAll?: Scrobble[] }) {
    const { add, replaceAll, ...rest } = change;
    let scrobbles = this.snapshot.scrobbles;
    if (replaceAll) scrobbles = new Map(replaceAll.map((s) => [s.id, s]));
    if (add?.length) {
      const next = new Map(scrobbles);
      for (const s of add) next.set(s.id, s);
      scrobbles = next;
    }
    this.snapshot = { ...this.snapshot, ...rest, scrobbles, version: this.snapshot.version + 1 };
    this.listeners.forEach((l) => l());
  }
}
