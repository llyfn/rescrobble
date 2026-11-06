import { useId, useState, type ReactNode } from "react";
import { changeError, checkTimestamp, diffValues, EDIT_FIELDS, type EditableValues, type EditField, type FieldChange } from "@rescrobble/core";
import type { Scrobble } from "./mirror/db.ts";
import type { JobNotice, StoredJob } from "./jobs/jobStore.ts";
import { editedValues, type JobTarget, type TargetStatus } from "./jobs/model.ts";
import { jobTiming } from "./jobs/runner.ts";
import type { Jobs } from "./jobs/useJobs.ts";
import { formatPlayedShort } from "./format.ts";
import { strings } from "./strings.ts";

const p = strings.preview;
const e = strings.edit;
const j = strings.job;
const statusClass: Record<TargetStatus, string> = {
  queued: "rs-status--pending",
  done: "rs-status--accepted",
  notFound: "rs-status--ignored",
  failed: "rs-status--rejected",
  unchanged: "rs-status--pending",
  cancelled: "rs-status--pending",
};

/** What the Mirror knows of a Scrobble's values. The Mirror has no album artist; the website supplies it when the Job runs. */
export const mirrorValues = (s: JobTarget): EditableValues => ({ artist: s.artist, track: s.track, album: s.album, albumArtist: "" });

const clock = (millis: number) => new Date(millis).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/**
 * A value's change as a fragment diff when text was only removed or only inserted, or when most of the
 * value stays; otherwise the old value over the new one.
 */
function ValueDiff({ before, after }: { before: string; after: string }) {
  const d = diffValues(before, after);
  const kept = d.prefix.length + d.suffix.length;
  const oneSided = before !== "" && (d.removed === "" || d.inserted === "");
  if (oneSided || kept >= Math.max(d.removed.length, d.inserted.length)) {
    return (
      <span>
        {d.prefix}
        {d.removed && <del>{d.removed}</del>}
        {d.inserted && <ins>{d.inserted}</ins>}
        {d.suffix}
      </span>
    );
  }
  return (
    <>
      {before && <del>{before}</del>}
      <ins>{after}</ins>
    </>
  );
}

/** The artist and album beneath a record, leaving out whichever the Edit already shows changing. */
function context(before: EditableValues, after: EditableValues | null): string {
  return [
    !after || after.artist === before.artist ? before.artist : "",
    before.album && (!after || after.album === before.album) ? before.album : "",
  ].filter(Boolean).join(" · ");
}

export function Notice({ tone, children }: { tone?: "warn" | "danger"; children: ReactNode }) {
  return (
    <div className={tone ? `rs-notice rs-notice--${tone}` : "rs-notice"} role={tone === "warn" ? "alert" : undefined}>
      <svg className="rs-icon" viewBox="0 0 16 16" aria-hidden="true">
        {tone ? <><path d="M8 2.5l6 11H2l6-11z" /><path d="M8 7v3M8 12h.01" /></> : <><circle cx="8" cy="8" r="6" /><path d="M8 7.5v3.5M8 5h.01" /></>}
      </svg>
      <span>{children}</span>
    </div>
  );
}

export interface Row {
  target: JobTarget;
  /** The values shown as "before"; the Mirror's values when absent. */
  before?: EditableValues;
  after: EditableValues | null;
  status: TargetStatus;
  irreversible: boolean;
}

export function Records({ rows, kind, showStatus }: { rows: Row[]; kind: StoredJob["kind"]; showStatus: boolean }) {
  const labels = kind === "delete" ? p.status : e.status;
  return (
    <ul className="records rs-num">
      {rows.map(({ target: t, before: given, after, status, irreversible }) => {
        const applied = status === "done";
        const before = given ?? mirrorValues(t);
        return (
          <li key={t.id} data-status={status}>
            <div className={applied ? "rs-edit rs-edit--applied" : "rs-edit"}>
              <span className="rs-edit__meta">{formatPlayedShort(t.timestamp)}</span>
              <span className="rs-edit__values">
                {after ? (
                  EDIT_FIELDS.filter((f) => before[f] !== after[f]).map((f) => (
                    <span key={f} className="field-change">
                      {f !== "track" && <span className="rs-label">{e.fields[f]}</span>}
                      <ValueDiff before={before[f]} after={after[f]} />
                    </span>
                  ))
                ) : applied ? <del>{t.track}</del> : <span className="track">{t.track}</span>}
                <span className="secondary">{context(before, after)}</span>
                {irreversible && status === "queued" && <span className="rs-label irreversible">{p.irreversibleTag}</span>}
              </span>
            </div>
            <span className={`rs-status ${statusClass[status]}`} hidden={!showStatus}>{labels[status]}</span>
          </li>
        );
      })}
    </ul>
  );
}

function ChangeRow({ change, onChange, onRemove }: { change: FieldChange; onChange: (c: FieldChange) => void; onRemove?: () => void }) {
  const id = useId();
  const error = changeError(change);
  const field = (key: string, label: string, control: ReactNode) => (
    <div className="rs-field">
      <label className="rs-label" htmlFor={`${id}-${key}`}>{label}</label>
      {control}
    </div>
  );
  return (
    <fieldset className="change">
      {field("field", e.field, (
        <select id={`${id}-field`} className="rs-select" value={change.field} onChange={(ev) => onChange({ ...change, field: ev.target.value as EditField })}>
          {EDIT_FIELDS.map((f) => <option key={f} value={f}>{e.fields[f]}</option>)}
        </select>
      ))}
      {field("kind", e.kind, (
        <select
          id={`${id}-kind`}
          className="rs-select"
          value={change.kind}
          onChange={(ev) => onChange(ev.target.value === "set"
            ? { field: change.field, kind: "set", value: "" }
            : { field: change.field, kind: "replace", find: "", replaceWith: "", regex: false, caseSensitive: false })}
        >
          <option value="set">{e.kinds.set}</option>
          <option value="replace">{e.kinds.replace}</option>
        </select>
      ))}
      {change.kind === "set" && field("value", e.value, (
        <input id={`${id}-value`} className="rs-input" value={change.value} onChange={(ev) => onChange({ ...change, value: ev.target.value })} />
      ))}
      {change.kind === "replace" && (
        <>
          {field("find", e.find, <input id={`${id}-find`} className="rs-input" value={change.find} onChange={(ev) => onChange({ ...change, find: ev.target.value })} />)}
          {field("with", e.replaceWith, <input id={`${id}-with`} className="rs-input" value={change.replaceWith} onChange={(ev) => onChange({ ...change, replaceWith: ev.target.value })} />)}
          <label className="check"><input className="rs-check" type="checkbox" checked={change.regex} onChange={(ev) => onChange({ ...change, regex: ev.target.checked })} />{e.regex}</label>
          <label className="check"><input className="rs-check" type="checkbox" checked={change.caseSensitive} onChange={(ev) => onChange({ ...change, caseSensitive: ev.target.checked })} />{e.caseSensitive}</label>
        </>
      )}
      {onRemove && (
        <button type="button" className="rs-btn rs-btn--quiet remove" aria-label={e.removeChange} onClick={onRemove}>
          <svg className="rs-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      )}
      {error && <span className="rs-hint rs-hint--error" role="alert">{e.invalid(error)}</span>}
    </fieldset>
  );
}

const ESTIMATE_ABOVE = 500;

/** Minutes for a Job: one request per Scrobble plus one page read per Track, about a second each. */
function estimateMinutes(targets: JobTarget[]): number {
  const tracks = new Set(targets.map((t) => `${t.artist.toLocaleLowerCase()}\u0000${t.track.toLocaleLowerCase()}`)).size;
  return Math.ceil(((targets.length + tracks) * jobTiming.requestSpacingMs) / 60_000);
}

interface BuilderProps {
  kind: StoredJob["kind"];
  targets: Scrobble[];
  busy: boolean;
  onConfirm: (targets: JobTarget[], changes: FieldChange[]) => void;
  onClose: () => void;
}

/** Describing a change and previewing exactly which Scrobbles it touches, before anything is sent. */
export function JobBuilder({ kind, targets, busy, onConfirm, onClose }: BuilderProps) {
  const [changes, setChanges] = useState<FieldChange[]>([{ field: "track", kind: "replace", find: "", replaceWith: "", regex: false, caseSensitive: false }]);
  const [now] = useState(() => Math.floor(Date.now() / 1000));

  const editing = kind === "edit";
  const valid = changes.every((c) => !changeError(c));
  const rows: Row[] = targets.map((target) => ({
    target,
    after: editing && valid ? editedValues(mirrorValues(target), changes) : null,
    status: "queued",
    irreversible: !editing && checkTimestamp(target.timestamp, now) === "tooOld",
  }));
  const affected = editing ? rows.filter((r) => r.after) : rows;
  const unchanged = rows.length - affected.length;
  const irreversible = affected.filter((r) => r.irreversible).length;
  const count = p.count(affected.length);

  return (
    <aside className="preview" aria-label={p.label}>
      <header>
        <h2 className="rs-num">{editing ? e.heading(count) : p.deleteHeading(count)}</h2>
        {editing && (
          <div className="builder" role="group" aria-label={e.builderLabel}>
            {changes.map((c, i) => (
              <ChangeRow
                key={i}
                change={c}
                onChange={(next) => setChanges(changes.map((old, k) => (k === i ? next : old)))}
                onRemove={changes.length > 1 ? () => setChanges(changes.filter((_, k) => k !== i)) : undefined}
              />
            ))}
            <button type="button" className="rs-chip rs-chip--add" onClick={() => setChanges([...changes, { field: "album", kind: "set", value: "" }])}>
              <svg className="rs-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
              {e.addChange}
            </button>
          </div>
        )}
        {editing && unchanged > 0 && affected.length > 0 && <p className="rs-hint">{e.unchanged(unchanged)}</p>}
        {irreversible > 0 && <Notice tone="danger">{p.irreversible(irreversible, affected.length)}</Notice>}
        {affected.length > ESTIMATE_ABOVE && <p className="rs-hint">{p.estimate(estimateMinutes(affected.map((r) => r.target)))}</p>}
        {busy && <Notice tone="warn">{j.busy}</Notice>}
      </header>
      {editing && affected.length === 0 && <p className="rs-hint empty-preview">{e.nothing}</p>}
      <Records rows={affected} kind={kind} showStatus={false} />
      <footer>
        <button
          type="button"
          className={editing ? "rs-btn rs-btn--primary rs-btn--block" : "rs-btn rs-btn--danger rs-btn--block"}
          onClick={() => onConfirm(affected.map((r) => r.target), editing ? changes : [])}
          disabled={busy || affected.length === 0}
        >
          {editing ? e.confirm(count) : p.confirmDelete(count)}
        </button>
        <button type="button" className="rs-btn rs-btn--quiet rs-btn--block" onClick={onClose}>{p.cancel}</button>
      </footer>
    </aside>
  );
}

function noticeText(notice: JobNotice): { tone: "warn" | undefined; text: string } {
  switch (notice.kind) {
    case "paused": return { tone: undefined, text: j.paused };
    case "backoff": return { tone: undefined, text: j.backoff(clock(notice.until)) };
    case "blocked": return { tone: "warn", text: j.blocked(clock(notice.until)) };
    case "failures": return { tone: "warn", text: j.failures };
    case "loggedOut": return { tone: "warn", text: j.loggedOut };
    case "editUnavailable": return { tone: "warn", text: j.editUnavailable };
  }
}

/** A Job running, paused or done: each record resolving in place, with the controls to steer it. */
export function JobProgress({ job, jobs, onClose }: { job: StoredJob; jobs: Jobs; onClose: () => void }) {
  const editing = job.kind !== "delete";
  const count = p.count(job.entries.length);
  const heading = job.kind === "restore" ? strings.changeLog.undoEditHeading(count) : editing ? e.heading(count) : p.deleteHeading(count);
  const tally = (status: TargetStatus) => job.entries.filter((x) => x.status === status).length;
  const handled = job.entries.filter((x) => x.status !== "queued").length;
  const summary = editing ? e.summary(tally("done"), tally("notFound"), tally("failed")) : p.summary(tally("done"), tally("notFound"), tally("failed"));
  const live = job.state === "running" || job.state === "paused";
  const notice = job.notice && noticeText(job.notice);
  const rows: Row[] = job.entries.map((x) => ({
    target: x.target,
    before: x.before,
    after: editing ? (x.after ?? x.restoreTo ?? editedValues(mirrorValues(x.target), job.changes)) : null,
    status: x.status,
    irreversible: false,
  }));

  return (
    <aside className="preview" aria-label={p.label}>
      <header>
        <h2 className="rs-num">{heading}</h2>
        {live && <Notice>{p.backgroundTab}</Notice>}
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      </header>
      <Records rows={rows} kind={job.kind} showStatus />
      <footer>
        {live ? (
          <>
            <p className="rs-hint rs-num" role="status">{editing ? e.running(handled, job.entries.length) : p.deleting(handled, job.entries.length)}</p>
            <div className="controls">
              {job.state === "paused"
                ? <button type="button" className="rs-btn rs-btn--primary" onClick={jobs.resume}>{j.resume}</button>
                : <button type="button" className="rs-btn" onClick={jobs.pause}>{j.pause}</button>}
              <button type="button" className="rs-btn rs-btn--quiet" onClick={jobs.cancel}>{j.cancel}</button>
            </div>
          </>
        ) : (
          <>
            <p className="rs-hint" role="status">{job.state === "cancelled" ? j.cancelled(summary) : summary}</p>
            <button type="button" className="rs-btn rs-btn--primary rs-btn--block" onClick={onClose}>{p.close}</button>
          </>
        )}
      </footer>
    </aside>
  );
}
