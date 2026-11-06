import { useMemo, useState, type UIEvent } from "react";
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

export function History({ store, onSyncNow }: { store: MirrorStore; onSyncNow: () => void }) {
  const mirror = useMirror(store);
  const [sort, setSort] = useState<Sort>({ column: "played", descending: true });
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);

  const rows = useMemo(() => {
    const list = [...mirror.scrobbles.values()];
    const by = compare[sort.column];
    return list.sort(sort.descending ? (a, b) => by(b, a) : by);
  }, [mirror.scrobbles, sort]);

  const oldest = useMemo(() => {
    let min = Infinity;
    for (const s of mirror.scrobbles.values()) min = Math.min(min, s.timestamp);
    return Number.isFinite(min) ? min : null;
  }, [mirror.scrobbles]);

  const visible = viewport > 0 ? Math.ceil(viewport / ROW_HEIGHT) + OVERSCAN : UNMEASURED_ROWS;
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN / 2);
  const last = Math.min(rows.length, first + visible);

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
        </dl>
        <div className="sync">
          <span className="rs-hint rs-num" role="status">{status}</span>
          <button type="button" className="rs-btn" onClick={onSyncNow} disabled={mirror.phase === "syncing" || mirror.phase === "waiting"}>
            {h.syncNow}
          </button>
        </div>
      </div>
      {rows.length === 0 && mirror.phase !== "idle" && <p className="first-sync rs-hint">{h.firstSync}</p>}
      <div className="scroll" onScroll={onScroll}>
        <table className="rs-table" aria-label={h.table} aria-rowcount={rows.length + 1}>
          <thead>
            <tr>
              {header("played", "rs-col-time")}
              {header("artist", "col-artist")}
              {header("track")}
              {header("album", "col-album")}
            </tr>
          </thead>
          <tbody>
            {first > 0 && <tr aria-hidden="true" style={{ height: first * ROW_HEIGHT }} />}
            {rows.slice(first, last).map((s, i) => (
              <tr key={s.id} aria-rowindex={first + i + 2}>
                <td className="rs-col-time"><time dateTime={new Date(s.timestamp * 1000).toISOString()}>{formatPlayed(s.timestamp)}</time></td>
                <td>{s.artist}</td>
                <td>{s.track}</td>
                <td>{s.album}</td>
              </tr>
            ))}
            {last < rows.length && <tr aria-hidden="true" style={{ height: (rows.length - last) * ROW_HEIGHT }} />}
          </tbody>
        </table>
      </div>
    </div>
  );
}
