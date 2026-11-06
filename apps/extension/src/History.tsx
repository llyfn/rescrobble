import { useEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from "react";
import { applyFilter, matchedRange, type Condition, type TextField } from "@rescrobble/core";
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

function SelectAll({ total, selected, onToggle }: { total: number; selected: number; onToggle: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = selected > 0 && selected < total;
  }, [selected, total]);
  return <input ref={ref} className="rs-check" type="checkbox" aria-label={h.selectAll} checked={selected > 0 && selected === total} onChange={onToggle} />;
}

export function History({ store, onSyncNow }: { store: MirrorStore; onSyncNow: () => void }) {
  const mirror = useMirror(store);
  const [sort, setSort] = useState<Sort>({ column: "played", descending: true });
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [deselected, setDeselected] = useState<ReadonlySet<string>>(new Set());
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);

  const rows = useMemo(() => {
    const list = [...mirror.scrobbles.values()];
    const by = compare[sort.column];
    return list.sort(sort.descending ? (a, b) => by(b, a) : by);
  }, [mirror.scrobbles, sort]);

  const filtering = conditions.length > 0;
  const matches = useMemo(() => (filtering ? applyFilter(rows, conditions) : rows), [rows, conditions, filtering]);
  const selectedCount = filtering ? matches.reduce((n, s) => n + (deselected.has(s.id) ? 0 : 1), 0) : 0;
  const markFor = useMemo(() => {
    const byField: Partial<Record<TextField, Extract<Condition, { kind: "text" }>>> = {};
    for (const c of conditions) if (c.kind === "text" && c.mode !== "empty" && !byField[c.field]) byField[c.field] = c;
    return byField;
  }, [conditions]);

  function changeConditions(next: Condition[]) {
    setConditions(next);
    setDeselected(new Set());
  }

  function toggleRow(id: string) {
    setDeselected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setDeselected(selectedCount === matches.length ? new Set(matches.map((s) => s.id)) : new Set());
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
      <button type="button" onClick={() => sortBy(column)}>{h.columns[column]}</button>
    </th>
  );

  return (
    <div className="history">
      <div className="head">
        <h1>{h.heading}</h1>
        <dl className="rs-facts">
          <div><dt>{h.scrobbles}</dt><dd>{formatCount(rows.length)}</dd></div>
          {oldest !== null && <div><dt>{h.since}</dt><dd>{formatDate(oldest)}</dd></div>}
          {filtering && <div><dt>{h.matching}</dt><dd>{formatCount(matches.length)}</dd></div>}
          {filtering && <div><dt>{h.selected}</dt><dd>{formatCount(selectedCount)}</dd></div>}
        </dl>
        <div className="sync">
          <span className="rs-hint rs-num" role="status">{status}</span>
          <button type="button" className="rs-btn" onClick={onSyncNow} disabled={mirror.phase === "syncing" || mirror.phase === "waiting"}>
            {h.syncNow}
          </button>
        </div>
      </div>
      <FilterBar conditions={conditions} onChange={changeConditions} />
      {rows.length === 0 && mirror.phase !== "idle" && <p className="first-sync rs-hint">{h.firstSync}</p>}
      {filtering && matches.length === 0 && (
        <div className="rs-empty"><b>{h.noMatches}</b>{h.noMatchesHint}</div>
      )}
      <div className="scroll" onScroll={onScroll} hidden={filtering && matches.length === 0}>
        <table className="rs-table" aria-label={h.table} aria-rowcount={matches.length + 1}>
          <thead>
            <tr>
              {filtering && (
                <th className="rs-col-check">
                  <SelectAll total={matches.length} selected={selectedCount} onToggle={toggleAll} />
                </th>
              )}
              {header("played", "rs-col-time")}
              {header("artist", "col-artist")}
              {header("track")}
              {header("album", "col-album")}
            </tr>
          </thead>
          <tbody>
            {first > 0 && <tr aria-hidden="true" style={{ height: first * ROW_HEIGHT }} />}
            {matches.slice(first, last).map((s, i) => {
              const selected = filtering && !deselected.has(s.id);
              return (
                <tr key={s.id} aria-rowindex={first + i + 2} aria-selected={filtering ? selected : undefined}>
                  {filtering && (
                    <td className="rs-col-check">
                      <input className="rs-check" type="checkbox" checked={selected} aria-label={h.selectRow(`${s.artist} — ${s.track}, ${formatPlayed(s.timestamp)}`)} onChange={() => toggleRow(s.id)} />
                    </td>
                  )}
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
  );
}
