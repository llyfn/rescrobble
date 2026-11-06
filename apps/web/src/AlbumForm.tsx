import { useCallback, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { checkTimestamp, timeAlbum, type Album, type AlbumMatch } from "@rescrobble/core";
import { useApi } from "./api.ts";
import { Combobox } from "./Combobox.tsx";
import { describeFailure } from "./failures.ts";
import { useLastFmReader } from "./lastfm.ts";
import { submitInBatches, type Outcome, type ScrobbleEntry } from "./scrobbles.ts";
import { strings } from "./strings.ts";
import { formatClock, formatDuration, fromLocalInputValue, nowSeconds, toLocalInputValue } from "./time.ts";

const a = strings.album;

interface Loaded {
  album: Album;
  included: boolean[];
  /** Tracks that already reached Last.fm in an earlier, partly failed submission. They keep their time slot. */
  sent: boolean[];
  startedAt: string;
}

function defaultStart(album: Album, included: boolean[]): string {
  const length = timeAlbum(0, album.tracks.map((t, i) => ({ durationSeconds: t.durationSeconds, included: included[i] }))).totalSeconds;
  return toLocalInputValue(new Date((nowSeconds() - length) * 1000));
}

export function AlbumForm({ onResults }: { onResults: (entries: ScrobbleEntry[], outcomes: Outcome[]) => void }) {
  const api = useApi();
  const reader = useLastFmReader();
  const id = useId();
  const [artist, setArtist] = useState("");
  const [albumName, setAlbumName] = useState("");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [lookupNotice, setLookupNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  const searchAlbums = useCallback(
    async (query: string, signal: AbortSignal): Promise<AlbumMatch[]> => {
      if (!reader) return [];
      const matches = await reader.searchAlbums(query, { signal });
      const wanted = artist.trim().toLowerCase();
      return wanted ? matches.filter((m) => m.artist.toLowerCase().includes(wanted)) : matches;
    },
    [reader, artist],
  );

  async function load(forArtist: string, forAlbum: string) {
    setLookupNotice(null);
    setFormError(null);
    setFailure(null);
    setLoaded(null);
    if (!reader || !forArtist.trim() || !forAlbum.trim()) return;
    let album: Album | null;
    try {
      album = await reader.getAlbum(forArtist.trim(), forAlbum.trim());
    } catch {
      return setLookupNotice(a.lookupFailed);
    }
    if (!album) return setLookupNotice(a.notFound);
    if (album.tracks.length === 0) return setLookupNotice(a.noTracklist);
    const included = album.tracks.map(() => true);
    setLoaded({ album, included, sent: album.tracks.map(() => false), startedAt: defaultStart(album, included) });
  }

  const timing = useMemo(() => {
    if (!loaded) return null;
    const start = fromLocalInputValue(loaded.startedAt);
    if (start === null) return null;
    return timeAlbum(start, loaded.album.tracks.map((t, i) => ({ durationSeconds: t.durationSeconds, included: loaded.included[i] })));
  }, [loaded]);

  const tickedCount = loaded ? loaded.included.filter(Boolean).length : 0;
  const toSendCount = loaded ? loaded.included.filter((on, i) => on && !loaded.sent[i]).length : 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!loaded) return load(artist, albumName);
    if (submitting.current || !timing) return;

    if (toSendCount === 0) return setFormError(a.noneTicked);
    const now = nowSeconds();
    const starts = timing.tracks.flatMap((t) => (t.startsAt === null ? [] : [t.startsAt]));
    const tooOld = starts.filter((s) => checkTimestamp(s, now) === "tooOld").length;
    const inFuture = starts.filter((s) => checkTimestamp(s, now) === "inFuture").length;
    if (tooOld) return setFormError(a.tooOld(tooOld));
    if (inFuture) return setFormError(a.inFuture(inFuture));
    setFormError(null);

    const { album } = loaded;
    const indexes: number[] = [];
    const entries: ScrobbleEntry[] = album.tracks.flatMap((track, i) => {
      const startsAt = timing.tracks[i]!.startsAt;
      if (startsAt === null || loaded.sent[i]) return [];
      indexes.push(i);
      const entry: ScrobbleEntry = { artist: track.artist, track: track.title, timestamp: startsAt, album: album.name };
      if (album.artist !== track.artist) entry.albumArtist = album.artist;
      return [entry];
    });

    submitting.current = true;
    setBusy(true);
    setFailure(null);
    const result = await submitInBatches(api, entries);
    submitting.current = false;
    setBusy(false);

    if (result.entries.length > 0) onResults(result.entries, result.outcomes);
    if (!result.ok) {
      const sentNow = new Set(indexes.slice(0, result.entries.length));
      update({ sent: loaded.sent.map((wasSent, i) => wasSent || sentNow.has(i)) });
      return setFailure(describeFailure(result.failure));
    }
    setLoaded(null);
  }

  const update = (change: Partial<Loaded>) => setLoaded((current) => (current ? { ...current, ...change } : current));

  return (
    <form className="add-form" onSubmit={submit} noValidate>
      {failure && (
        <div className="rs-notice rs-notice--danger" role="alert">
          <svg className="rs-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5l6 11H2l6-11z" /><path d="M8 7v3M8 12h.01" /></svg>
          <span>{failure}</span>
        </div>
      )}
      <div className="pair">
        <div className="rs-field">
          <label className="rs-label" htmlFor={`${id}-artist`}>{a.artist}</label>
          <input
            id={`${id}-artist`}
            className="rs-input"
            name="artist"
            autoComplete="off"
            value={artist}
            onChange={(e) => {
              setArtist(e.target.value);
              setLoaded(null);
            }}
          />
        </div>
        <Combobox
          id={`${id}-album`}
          name="album"
          label={a.album}
          value={albumName}
          onChange={(value) => {
            setAlbumName(value);
            setLoaded(null);
          }}
          search={searchAlbums}
          onPick={(match) => {
            setArtist(match.artist);
            setAlbumName(match.album);
            void load(match.artist, match.album);
          }}
          optionKey={(match) => `${match.artist}\u0000${match.album}`}
          renderOption={(match) => (
            <>
              <span>{match.album}</span>
              <span className="rs-option__secondary">{match.artist}</span>
            </>
          )}
        />
      </div>

      {lookupNotice && (
        <div className="rs-notice rs-notice--warn" role="status">
          <svg className="rs-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path d="M8 7.5v3.5M8 5h.01" /></svg>
          <span>{lookupNotice}</span>
        </div>
      )}

      {!loaded && <button className="rs-btn rs-btn--block" type="submit">{a.find}</button>}

      {loaded && timing && (
        <>
          <div className="rs-field">
            <label className="rs-label" htmlFor={`${id}-start`}>{a.startedAt}</label>
            <input
              id={`${id}-start`}
              className="rs-input rs-num"
              type="datetime-local"
              value={loaded.startedAt}
              onChange={(e) => update({ startedAt: e.target.value })}
              aria-describedby={`${id}-start-hint`}
            />
            <span className="rs-hint" id={`${id}-start-hint`}>{a.startedAtHint}</span>
          </div>

          <ol className="tracks rs-num" aria-label={loaded.album.name}>
            {loaded.album.tracks.map((track, i) => {
              const timed = timing.tracks[i]!;
              return (
                <li key={i} className={loaded.included[i] ? undefined : "skipped"}>
                  <span className="n">{i + 1}</span>
                  <input
                    className="rs-check"
                    type="checkbox"
                    checked={loaded.included[i]}
                    disabled={loaded.sent[i]}
                    aria-label={a.include(track.title)}
                    onChange={(e) => update({ included: loaded.included.map((v, j) => (j === i ? e.target.checked : v)) })}
                  />
                  <span className="t">{track.title}</span>
                  <span className="d">
                    {formatDuration(timed.durationSeconds)}
                    {timed.estimated && <abbr className="est" title={a.estimatedTitle}> {a.estimated}</abbr>}
                  </span>
                  <time className="at">{timed.startsAt === null ? "" : formatClock(timed.startsAt)}</time>
                  {loaded.sent[i] && <span className="sent rs-status rs-status--accepted">{a.sent}</span>}
                </li>
              );
            })}
          </ol>
          <div className="total rs-num">
            <span>{a.summary(tickedCount, loaded.album.tracks.length, formatDuration(timing.totalSeconds))}</span>
            {tickedCount > 0 && <span>{formatClock(fromLocalInputValue(loaded.startedAt)!)} – {formatClock(timing.endsAt)}</span>}
          </div>
          {formError && <p className="rs-hint rs-hint--error" role="alert">{formError}</p>}
          <button className="rs-btn rs-btn--primary rs-btn--block" type="submit" aria-busy={busy || undefined}>{a.submit(toSendCount)}</button>
        </>
      )}
    </form>
  );
}
