import { useCallback, useEffect, useRef, useState } from "react";
import type { FieldChange } from "@rescrobble/core";
import type { WebsiteGateway } from "../website/gateway.ts";
import { JobStore, type JobEntry, type StoredJob } from "./jobStore.ts";
import type { JobTarget } from "./model.ts";
import { JobRunner } from "./runner.ts";

/**
 * The Extension's Jobs: at most one active at a time, every change saved. A Job that was running when
 * the app closed comes back as interrupted, for the user to resume or discard.
 */
export function useJobs(gateway: WebsiteGateway, user: string, onApplied: (job: StoredJob, entry: JobEntry) => void) {
  const [jobs, setJobs] = useState<StoredJob[]>([]);
  const [store, setStore] = useState<JobStore | null>(null);
  const runner = useRef<JobRunner | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const reported = useRef(new Set<string>());
  const writes = useRef(Promise.resolve());
  const applied = useRef(onApplied);
  useEffect(() => {
    applied.current = onApplied;
  });

  useEffect(() => {
    let live = true;
    let opened: JobStore | null = null;
    JobStore.open().then(async (s) => {
      opened = s;
      if (!live) return s.close();
      const stored = (await s.all()).filter((j) => j.user === user);
      for (const j of stored) for (const e of j.entries) if (e.status === "done") reported.current.add(`${j.id}\u0000${e.target.id}`);
      setStore(s);
      setJobs(stored);
    });
    return () => {
      live = false;
      runner.current?.detach();
      opened?.close();
    };
  }, [user]);

  const save = useCallback((job: StoredJob) => {
    for (const entry of job.entries) {
      const key = `${job.id}\u0000${entry.target.id}`;
      if (entry.status === "done" && !reported.current.has(key)) {
        reported.current.add(key);
        applied.current(job, entry);
      }
    }
    setJobs((current) => [job, ...current.filter((j) => j.id !== job.id)].sort((a, b) => b.createdAt - a.createdAt));
    writes.current = writes.current.then(() => store?.save(job)).catch(() => undefined);
  }, [store]);

  const run = useCallback((job: StoredJob) => {
    const r = new JobRunner(job, gateway, save);
    runner.current = r;
    setRunningId(job.id);
    void r.run().finally(() => {
      if (runner.current !== r) return;
      runner.current = null;
      setRunningId(null);
    });
  }, [gateway, save]);

  const active = jobs.find((j) => j.state === "running" || j.state === "paused") ?? null;

  return {
    jobs,
    ready: store !== null,
    active,
    /** An active Job that isn't running in this session: the app closed while it ran. */
    interrupted: active && active.id !== runningId ? active : null,
    start(kind: StoredJob["kind"], targets: JobTarget[], changes: FieldChange[]): string {
      const job: StoredJob = {
        id: crypto.randomUUID(),
        user,
        kind,
        changes,
        createdAt: Date.now(),
        entries: targets.map((target) => ({ target, status: "queued" })),
        state: "running",
        notice: null,
      };
      run(job);
      return job.id;
    },
    pause: () => runner.current?.pause(),
    resume() {
      if (runner.current) runner.current.resume();
      else if (active) run(active);
    },
    cancel() {
      if (runner.current) runner.current.cancel();
      else if (active) save({ ...active, state: "cancelled", notice: null, entries: active.entries.map((e) => (e.status === "queued" ? { ...e, status: "cancelled" } : e)) });
    },
  };
}

export type Jobs = ReturnType<typeof useJobs>;
