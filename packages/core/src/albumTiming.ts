/** Used for a track Last.fm has no length for. */
export const DEFAULT_TRACK_SECONDS = 210;

export interface AlbumTrackInput {
  durationSeconds: number | null;
  included?: boolean;
}

export interface TimedTrack {
  /** Unix seconds the track started, or null when it isn't included. */
  startsAt: number | null;
  durationSeconds: number;
  estimated: boolean;
}

export interface AlbumTiming {
  tracks: TimedTrack[];
  totalSeconds: number;
  endsAt: number;
}

/** Times an album played straight through from `startSeconds`: each included track follows the one before it. */
export function timeAlbum(startSeconds: number, tracks: AlbumTrackInput[]): AlbumTiming {
  let at = startSeconds;
  const timed = tracks.map((track) => {
    const estimated = !track.durationSeconds || track.durationSeconds <= 0;
    const durationSeconds = estimated ? DEFAULT_TRACK_SECONDS : track.durationSeconds!;
    if (track.included === false) return { startsAt: null, durationSeconds, estimated };
    const startsAt = at;
    at += durationSeconds;
    return { startsAt, durationSeconds, estimated };
  });
  return { tracks: timed, totalSeconds: at - startSeconds, endsAt: at };
}
