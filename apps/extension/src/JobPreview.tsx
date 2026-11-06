import { useId, useState, type ReactNode } from "react";
import { changeError, checkTimestamp, diffValues, EDIT_FIELDS, type EditableValues, type EditField, type FieldChange } from "@rescrobble/core";
import type { Scrobble } from "./mirror/db.ts";
import { editedValues, runJob, type JobKind, type TargetStatus } from "./jobs/runJob.ts";
import type { WebsiteGateway } from "./website/gateway.ts";
import { formatPlayedShort } from "./format.ts";
import { strings } from "./strings.ts";

const p = strings.preview;
const e = strings.edit;
const statusClass: Record<TargetStatus, string> = {
  queued: "rs-status--pending",
  done: "rs-status--accepted",
  notFound: "rs-status--ignored",
  failed: "rs-status--rejected",
  unchanged: "rs-status--pending",
};

/** What the Mirror knows of a Scrobble's values. The Mirror has no album artist; the website supplies it when the Job runs. */
const mirrorValues = (s: Scrobble): EditableValues => ({ artist: s.artist, track: s.track, album: s.album, albumArtist: "" });

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

/** The artist and album beneath a record, leaving out whichever the Edit already shows changing. */
function context(before: EditableValues, after: EditableValues | null): string {
  const parts = [
    !after || after.artist === before.artist ? before.artist : "",
    before.album && (!after || after.album === before.album) ? before.album : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

interface Props {
  kind: JobKind["kind"];
  targets: Scrobble[];
  gateway: WebsiteGateway;
  user: string;
  /** A Scrobble was deleted (no `after`) or edited (`after` holds its new values). */
  onApplied: (target: Scrobble, after?: EditableValues) => void;
  onClose: () => void;
}

type Phase = "preview" | "running" | "finished";

export function JobPreview({ kind, targets, gateway, user, onApplied, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("preview");
  const [statuses, setStatuses] = useState<ReadonlyMap<string, TargetStatus>>(new Map());
  const [stopped, setStopped] = useState<string | null>(null);
  const [changes, setChanges] = useState<FieldChange[]>([{ field: "track", kind: "replace", find: "", replaceWith: "", regex: false, caseSensitive: false }]);
  const [now] = useState(() => Math.floor(Date.now() / 1000));

  const editing = kind === "edit";
  const valid = changes.every((c) => !changeError(c));
  const rows = targets.map((t) => ({ target: t, after: editing && valid ? editedValues(mirrorValues(t), changes) : null }));
  const affected = editing ? rows.filter((r) => r.after) : rows;
  const unchanged = editing ? rows.length - affected.length : 0;
  const irreversible = new Set(kind === "delete" ? targets.filter((t) => checkTimestamp(t.timestamp, now) === "tooOld").map((t) => t.id) : []);
  const count = p.count(affected.length);
  const tally = (status: TargetStatus) => [...statuses.values()].filter((s) => s === status).length;
  const labels = editing ? e.status : p.status;

  async function confirm() {
    setPhase("running");
    const job: JobKind = editing ? { kind: "edit", changes } : { kind: "delete" };
    const byId = new Map(affected.map((r) => [r.target.id, r.target]));
    await runJob(gateway, user, affected.map((r) => r.target), job, {
      onStatus: (id, status, after) => {
        setStatuses((current) => new Map(current).set(id, status));
        if (status === "done") onApplied(byId.get(id)!, after);
      },
      onStopped: (reason) => setStopped(p.stopped[reason] ?? reason),
    });
    setPhase("finished");
  }

  const heading = editing ? e.heading(count) : p.deleteHeading(count);
  const running = phase === "running";
  const handled = statuses.size;

  return (
    <aside className="preview" aria-label={p.label}>
      <header>
        <h2 className="rs-num">{heading}</h2>
        {editing && phase === "preview" && (
          <div className="builder" role="group" aria-label={e.builderLabel}>
            {changes.map((c, i) => (
              <ChangeRow
                key={i}
                change={c}
                onChange={(next) => setChanges(changes.map((old, j) => (j === i ? next : old)))}
                onRemove={changes.length > 1 ? () => setChanges(changes.filter((_, j) => j !== i)) : undefined}
              />
            ))}
            <button type="button" className="rs-chip rs-chip--add" onClick={() => setChanges([...changes, { field: "album", kind: "set", value: "" }])}>
              <svg className="rs-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
              {e.addChange}
            </button>
          </div>
        )}
        {editing && phase === "preview" && unchanged > 0 && affected.length > 0 && <p className="rs-hint">{e.unchanged(unchanged)}</p>}
        {irreversible.size > 0 && phase === "preview" && (
          <div className="rs-notice rs-notice--danger">
            <svg className="rs-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5l6 11H2l6-11z" /><path d="M8 7v3M8 12h.01" /></svg>
            <span>{p.irreversible(irreversible.size, targets.length)}</span>
          </div>
        )}
        {phase !== "preview" && (
          <div className="rs-notice">
            <svg className="rs-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path d="M8 7.5v3.5M8 5h.01" /></svg>
            <span>{p.backgroundTab}</span>
          </div>
        )}
        {stopped && (
          <div className="rs-notice rs-notice--warn" role="alert">
            <svg className="rs-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5l6 11H2l6-11z" /><path d="M8 7v3M8 12h.01" /></svg>
            <span>{stopped}</span>
          </div>
        )}
      </header>
      {editing && affected.length === 0 && <p className="rs-hint empty-preview">{e.nothing}</p>}
      <ul className="records rs-num">
        {affected.map(({ target: t, after }) => {
          const status = statuses.get(t.id) ?? "queued";
          const applied = status === "done";
          const before = mirrorValues(t);
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
                  {irreversible.has(t.id) && status === "queued" && <span className="rs-label irreversible">{p.irreversibleTag}</span>}
                </span>
              </div>
              <span className={`rs-status ${statusClass[status]}`} hidden={phase === "preview"}>{labels[status]}</span>
            </li>
          );
        })}
      </ul>
      <footer>
        {phase === "finished" ? (
          <>
            <p className="rs-hint" role="status">
              {editing ? e.summary(tally("done"), tally("notFound"), tally("failed")) : p.summary(tally("done"), tally("notFound"), tally("failed"))}
            </p>
            <button type="button" className="rs-btn rs-btn--primary rs-btn--block" onClick={onClose}>{p.close}</button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={editing ? "rs-btn rs-btn--primary rs-btn--block" : "rs-btn rs-btn--danger rs-btn--block"}
              onClick={confirm}
              aria-busy={running || undefined}
              disabled={running || affected.length === 0}
            >
              {running ? (editing ? e.running(handled, affected.length) : p.deleting(handled, affected.length)) : editing ? e.confirm(count) : p.confirmDelete(count)}
            </button>
            {phase === "preview" && <button type="button" className="rs-btn rs-btn--quiet rs-btn--block" onClick={onClose}>{p.cancel}</button>}
          </>
        )}
      </footer>
    </aside>
  );
}
