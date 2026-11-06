# rescrobble

Curate your [Last.fm](https://www.last.fm) listening history: add plays that never got scrobbled, and fix or remove ones that were scrobbled wrong.

> Work in progress. The backend is in place; the Web App and the browser extension are being built.

## What it does

- **Add scrobbles by hand:** single tracks, or a whole album timed track by track.
- **Edit and delete in bulk:** filter your history by artist, track, album, time range or duplicates, preview exactly what will change, then apply it.

## How it works

rescrobble comes in two parts:

- **Web App:** sign in with Last.fm and add scrobbles from any browser, including on mobile. It uses only the official Last.fm API and never asks for your password.
- **Browser extension** (Chromium): everything the Web App does, plus filtering, editing and deleting. The Last.fm API can't edit or delete scrobbles, so the extension does this in your own browser, using your own last.fm login. rescrobble's servers never see your password or your website session, and never store your listening history.

Editing scrobbles requires a Last.fm Pro subscription; deleting doesn't.

## Running the backend

The backend is a Kotlin/Ktor service. It needs a Last.fm API account ([create one](https://www.last.fm/api/account/create)) and these environment variables:

| Variable | Description |
|---|---|
| `LASTFM_API_KEY` | Last.fm API key |
| `LASTFM_SHARED_SECRET` | Last.fm shared secret |
| `SESSION_ENCRYPTION_KEY` | 32 random bytes, base64-encoded (`openssl rand -base64 32`) |
| `PUBLIC_BASE_URL` | Public URL the service is reached at, e.g. `https://rescrobble.example` |
| `EXTENSION_ID` | ID of the browser extension allowed to call the API |
| `PORT` | Optional, defaults to `8080` |
| `WEB_APP_DIR` | Optional folder with the built Web App to serve |

With Docker:

```sh
docker build -t rescrobble .
docker run -p 8080:8080 --env-file .env rescrobble
```

Or locally (JDK 17+; Gradle downloads JDK 25 for the build if needed):

```sh
cd backend
./gradlew test
./gradlew run
```

## Credits

Powered by [AudioScrobbler](https://www.last.fm/api). rescrobble is a non-commercial project and is not affiliated with Last.fm.
