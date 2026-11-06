import type { Failure, Result, ScrobbleRef, SiteScrobble, TrackOnSite } from "./gateway.ts";

export const SITE = "https://www.last.fm";

/** Last.fm's path segment for a name: spaces as "+", everything else percent-encoded. */
export function pathName(name: string): string {
  return encodeURIComponent(name).replace(/%20/g, "+");
}

/** One page of a Track's scrobbles in a user's library. "+noredirect" keeps Last.fm from swapping in a corrected name. */
export function trackPageUrl(user: string, artist: string, track: string, page: number): string {
  return `${SITE}/user/${pathName(user)}/library/music/+noredirect/${pathName(artist)}/_/${pathName(track)}?page=${page}`;
}

export interface ParsedTrackPage {
  scrobbles: SiteScrobble[];
  canEdit: boolean;
  /** Scrobble rows on the page, whether or not their forms could be read. */
  rows: number;
  /** False when rows show no delete forms: someone else's library, or nobody logged in. */
  ownLibrary: boolean;
  csrf: string | null;
  deleteAction: string | null;
  editAction: string | null;
  pages: number;
}

const value = (form: Element, name: string) => form.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value ?? "";

/** Reads a library page's scrobble rows from the forms the page itself uses. */
export function parseTrackPage(html: string): ParsedTrackPage {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const rows = [...doc.querySelectorAll("tr[data-scrobble-row]")];
  const scrobbles: SiteScrobble[] = [];
  let canEdit = false;
  let deleteAction: string | null = null;
  let editAction: string | null = null;
  let ownLibrary = rows.length > 0;
  for (const row of rows) {
    const edit = row.querySelector("form[data-edit-scrobble]");
    const del = row.querySelector('form[action$="/library/delete"]');
    if (!del) ownLibrary = false;
    const source = edit ?? del;
    if (!source) continue;
    if (edit) {
      canEdit = true;
      editAction ??= edit.getAttribute("action");
    }
    if (del) deleteAction ??= del.getAttribute("action");
    scrobbles.push({
      artist: value(source, "artist_name"),
      track: value(source, "track_name"),
      album: edit ? value(edit, "album_name") : "",
      albumArtist: edit ? value(edit, "album_artist_name") : "",
      timestamp: Number(value(source, "timestamp")),
    });
  }
  const pageLinks = [...doc.querySelectorAll(".pagination-list a, .pagination-list .pagination-page")]
    .map((a) => Number(a.textContent?.trim()))
    .filter((n) => Number.isFinite(n));
  return {
    scrobbles,
    canEdit,
    rows: rows.length,
    ownLibrary,
    csrf: doc.querySelector<HTMLInputElement>('input[name="csrfmiddlewaretoken"]')?.value ?? null,
    deleteAction,
    editAction,
    pages: Math.max(1, ...pageLinks),
  };
}

/** Maps an HTTP status the website answered with to a failure, or null when it's a normal answer. */
export function failureFor(status: number): Failure | null {
  if (status === 406) return { ok: false, reason: "blocked" };
  if (status === 429 || status === 503 || status === 502 || status === 504) return { ok: false, reason: "rateLimited", status };
  if (status === 404) return { ok: false, reason: "notFound" };
  if (status === 401 || status === 403) return { ok: false, reason: "loggedOut" };
  if (status >= 400) return { ok: false, reason: "unexpected", detail: `HTTP ${status}` };
  return null;
}

/**
 * Talks to www.last.fm through same-origin requests, so the user's own login and the page's CSRF
 * token apply. Runs inside a last.fm tab; `fetchFn` is that page's fetch.
 */
export class LastFmSite {
  private csrf: string | null = null;
  private deleteAction: string | null = null;

  constructor(
    private readonly fetchFn: typeof fetch,
    /** The csrftoken cookie, which Django also accepts as the form token when no page has been read yet. */
    private readonly cookieCsrf: () => string | null = () => null,
  ) {}

  async listTrack(user: string, artist: string, track: string): Promise<Result<TrackOnSite>> {
    const scrobbles: SiteScrobble[] = [];
    let canEdit = false;
    for (let page = 1, pages = 1; page <= pages; page++) {
      const response = await this.fetchFn(trackPageUrl(user, artist, track, page), { credentials: "include" });
      const failure = failureFor(response.status);
      if (failure) return failure;
      const parsed = parseTrackPage(await response.text());
      if (parsed.rows > 0 && !parsed.ownLibrary) return { ok: false, reason: "loggedOut" };
      this.csrf = parsed.csrf ?? this.csrf;
      this.deleteAction = parsed.deleteAction ?? this.deleteAction;
      canEdit ||= parsed.canEdit;
      scrobbles.push(...parsed.scrobbles);
      pages = parsed.pages;
    }
    return { ok: true, scrobbles, canEdit };
  }

  async deleteScrobble(user: string, scrobble: ScrobbleRef): Promise<Result> {
    const csrf = this.csrf ?? this.cookieCsrf();
    if (!csrf) return { ok: false, reason: "loggedOut" };
    const action = this.deleteAction ?? `/user/${pathName(user)}/library/delete`;
    const body = new URLSearchParams({
      csrfmiddlewaretoken: csrf,
      artist_name: scrobble.artist,
      track_name: scrobble.track,
      timestamp: String(scrobble.timestamp),
      ajax: "1",
    });
    const response = await this.fetchFn(new URL(action, SITE), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "X-Requested-With": "XMLHttpRequest" },
      body,
    });
    const failure = failureFor(response.status);
    if (failure) return failure;
    const answer = (await response.json().catch(() => null)) as { result?: boolean } | null;
    return answer?.result === true ? { ok: true } : { ok: false, reason: "unexpected", detail: "delete was not confirmed" };
  }
}
