import type { Failure, Result, SiteScrobble, WebsiteGateway } from "../website/gateway.ts";
import type { EditableValues } from "@rescrobble/core";
import type { JobEntry, JobNotice, StoredJob } from "./jobStore.ts";
import { editedValues, type JobTarget } from "./model.ts";

/** Pacing and patience for website requests. Tests replace `sleep` to observe waits without waiting. */
export const jobTiming = {
  requestSpacingMs: 1000,
  backoffStartMs: 10_000,
  backoffMaxMs: 60_000,
  blockedPauseMs: 10 * 60_000,
  maxConsecutiveFailures: 5,
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

const fieldsOf = (s: EditableValues): EditableValues => ({ artist: s.artist, track: s.track, album: s.album, albumArtist: s.albumArtist });

/** The values a restore puts back, or null when the Scrobble already has them. */
function restoredValues(onSite: EditableValues, restoreTo: EditableValues): EditableValues | null {
  const current = fieldsOf(onSite);
  return JSON.stringify(current) === JSON.stringify(fieldsOf(restoreTo)) ? null : fieldsOf(restoreTo);
}

class Cancelled extends Error {}
class Detached extends Error {}

const lower = (s: string) => s.toLocaleLowerCase();
const sameTrack = (a: { artist: string; track: string }, b: { artist: string; track: string }) =>
  lower(a.artist) === lower(b.artist) && lower(a.track) === lower(b.track);

/**
 * Runs one Job through the website, one request at a time. It slows down when Last.fm asks, waits out
 * a block, pauses for the user when it can't go on, and saves every change so it can resume later.
 */
export class JobRunner {
  private pausedByUser = false;
  private cancelled = false;
  private wake: (() => void) | null = null;
  private failures = 0;
  private backoff = jobTiming.backoffStartMs;
  private sentAny = false;
  private detached = false;

  constructor(
    private job: StoredJob,
    private readonly gateway: WebsiteGateway,
    private readonly save: (job: StoredJob) => void,
  ) {}

  get snapshot(): StoredJob {
    return this.job;
  }

  pause() {
    this.pausedByUser = true;
    this.update({ state: "paused", notice: { kind: "paused" } });
  }

  resume() {
    this.pausedByUser = false;
    this.update({ state: "running", notice: null });
    this.wake?.();
  }

  cancel() {
    this.cancelled = true;
    this.wake?.();
  }

  /** Stops quietly, leaving the saved Job as it is, for when the app closes mid-Job. */
  detach() {
    this.detached = true;
    this.wake?.();
  }

  async run(): Promise<void> {
    this.update({ state: "running", notice: null });
    try {
      await this.work();
      this.update({ state: "finished", notice: this.job.notice?.kind === "editUnavailable" ? this.job.notice : null });
    } catch (e) {
      if (e instanceof Detached) return;
      if (!(e instanceof Cancelled)) throw e;
      this.update({
        state: "cancelled",
        notice: null,
        entries: this.job.entries.map((e) => (e.status === "queued" ? { ...e, status: "cancelled" } : e)),
      });
    }
  }

  private update(change: Partial<StoredJob>) {
    if (this.detached) throw new Detached();
    this.job = { ...this.job, ...change };
    this.save(this.job);
  }

  private settle(id: string, status: JobEntry["status"], values?: { before: EditableValues; after: EditableValues }) {
    this.update({ entries: this.job.entries.map((e) => (e.target.id === id ? { ...e, status, ...values } : e)) });
  }

  private async waitUntilResumed(notice: JobNotice) {
    this.update({ state: "paused", notice });
    while (this.job.state === "paused" && !this.cancelled && !this.detached) {
      await new Promise<void>((resolve) => (this.wake = resolve));
    }
    this.wake = null;
    if (this.detached) throw new Detached();
    if (this.cancelled) throw new Cancelled();
  }

  private async checkpoint() {
    if (this.detached) throw new Detached();
    if (this.cancelled) throw new Cancelled();
    if (this.pausedByUser) await this.waitUntilResumed({ kind: "paused" });
  }

  /** Sends one request, retrying through slow-downs, blocks and pauses until it gets an answer to act on. */
  private async attempt<T extends object>(call: () => Promise<Result<T>>): Promise<Result<T>> {
    for (;;) {
      await this.checkpoint();
      if (this.sentAny) await jobTiming.sleep(jobTiming.requestSpacingMs);
      await this.checkpoint();
      this.sentAny = true;
      const result = await call();
      if (result.ok || result.reason === "notFound" || result.reason === "editUnavailable") {
        if (result.ok) {
          this.failures = 0;
          this.backoff = jobTiming.backoffStartMs;
        }
        return result;
      }
      if (result.reason === "loggedOut") {
        await this.waitUntilResumed({ kind: "loggedOut" });
        continue;
      }
      if (result.reason === "blocked") {
        this.update({ notice: { kind: "blocked", until: Date.now() + jobTiming.blockedPauseMs } });
        await jobTiming.sleep(jobTiming.blockedPauseMs);
        this.update({ notice: null });
        continue;
      }
      this.failures++;
      if (this.failures >= jobTiming.maxConsecutiveFailures) {
        await this.waitUntilResumed({ kind: "failures" });
        this.failures = 0;
        this.backoff = jobTiming.backoffStartMs;
        continue;
      }
      if (result.reason === "unexpected") return result;
      this.update({ notice: { kind: "backoff", until: Date.now() + this.backoff } });
      await jobTiming.sleep(this.backoff);
      this.backoff = Math.min(this.backoff * 2, jobTiming.backoffMaxMs);
      this.update({ notice: null });
    }
  }

  private groups(): JobTarget[][] {
    const groups = new Map<string, JobTarget[]>();
    for (const e of this.job.entries) {
      if (e.status !== "queued") continue;
      const key = `${lower(e.target.artist)}\u0000${lower(e.target.track)}`;
      groups.set(key, [...(groups.get(key) ?? []), e.target]);
    }
    return [...groups.values()];
  }

  private async work() {
    for (const group of this.groups()) {
      const listed = await this.attempt(() => this.gateway.listTrack(this.job.user, group[0]!.artist, group[0]!.track));
      if (!listed.ok) {
        if (listed.reason === "editUnavailable") return this.update({ notice: { kind: "editUnavailable" } });
        for (const t of group) this.settle(t.id, listed.reason === "notFound" ? "notFound" : "failed");
        continue;
      }
      if (this.job.kind === "edit" && !listed.canEdit) return this.update({ notice: { kind: "editUnavailable" } });

      const found: { target: JobTarget; onSite: SiteScrobble }[] = [];
      for (const target of group) {
        const onSite = listed.scrobbles.find((s) => s.timestamp === target.timestamp && sameTrack(s, target));
        if (onSite) found.push({ target, onSite });
        else this.settle(target.id, "notFound");
      }

      if (this.job.kind === "delete") {
        for (const { target, onSite } of found) {
          const result = await this.attempt(() => this.gateway.deleteScrobble(this.job.user, onSite));
          this.settleResult(target.id, result);
        }
        continue;
      }

      const restoreTo = new Map(this.job.entries.map((e) => [e.target.id, e.restoreTo]));
      const edits = found.flatMap(({ target, onSite }) => {
        const after = this.job.kind === "restore" ? restoredValues(onSite, restoreTo.get(target.id)!) : editedValues(onSite, this.job.changes);
        if (!after) this.settle(target.id, "unchanged");
        return after ? [{ target, onSite, after }] : [];
      });
      const same = (a: typeof edits[number]) => (b: typeof edits[number]) =>
        JSON.stringify([a.onSite.artist, a.onSite.track, a.onSite.album, a.onSite.albumArtist, a.after]) ===
        JSON.stringify([b.onSite.artist, b.onSite.track, b.onSite.album, b.onSite.albumArtist, b.after]);
      if (this.job.kind === "edit" && edits.length > 1 && edits.length === listed.scrobbles.length && edits.every(same(edits[0]!))) {
        const result = await this.attempt(() => this.gateway.editScrobble(this.job.user, edits[0]!.onSite, edits[0]!.after, true));
        for (const e of edits) this.settleResult(e.target.id, result, { before: fieldsOf(e.onSite), after: e.after });
        if (!result.ok && result.reason === "editUnavailable") return this.update({ notice: { kind: "editUnavailable" } });
        continue;
      }
      for (const { target, onSite, after } of edits) {
        const result = await this.attempt(() => this.gateway.editScrobble(this.job.user, onSite, after, false));
        if (!result.ok && result.reason === "editUnavailable") return this.update({ notice: { kind: "editUnavailable" } });
        this.settleResult(target.id, result, { before: fieldsOf(onSite), after });
      }
    }
  }

  private settleResult(id: string, result: Result | Failure, values?: { before: EditableValues; after: EditableValues }) {
    if (result.ok) this.settle(id, "done", values);
    else this.settle(id, result.reason === "notFound" ? "notFound" : "failed");
  }
}
