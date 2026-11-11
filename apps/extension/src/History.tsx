import { useEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from "react";
import { applyFilter, matchedRange, type Condition, type TextField } from "@rescrobble/core";
import { JobBuilder, JobProgress } from "./JobPreview.tsx";
import type { Jobs } from "./jobs/useJobs.ts";
import { FilterBar } from "./FilterBar.tsx";
import type { Scrobble } from "./mirror/db.ts";
import type { MirrorStore } from "./mirror/store.ts";
import { useMirror } from "./mirror/useMirror.ts";
import { formatAgo, formatCount, formatDate, formatPlayed } from "./format.ts";
import { strings } from "./strings.ts";

type Column = "played" | "artist" | "track" | "album";
type Sort = { column: Column; descending: boolean };

const h = strings.history;
const ROW_HEIGHT = 32;
/** Rows drawn beyond the visible ones, and the count drawn when the viewport size is unknown. */
const OVERSCAN = 20;
const UNMEASURED_ROWS = 60;

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
const compare: Record<Column, (a: Scrobble, b: Scrobble) => number> = {
  played: (a, b) => a.timestamp - b.timestamp,
  artist: (a, b) => collator.compare(a.artist, b.artist) || a.timestamp - b.timestamp,
  track: (a, b) => collator.compare(a.track, b.track) || a.timestamp - b.timestamp,
  album: (a, b) => collator.compare(a.album, b.album) || a.timestamp - b.timestamp,
};

/** The value with the part a text condition matched marked, so the user sees why the row matched. */
function marked(value: string, condition: Extract<Condition, { kind: "text" }> | undefined): ReactNode {
  const range = condition && matchedRange(condition, value);
  if (!range) return value;
  return (
    <>
      {value.slice(0, range[0])}
      <mark className="match">{value.slice(range[0], range[1])}</mark>
      {value.slice(range[1])}
    </>
  );
}

function SelectAll({ label, total, selected, onToggle }: { label: string; total: number; selected: number; onToggle: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = selected > 0 && selected < total;
  }, [selected, total]);
  return <input ref={ref} className="rs-check" type="checkbox" aria-label={label} checked={selected > 0 && selected === total} onChange={onToggle} />;
}

interface HistoryProps {
  store: MirrorStore;
  onSyncNow: () => void;
  jobs: Jobs;
  pro: boolean | null;
  hidden: boolean;
}

type Panel = { mode: "build"; kind: "delete" | "edit"; targets: Scrobble[] } | { mode: "job"; id: string };

export function History({ store, onSyncNow, jobs, pro, hidden }: HistoryProps) {
  const mirror = useMirror(store);
  const [sort, setSort] = useState<Sort>({ column: "played", descending: true });
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [panel, setPanel] = useState<Panel | null>(null);
  const shownJob = panel?.mode === "job" ? jobs.jobs.find((j) => j.id === panel.id) ?? null : null;
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);

  const rows = useMemo(() => {
    const list = [...mirror.scrobbles.values()];
    const by = compare[sort.column];
    return list.sort(sort.descending ? (a, b) => by(b, a) : by);
  }, [mirror.scrobbles, sort]);

  const filtering = conditions.length > 0;
  const matches = useMemo(() => (filtering ? applyFilter(rows, conditions) : rows), [rows, conditions, filtering]);
  const selectedCount = matches.reduce((n, s) => n + (selected.has(s.id) ? 1 : 0), 0);
  const markFor = useMemo(() => {
    const byField: Partial<Record<TextField, Extract<Condition, { kind: "text" }>>> = {};
    for (const c of conditions) if (c.kind === "text" && c.mode !== "empty" && !byField[c.field]) byField[c.field] = c;
    return byField;
  }, [conditions]);

  function changeConditions(next: Condition[]) {
    setConditions(next);
    // A row the new Filter hides is unchecked, so Edit and Delete only ever touch rows on screen.
    const shown = next.length > 0 ? applyFilter(rows, next) : rows;
    setSelected((current) => (current.size === 0 ? current : new Set(shown.filter((s) => current.has(s.id)).map((s) => s.id))));
  }

  function toggleRow(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(selectedCount === matches.length ? new Set() : new Set(matches.map((s) => s.id)));
  }

  const oldest = useMemo(() => {
    let min = Infinity;
    for (const s of mirror.scrobbles.values()) min = Math.min(min, s.timestamp);
    return Number.isFinite(min) ? min : null;
  }, [mirror.scrobbles]);

  const visible = viewport > 0 ? Math.ceil(viewport / ROW_HEIGHT) + OVERSCAN : UNMEASURED_ROWS;
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN / 2);
  const last = Math.min(matches.length, first + visible);

  function onScroll(event: UIEvent<HTMLDivElement>) {
    setScrollTop(event.currentTarget.scrollTop);
    setViewport(event.currentTarget.clientHeight);
  }

  function sortBy(column: Column) {
    setSort((s) => ({ column, descending: s.column === column ? !s.descending : column === "played" }));
  }

  const status = (() => {
    if (mirror.phase === "waiting") return h.waiting;
    if (mirror.phase === "failed") return h.failed;
    if (mirror.phase === "syncing") return h.syncing(formatCount(rows.length), mirror.firstSyncTotal ? formatCount(mirror.firstSyncTotal) : null);
    return mirror.lastSyncedAt ? h.synced(formatAgo(mirror.lastSyncedAt)) : h.neverSynced;
  })();

  const header = (column: Column, className?: string) => (
    <th className={className} aria-sort={sort.column === column ? (sort.descending ? "descending" : "ascending") : "none"}>
      <button type="button" onClick={() => sortBy(column)}>
        {h.columns[column]}
        {sort.column === column && (
          <svg className="sort-arrow" viewBox="0 0 10 10" aria-hidden="true">
            <path d={sort.descending ? "M5 1.5v7M2 5.5l3 3 3-3" : "M5 8.5v-7M2 4.5l3-3 3 3"} />
          </svg>
        )}
      </button>
    </th>
  );

  const selection = () => matches.filter((s) => selected.has(s.id));

  return (
    <div className={panel ? "history with-preview" : "history"} hidden={hidden}>
      <div className="history-main">
        <div className="head">
          <h1>{h.heading}</h1>
          <dl className="rs-facts">
            <div><dt>{h.scrobbles}</dt><dd>{formatCount(rows.length)}</dd></div>
            {oldest !== null && <div><dt>{h.since}</dt><dd>{formatDate(oldest)}</dd></div>}
            {filtering && <div><dt>{h.matching}</dt><dd>{formatCount(matches.length)}</dd></div>}
            {selectedCount > 0 && <div><dt>{h.selected}</dt><dd>{formatCount(selectedCount)}</dd></div>}
          </dl>
          <div className="sync">
            <span className="rs-hint rs-num" role="status">{status}</span>
            <button type="button" className="rs-btn" onClick={onSyncNow} disabled={mirror.phase === "syncing" || mirror.phase === "waiting"}>
              {h.syncNow}
            </button>
          </div>
        </div>
        <FilterBar conditions={conditions} onChange={changeConditions} />
        {jobs.interrupted && !panel && (
          <div className="interrupted rs-notice rs-notice--warn" role="alert">
            <svg className="rs-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5l6 11H2l6-11z" /><path d="M8 7v3M8 12h.01" /></svg>
            <span>
              {strings.job.interrupted(strings.job.kinds[jobs.interrupted.kind], strings.preview.count(jobs.interrupted.entries.length))}
              <span className="actions">
                <button type="button" className="rs-btn rs-btn--primary" onClick={() => {
                  setPanel({ mode: "job", id: jobs.interrupted!.id });
                  jobs.resume();
                }}>{strings.job.resume}</button>
                <button type="button" className="rs-btn rs-btn--quiet" onClick={jobs.cancel}>{strings.job.discard}</button>
              </span>
            </span>
          </div>
        )}
        {selectedCount > 0 && !panel && (
          <div className="selection-actions" role="toolbar" aria-label={strings.actions.label}>
            <button type="button" className="rs-btn" onClick={() => setPanel({ mode: "build", kind: "edit", targets: selection() })} disabled={pro === false}>
              {strings.actions.edit(strings.preview.count(selectedCount))}
            </button>
            <button type="button" className="rs-btn" onClick={() => setPanel({ mode: "build", kind: "delete", targets: selection() })}>
              {strings.actions.delete(strings.preview.count(selectedCount))}
            </button>
            {pro === false && <span className="rs-hint">{strings.actions.needsPro}</span>}
          </div>
        )}
        {rows.length === 0 && mirror.phase !== "idle" && <p className="first-sync rs-hint">{h.firstSync}</p>}
        {filtering && matches.length === 0 && (
          <div className="rs-empty"><b>{h.noMatches}</b>{h.noMatchesHint}</div>
        )}
        <div className="scroll" onScroll={onScroll} hidden={filtering && matches.length === 0}>
          <table className="rs-table" aria-label={h.table} aria-rowcount={matches.length + 1}>
            <thead>
              <tr>
                <th className="rs-col-check">
                  <SelectAll label={filtering ? h.selectAllMatching : h.selectAll} total={matches.length} selected={selectedCount} onToggle={toggleAll} />
                </th>
                {header("played", "rs-col-time")}
                {header("artist", "col-artist")}
                {header("track")}
                {header("album", "col-album")}
              </tr>
            </thead>
            <tbody>
              {first > 0 && <tr aria-hidden="true" style={{ height: first * ROW_HEIGHT }} />}
              {matches.slice(first, last).map((s, i) => {
                const checked = selected.has(s.id);
                return (
                  <tr key={s.id} aria-rowindex={first + i + 2} aria-selected={checked}>
                    <td className="rs-col-check">
                      <input className="rs-check" type="checkbox" checked={checked} aria-label={h.selectRow(`${s.artist} — ${s.track}, ${formatPlayed(s.timestamp)}`)} onChange={() => toggleRow(s.id)} />
                    </td>
                    <td className="rs-col-time"><time dateTime={new Date(s.timestamp * 1000).toISOString()}>{formatPlayed(s.timestamp)}</time></td>
                    <td>{marked(s.artist, markFor.artist)}</td>
                    <td>{marked(s.track, markFor.track)}</td>
                    <td>{marked(s.album, markFor.album)}</td>
                  </tr>
                );
              })}
              {last < matches.length && <tr aria-hidden="true" style={{ height: (matches.length - last) * ROW_HEIGHT }} />}
            </tbody>
          </table>
        </div>
      </div>
      {panel?.mode === "build" && (
        <JobBuilder
          kind={panel.kind}
          targets={panel.targets}
          busy={jobs.active !== null}
          onConfirm={(targets, changes) => setPanel({ mode: "job", id: jobs.start(panel.kind, targets, changes) })}
          onClose={() => setPanel(null)}
        />
      )}
      {shownJob && (
        <JobProgress
          job={shownJob}
          jobs={jobs}
          onClose={() => {
            setPanel(null);
            setSelected(new Set());
          }}
        />
      )}
    </div>
  );
}