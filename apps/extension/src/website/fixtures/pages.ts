/**
 * Synthetic last.fm library pages with the structure the website uses (scrobble rows carrying their
 * own edit and delete forms, the CSRF token, and pagination). The content is invented.
 */
export interface FixtureRow {
  artist: string;
  track: string;
  album: string;
  albumArtist: string;
  timestamp: number;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const CSRF = "fixture-csrf-token-0123456789";

function row(user: string, r: FixtureRow, opts: { edit: boolean; del: boolean }): string {
  const edit = opts.edit
    ? `<form method="POST" action="/user/${user}/library/edit-track?edited-variation=library-scrobble--timestamp" data-edit-scrobble>
        <input type='hidden' name='csrfmiddlewaretoken' value='${CSRF}' />
        <input type="hidden" name="artist_name" value="${esc(r.artist)}" />
        <input type="hidden" name="track_name" value="${esc(r.track)}" />
        <input type="hidden" name="album_name" value="${esc(r.album)}" />
        <input type="hidden" name="album_artist_name" value="${esc(r.albumArtist)}" />
        <input type="hidden" name="timestamp" value="${r.timestamp}" />
        <button type="submit" class="mimic-link more-item--edit-old">Edit scrobble</button>
      </form>`
    : "";
  const del = opts.del
    ? `<form method="POST" data-ajax-form action="/user/${user}/library/delete">
        <input type='hidden' name='csrfmiddlewaretoken' value='${CSRF}' />
        <input type="hidden" name="artist_name" value="${esc(r.artist)}" />
        <input type="hidden" name="track_name" value="${esc(r.track)}" />
        <input type="hidden" name="timestamp" value="${r.timestamp}" />
        <button type="submit" class="mimic-link more-item--delete" data-ajax-form-sets-state="deleted">Delete scrobble</button>
      </form>`
    : "";
  return `<tr class="chartlist-row" data-scrobble-row data-edit-scrobble-id="${r.timestamp}">
    <td class="chartlist-name"><a href="/music/x/_/y" title="${esc(r.track)}">${esc(r.track)}</a></td>
    <td class="chartlist-artist"><a href="/music/x" title="${esc(r.artist)}">${esc(r.artist)}</a></td>
    <td class="chartlist-more"><ul>${edit}${del}</ul></td>
    <td class="chartlist-timestamp"><span title="sometime">a while ago</span></td>
  </tr>`;
}

export function libraryPage(user: string, rows: FixtureRow[], opts: { pro?: boolean; own?: boolean; page?: number; pages?: number } = {}): string {
  const pro = opts.pro ?? true;
  const own = opts.own ?? true;
  const pages = opts.pages ?? 1;
  const pagination = pages > 1
    ? `<ul class="pagination-list">${Array.from({ length: pages }, (_, i) =>
        i + 1 === (opts.page ?? 1) ? `<li class="pagination-page" aria-current="page"><span>${i + 1}</span></li>` : `<li class="pagination-page"><a href="?page=${i + 1}">${i + 1}</a></li>`).join("")}</ul>`
    : "";
  return `<!doctype html><html><head><title>Library | Last.fm</title></head><body>
    <form><input type='hidden' name='csrfmiddlewaretoken' value='${CSRF}' /></form>
    <table class="chartlist"><tbody>${rows.map((r) => row(user, r, { edit: own && pro, del: own })).join("")}</tbody></table>
    ${pagination}
  </body></html>`;
}

export const rateLimitedPage = `<!doctype html><html><head><title>Last.fm - Rate Limited</title></head><body><h1>Rate limited</h1></body></html>`;

export const FIXTURE_CSRF = CSRF;
