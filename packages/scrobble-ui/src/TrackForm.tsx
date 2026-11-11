import { useCallback, useId, useRef, useState, type FormEvent } from "react";
import { checkTimestamp, type AlbumMatch, type TrackMatch } from "@rescrobble/core";
import { Art } from "./Art.tsx";
import { Combobox } from "./Combobox.tsx";
import { useLastFmReader } from "./lastfm.ts";
import { useTransport } from "./context.ts";
import { describeFailure } from "./failures.ts";
import { submitScrobbles, type Outcome, type ScrobbleEntry } from "./scrobbles.ts";
import { strings } from "./strings.ts";
import { fromLocalInputValue, nowSeconds, toLocalInputValue } from "./time.ts";

type Field = "artist" | "track" | "playedAt";
type Errors = Partial<Record<Field, string>>;

const t = strings.track;

function validate(artist: string, track: string, playedAt: string): { errors: Errors; timestamp: number | null } {
  const errors: Errors = {};
  if (!artist.trim()) errors.artist = strings.validation.required(t.artist);
  if (!track.trim()) errors.track = strings.validation.required(t.track);
  const timestamp = fromLocalInputValue(playedAt);
  if (timestamp === null) errors.playedAt = strings.validation.invalidTime;
  else {
    const check = checkTimestamp(timestamp, nowSeconds());
    if (check !== "acceptable") errors.playedAt = strings.validation[check];
  }
  return { errors, timestamp };
}

export function TrackForm({ onResults }: { onResults: (entries: ScrobbleEntry[], outcomes: Outcome[]) => void }) {
  const { api } = useTransport();
  const id = useId();
  const [artist, setArtist] = useState("");
  const [track, setTrack] = useState("");
  const [album, setAlbum] = useState("");
  const [playedAt, setPlayedAt] = useState(() => toLocalInputValue(new Date()));
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  /** Whether Album holds the picked track's album rather than something the user chose. */
  const albumFromTrack = useRef(false);
  const albumLookup = useRef<AbortController | null>(null);
  const reader = useLastFmReader();
  const searchTracks = useCallback(
    async (query: string, signal: AbortSignal): Promise<TrackMatch[]> =>
      reader ? reader.searchTracks(query, { artist: artist.trim() || undefined, signal }) : [],
    [reader, artist],
  );
  const searchArtists = useCallback(
    async (query: string, signal: AbortSignal): Promise<string[]> => (reader ? reader.searchArtists(query, { signal }) : []),
    [reader],
  );
  const searchAlbums = useCallback(
    async (query: string, signal: AbortSignal): Promise<AlbumMatch[]> => {
      if (!reader) return [];
      const matches = await reader.searchAlbums(query, { signal });
      const wanted = artist.trim().toLowerCase();
      return wanted ? matches.filter((m) => m.artist.toLowerCase().includes(wanted)) : matches;
    },
    [reader, artist],
  );

  function changeTrack(value: string) {
    albumLookup.current?.abort();
    setTrack(value);
  }

  function changeAlbum(value: string) {
    albumLookup.current?.abort();
    albumFromTrack.current = false;
    setAlbum(value);
  }

  /** Fills Album with the picked track's album, unless the user chose an album themselves. */
  async function fillAlbum(match: TrackMatch) {
    albumLookup.current?.abort();
    if (!reader || (album.trim() && !albumFromTrack.current)) return;
    const controller = new AbortController();
    albumLookup.current = controller;
    const found = await reader.getTrackAlbum(match.artist, match.track, { signal: controller.signal }).catch(() => null);
    if (controller.signal.aborted) return;
    albumFromTrack.current = true;
    setAlbum(found?.album ?? "");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    const checked = validate(artist, track, playedAt);
    setErrors(checked.errors);
    if (Object.keys(checked.errors).length > 0 || checked.timestamp === null) return;

    const entry: ScrobbleEntry = { artist: artist.trim(), track: track.trim(), timestamp: checked.timestamp };
    if (album.trim()) entry.album = album.trim();

    submitting.current = true;
    setBusy(true);
    setFailure(null);
    const result = await submitScrobbles(api, [entry]);
    submitting.current = false;
    setBusy(false);

    if (!result.ok) {
      setFailure(describeFailure(result));
      return;
    }
    onResults([entry], result.outcomes);
    if (result.outcomes[0]?.status === "accepted") {
      changeTrack("");
      changeAlbum("");
    }
  }

  const playedAtError = errors.playedAt;
  return (
    <form className="add-form" onSubmit={submit} noValidate>
      {failure && (
        <div className="rs-notice rs-notice--danger" role="alert">
          <svg className="rs-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5l6 11H2l6-11z" /><path d="M8 7v3M8 12h.01" /></svg>
          <span>{failure}</span>
        </div>
      )}
      <Combobox
        id={`${id}-track`}
        name="track"
        label={t.track}
        value={track}
        onChange={changeTrack}
        search={searchTracks}
        onPick={(match) => {
          setArtist(match.artist);
          changeTrack(match.track);
          void fillAlbum(match);
        }}
        optionKey={(match) => `${match.artist}\u0000${match.track}`}
        renderOption={(match) => (
          <>
            <span>{match.track}</span>
            <span className="rs-option__secondary">{match.artist}</span>
          </>
        )}
        error={errors.track}
      />
      <Combobox
        id={`${id}-artist`}
        name="artist"
        label={t.artist}
        value={artist}
        onChange={setArtist}
        search={searchArtists}
        onPick={setArtist}
        optionKey={(name) => name}
        renderOption={(name) => <span>{name}</span>}
        error={errors.artist}
      />
      <Combobox
        id={`${id}-album`}
        name="album"
        label={t.album}
        value={album}
        onChange={changeAlbum}
        search={searchAlbums}
        onPick={(match) => {
          changeAlbum(match.album);
          if (!artist.trim()) setArtist(match.artist);
        }}
        optionKey={(match) => `${match.artist}\u0000${match.album}`}
        renderOption={(match) => (
          <>
            <Art src={match.image} />
            <span className="rs-option__primary">{match.album}</span>
            <span className="rs-option__secondary">{match.artist}</span>
          </>
        )}
        placeholder={t.albumHint}
      />
      <div className="rs-field">
        <label className="rs-label" htmlFor={`${id}-playedAt`}>{t.playedAt}</label>
        <input
          id={`${id}-playedAt`}
          className="rs-input rs-num"
          name="playedAt"
          type="datetime-local"
          value={playedAt}
          onChange={(e) => setPlayedAt(e.target.value)}
          aria-invalid={playedAtError ? true : undefined}
          aria-describedby={playedAtError ? `${id}-playedAt-error` : undefined}
        />
        {playedAtError && <span className="rs-hint rs-hint--error" id={`${id}-playedAt-error`}>{playedAtError}</span>}
      </div>
      <button className="rs-btn rs-btn--primary rs-btn--block" type="submit" aria-busy={busy || undefined}>{t.submit}</button>
    </form>
  );
}
