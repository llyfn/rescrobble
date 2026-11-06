# rescrobble

Curate your [Last.fm](https://www.last.fm) listening history: add plays that never got scrobbled, and fix or remove ones that were scrobbled wrong.

> Not released yet. The Web App and the browser extension work end to end in development but haven't been published.

## What it does

- **Add scrobbles by hand:** a single track, or a whole album timed track by track from when you started listening.
- **Find what to fix:** filter your history by artist, track or album (exact, contains, regex or empty), by date, or by duplicate plays.
- **Edit and delete in bulk:** preview every change before it's applied, follow it as it runs, and undo it from the change log.

Every scrobble you send reports back whether Last.fm kept it. Last.fm only accepts plays from the last 14 days, so older times are caught before anything is sent.

## How it works

rescrobble comes in two parts that share one look and the same Add scrobbles screen.

**Web App.** Sign in with Last.fm and add scrobbles from any browser, including on your phone. It uses only the official Last.fm API and never asks for your password.

**Browser extension** (Chromium). Everything the Web App does, plus:

- **Your own copy of your history:** a local copy of your whole history, kept in your browser and synced on open, so filtering is instant.
- **Bulk changes:** filters, selection, and bulk edits and deletes with a preview.
- **Changes that survive interruptions:** jobs that pause when Last.fm asks them to slow down and pick up where they left off if you close the browser.
- **A change log:** every change is recorded, with undo.

The Last.fm API can't edit or delete scrobbles, so the extension makes those changes on last.fm itself, in a last.fm tab it opens in the background, signed in as you. rescrobble's servers never see your password or your last.fm session, and never store your listening history.

Editing scrobbles requires a Last.fm Pro subscription; deleting doesn't.

## Development

You need Node.js, [pnpm](https://pnpm.io) and a JDK 17 or later; Gradle downloads JDK 25 for the backend build if needed. You also need a Last.fm API account ([create one](https://www.last.fm/api/account/create)).

```sh
pnpm install
pnpm typecheck && pnpm lint && pnpm test   # Web App, extension and shared packages
(cd backend && ./gradlew test)             # backend
```

| Folder | What it is |
|---|---|
| `backend/` | Kotlin/Ktor service: Last.fm sign-in and scrobble submission |
| `apps/web/` | The Web App (React, Vite) |
| `apps/extension/` | The browser extension (React, WXT) |
| `packages/scrobble-ui/` | The Add scrobbles screen both apps share |
| `packages/core/` | Shared rules: timestamps, album timing, filters, edits, Last.fm reads |
| `packages/ui/` | Design tokens and components |

### Backend

The backend reads its configuration from these environment variables:

| Variable | Description |
|---|---|
| `LASTFM_API_KEY` | Last.fm API key |
| `LASTFM_SHARED_SECRET` | Last.fm shared secret |
| `SESSION_ENCRYPTION_KEY` | 32 random bytes, base64-encoded (`openssl rand -base64 32`) |
| `PUBLIC_BASE_URL` | URL the Web App is reached at; `http://localhost:5173` in development |
| `EXTENSION_ID` | ID of the extension allowed to call the API; `mnbkmonfmoloodikmopdlohjgdehfkep` for this repository's builds |
| `PORT` | Optional, defaults to `8080` |
| `WEB_APP_DIR` | Optional folder with a built Web App to serve |

```sh
cd backend && ./gradlew run
```

### Web App

```sh
pnpm --filter @rescrobble/web dev
```

The Web App runs on `http://localhost:5173` and forwards `/api` and `/auth` to the backend on port 8080, so Last.fm sign-in works locally.

### Extension

```sh
pnpm --filter @rescrobble/extension build
```

Then open `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and select `apps/extension/.output/chrome-mv3`. The extension talks to `http://localhost:8080` unless you build it with `WXT_BACKEND_ORIGIN` set to another backend.

### Docker

One image builds the Web App and serves it alongside the backend:

```sh
docker build -t rescrobble .
docker run -p 8080:8080 --env-file .env rescrobble
```

## Credits

Powered by [AudioScrobbler](https://www.last.fm/api). rescrobble is a non-commercial project and is not affiliated with Last.fm.
