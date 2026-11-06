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
  after?: EditableValues;
}

export interface StoredJob {
  id: string;
  user: string;
  kind: "delete" | "edit";
  changes: FieldChange[];
  createdAt: number;
  entries: JobEntry[];
  /** "running" survives in storage when the app closes mid-Job; on reopening that means interrupted. */
  state: "running" | "paused" | "finished" | "cancelled";
  notice: JobNotice | null;
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

  async all(): Promise<StoredJob[]> {
    const jobs: StoredJob[] = await request(this.db.transaction("jobs").objectStore("jobs").getAll());
    return jobs.sort((a, b) => b.createdAt - a.createdAt);
  }

  close() {
    this.db.close();
  }
}
