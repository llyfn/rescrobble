import type { EditableValues, FieldChange } from "@rescrobble/core";
import type { JobTarget, TargetStatus } from "./model.ts";

export type JobNotice =
  | { kind: "backoff"; until: number }
  | { kind: "blocked"; until: number }
  | { kind: "failures" }
  | { kind: "loggedOut" }
  | { kind: "editUnavailable" }
  | { kind: "paused" };

export interface JobEntry {
  target: JobTarget;
  status: TargetStatus;
  /** For a restore Job: the values to put back. */
  restoreTo?: EditableValues;
  /** The exact values on Last.fm before an edit, read from the website, album artist included. */
  before?: EditableValues;
  after?: EditableValues;
}

export interface StoredJob {
  id: string;
  user: string;
  /** "restore" puts each Scrobble back to its own saved values: undoing an Edit. */
  kind: "delete" | "edit" | "restore";
  changes: FieldChange[];
  createdAt: number;
  entries: JobEntry[];
  /** "running" survives in storage when the app closes mid-Job; on reopening that means interrupted. */
  state: "running" | "paused" | "finished" | "cancelled";
  notice: JobNotice | null;
  /** Set once the Job's changes have been undone, so they can't be undone twice. */
  undone?: boolean;
  /** For a restore Job: the Edit it undoes. */
  undoOf?: string;
}

const DB_NAME = "rescrobble-jobs";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Jobs, each saved whole after every change, so an interrupted Job resumes from exactly where it was. */
export class JobStore {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(): Promise<JobStore> {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("jobs", { keyPath: "id" });
    return new JobStore(await request(req));
  }

  async save(job: StoredJob): Promise<void> {
    await request(this.db.transaction("jobs", "readwrite").objectStore("jobs").put(job));
  }

  async remove(ids: string[]): Promise<void> {
    const tx = this.db.transaction("jobs", "readwrite");
    for (const id of ids) tx.objectStore("jobs").delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async all(): Promise<StoredJob[]> {
    const jobs: StoredJob[] = await request(this.db.transaction("jobs").objectStore("jobs").getAll());
    return jobs.sort((a, b) => b.createdAt - a.createdAt);
  }

  close() {
    this.db.close();
  }
}
