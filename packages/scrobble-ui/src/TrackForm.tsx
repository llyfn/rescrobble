import { useCallback, useId, useRef, useState, type FormEvent } from "react";
import { checkTimestamp, type TrackMatch } from "@rescrobble/core";
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
  const reader = useLastFmReader();
  const searchTracks = useCallback(
    async (query: string, signal: AbortSignal): Promise<TrackMatch[]> =>
      reader ? reader.searchTracks(query, { artist: artist.trim() || undefined, signal }) : [],
    [reader, artist],
  );

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
      setTrack("");
      setAlbum("");
    }
  }

  const field = (name: Field | "album", label: string, value: string, set: (v: string) => void, extra: object = {}) => {
    const error = name !== "album" ? errors[name] : undefined;
    return (
      <div className="rs-field">
        <label className="rs-label" htmlFor={`${id}-${name}`}>{label}</label>
        <input
          id={`${id}-${name}`}
          className="rs-input"
          name={name}
          value={value}
          onChange={(e) => set(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-${name}-error` : undefined}
          autoComplete="off"
          {...extra}
        />
        {error && <span className="rs-hint rs-hint--error" id={`${id}-${name}-error`}>{error}</span>}
      </div>
    );
  };

  return (
    <form className="add-form" onSubmit={submit} noValidate>
      {failure && (
        <div className="rs-notice rs-notice--danger" role="alert">
          <svg className="rs-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5l6 11H2l6-11z" /><path d="M8 7v3M8 12h.01" /></svg>
          <span>{failure}</span>
        </div>
      )}
      {field("artist", t.artist, artist, setArtist)}
      <Combobox
        id={`${id}-track`}
        name="track"
        label={t.track}
        value={track}
        onChange={setTrack}
        search={searchTracks}
        onPick={(match) => {
          setArtist(match.artist);
          setTrack(match.track);
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
      {field("album", t.album, album, setAlbum, { placeholder: t.albumHint })}
      {field("playedAt", t.playedAt, playedAt, setPlayedAt, { type: "datetime-local", className: "rs-input rs-num" })}
      <button className="rs-btn rs-btn--primary rs-btn--block" type="submit" aria-busy={busy || undefined}>{t.submit}</button>
    </form>
  );
}
