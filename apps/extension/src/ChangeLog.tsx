import { useState } from "react";
import { checkTimestamp, type EditableValues } from "@rescrobble/core";
import { submitInBatches, type Api, type Outcome } from "@rescrobble/scrobble-ui";
import { JobProgress, Notice, Records, type Row } from "./JobPreview.tsx";
import type { JobEntry, StoredJob } from "./jobs/jobStore.ts";
import type { Jobs } from "./jobs/useJobs.ts";
import { scrobbleId, type Scrobble } from "./mirror/db.ts";
import { formatPlayed } from "./format.ts";
import { strings } from "./strings.ts";

const c = strings.changeLog;
const count = strings.preview.count;

const applied = (job: StoredJob) => job.entries.filter((e) => e.status === "done");

/** The Scrobble as it is on Last.fm after the change: an edited one carries its new values. */
function currentTarget(entry: JobEntry) {
  if (!entry.after) return entry.target;
  const moved = { ...entry.target, artist: entry.after.artist, track: entry.after.track, album: entry.after.album };
  return { ...moved, id: scrobbleId(moved) };
}

function heading(job: StoredJob): string {
  const n = count(applied(job).length);
  return job.kind === "delete" ? c.deleted(n) : job.kind === "restore" ? c.restored(n) : c.edited(n);
}

function rowsOf(job: StoredJob): Row[] {
  return applied(job).map((e) => ({ target: e.target, before: e.before, after: job.kind === "delete" ? null : e.after ?? null, status: "queued", irreversible: false }));
}

type Panel = { mode: "undoEdit"; job: StoredJob } | { mode: "undoDelete"; job: StoredJob } | { mode: "job"; id: string };

interface Props {
  jobs: Jobs;
  pro: boolean | null;
  api: Api;
  onRestored: (scrobbles: Scrobble[]) => void;
}

/** Every applied change, newest first, with Undo where Last.fm allows it. */
export function ChangeLog({ jobs, pro, api, onRestored }: Props) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const entries = jobs.jobs.filter((j) => (j.state === "finished" || j.state === "cancelled") && applied(j).length > 0);
  const shownJob = panel?.mode === "job" ? jobs.jobs.find((j) => j.id === panel.id) ?? null : null;

  function exportJson() {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `rescrobble-change-log-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <div className={panel ? "change-log with-preview" : "change-log"}>
      <div className="change-log-main">
        <div className="head">
          <h1>{c.heading}</h1>
          {entries.length > 0 && (
            <div className="tools">
              <button type="button" className="rs-btn" onClick={exportJson}>{c.export}</button>
              <button type="button" className="rs-btn rs-btn--quiet" onClick={() => setConfirmingClear(true)}>{c.clear}</button>
            </div>
          )}
        </div>
        {confirmingClear && (
          <div className="confirm-clear">
            <Notice tone="warn">
              {c.clearConfirm(entries.length)}
              <span className="actions">
                <button type="button" className="rs-btn rs-btn--danger" onClick={() => void jobs.clearHistory().then(() => setConfirmingClear(false))}>{c.clearYes}</button>
                <button type="button" className="rs-btn rs-btn--quiet" onClick={() => setConfirmingClear(false)}>{c.clearNo}</button>
              </span>
            </Notice>
          </div>
        )}
        {entries.length === 0 && <p className="rs-hint empty">{c.empty}</p>}
        {entries.map((job) => {
          const undoable = job.kind !== "restore" && !job.undone;
          const needsPro = job.kind === "edit" && pro === false;
          return (
            <section key={job.id} className="entry" aria-label={`${heading(job)}, ${formatPlayed(Math.floor(job.createdAt / 1000))}`}>
              <header>
                <h2 className="rs-num">{heading(job)}</h2>
                <time className="rs-hint rs-num">{formatPlayed(Math.floor(job.createdAt / 1000))}</time>
                {job.undone && <span className="rs-label">{c.undone}</span>}
                {undoable && (
                  <button
                    type="button"
                    className="rs-btn"
                    disabled={needsPro || panel !== null || jobs.active !== null}
                    title={needsPro ? c.undoNeedsPro : undefined}
                    onClick={() => setPanel({ mode: job.kind === "delete" ? "undoDelete" : "undoEdit", job })}
                  >
                    {c.undo}
                  </button>
                )}
              </header>
              {needsPro && undoable && <p className="rs-hint">{c.undoNeedsPro}</p>}
              <Records rows={rowsOf(job)} kind={job.kind} showStatus={false} />
            </section>
          );
        })}
      </div>
      {panel?.mode === "undoEdit" && (
        <UndoEdit
          job={panel.job}
          onConfirm={(targets) => setPanel({ mode: "job", id: jobs.start("restore", targets, [], panel.job.id) })}
          onClose={() => setPanel(null)}
        />
      )}
      {panel?.mode === "undoDelete" && (
        <UndoDelete
          job={panel.job}
          api={api}
          onRestored={(scrobbles) => {
            onRestored(scrobbles);
            jobs.markUndone(panel.job.id);
          }}
          onClose={() => setPanel(null)}
        />
      )}
      {shownJob && <JobProgress job={shownJob} jobs={jobs} onClose={() => setPanel(null)} />}
    </div>
  );
}

/** Undoing an Edit: each Scrobble goes back to the exact values it had on Last.fm before. */
function UndoEdit({ job, onConfirm, onClose }: {
  job: StoredJob;
  onConfirm: (targets: { target: ReturnType<typeof currentTarget>; restoreTo: EditableValues }[]) => void;
  onClose: () => void;
}) {
  const done = applied(job).filter((e) => e.before && e.after);
  const rows: Row[] = done.map((e) => ({ target: currentTarget(e), before: e.after, after: e.before!, status: "queued", irreversible: false }));
  const n = count(done.length);
  return (
    <aside className="preview" aria-label={strings.preview.label}>
      <header><h2 className="rs-num">{c.undoEditHeading(n)}</h2></header>
      <Records rows={rows} kind="restore" showStatus={false} />
      <footer>
        <button type="button" className="rs-btn rs-btn--primary rs-btn--block" onClick={() => onConfirm(done.map((e) => ({ target: currentTarget(e), restoreTo: e.before! })))}>
          {c.undoEditConfirm(n)}
        </button>
        <button type="button" className="rs-btn rs-btn--quiet rs-btn--block" onClick={onClose}>{strings.preview.cancel}</button>
      </footer>
    </aside>
  );
}

/** Undoing a Delete: Scrobbles Last.fm still accepts are scrobbled again with their original times. */
function UndoDelete({ job, api, onRestored, onClose }: { job: StoredJob; api: Api; onRestored: (s: Scrobble[]) => void; onClose: () => void }) {
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  const [phase, setPhase] = useState<"preview" | "running" | "finished">("preview");
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, string>>(new Map());
  const done = applied(job);
  const restorable = done.filter((e) => checkTimestamp(e.target.timestamp, now) === "acceptable");
  const irreversible = done.length - restorable.length;
  const n = count(restorable.length);

  async function confirm() {
    setPhase("running");
    const entries = restorable.map((e) => ({ artist: e.target.artist, track: e.target.track, timestamp: e.target.timestamp, ...(e.target.album ? { album: e.target.album } : {}) }));
    const result = await submitInBatches(api, entries);
    const statusOf = (o: Outcome | undefined) => (o ? o.status : "rejected");
    const next = new Map<string, string>();
    restorable.forEach((e, i) => next.set(e.target.id, i < result.outcomes.length ? statusOf(result.outcomes[i]) : "rejected"));
    setOutcomes(next);
    onRestored(restorable.filter((e) => next.get(e.target.id) === "accepted").map((e) => e.target as Scrobble));
    setPhase("finished");
  }

  const rows: Row[] = done.map((e) => ({ target: e.target, after: null, status: "queued", irreversible: !restorable.includes(e) }));
  const restored = [...outcomes.values()].filter((o) => o === "accepted").length;
  return (
    <aside className="preview" aria-label={strings.preview.label}>
      <header>
        <h2 className="rs-num">{c.undoDeleteHeading(count(done.length))}</h2>
        {irreversible > 0 && restorable.length > 0 && <Notice tone="danger">{c.undoDeleteIrreversible(irreversible)}</Notice>}
        {restorable.length === 0 && <Notice tone="danger">{c.undoDeleteNone}</Notice>}
      </header>
      <ul className="records rs-num">
        {rows.map((r) => (
          <li key={r.target.id}>
            <div className="rs-edit">
              <span className="rs-edit__meta">{formatPlayed(r.target.timestamp)}</span>
              <span className="rs-edit__values">
                <span className="track">{r.target.track}</span>
                <span className="secondary">{r.target.artist}</span>
              </span>
            </div>
            <span className="rs-hint">{r.irreversible ? c.outcome.irreversible : outcomes.has(r.target.id) ? c.outcome[outcomes.get(r.target.id)!] : ""}</span>
          </li>
        ))}
      </ul>
      <footer>
        {phase === "finished" ? (
          <>
            <p className="rs-hint" role="status">{c.undoDeleteSummary(restored, restorable.length - restored)}</p>
            <button type="button" className="rs-btn rs-btn--primary rs-btn--block" onClick={onClose}>{strings.preview.close}</button>
          </>
        ) : (
          <>
            <button type="button" className="rs-btn rs-btn--primary rs-btn--block" disabled={restorable.length === 0 || phase === "running"} aria-busy={phase === "running" || undefined} onClick={confirm}>
              {phase === "running" ? c.resubmitting : c.undoDeleteConfirm(n)}
            </button>
            <button type="button" className="rs-btn rs-btn--quiet rs-btn--block" onClick={onClose}>{strings.preview.cancel}</button>
          </>
        )}
      </footer>
    </aside>
  );
}
