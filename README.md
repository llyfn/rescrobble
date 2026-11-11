# rescrobble

Curate your [Last.fm](https://www.last.fm) listening history: add plays that never got scrobbled, and fix or remove ones that were scrobbled wrong.

> Not released yet.

## Features

### Add scrobbles

- **A single track:** enter the artist and track, pick from Last.fm's suggestions as you type, and set when you played it.
- **A whole album:** find the album, untick anything you skipped, and set when you started listening. Each track is timed from the one before it, using its length on Last.fm.
- **Honest results:** every scrobble reports back whether Last.fm added it, corrected the name, or ignored it and why.
- **Safe times:** Last.fm only accepts plays from the last 14 days, so older or future times are caught before anything is sent.

### Fix your history (browser extension)

- **Your whole history at hand:** the extension keeps a copy of your history in your browser and keeps it up to date, so finding scrobbles is instant.
- **Precise filters:** narrow your history by artist, track or album (exact, contains, regex or empty), by date, or by duplicate plays, and see why each scrobble matched.
- **Edit in bulk:** set a field to a new value, or find and replace text across hundreds of scrobbles at once. Requires Last.fm Pro.
- **Delete in bulk:** remove junk, duplicates or plays you never meant to scrobble.
- **Preview before anything changes:** see every affected scrobble with its old and new values, and confirm explicitly. Deletes that can't be undone are marked.
- **Changes that keep going:** large changes run one request at a time, slow down when Last.fm asks them to, and pick up where they left off if you close the browser. You can pause or cancel at any time.
- **Change log and undo:** every change is recorded. Undo an edit at any time, or undo a delete while Last.fm still accepts the plays again.

## Two ways to use it

- **Web App:** add scrobbles from any browser, including on your phone.
- **Browser extension** (Chrome, Edge and other Chromium browsers): everything the Web App does, plus filtering, editing and deleting.

## Your account stays yours

- You sign in on last.fm. rescrobble never sees your password.
- Last.fm's API can't edit or delete scrobbles, so the extension makes those changes on last.fm itself, in a last.fm tab it opens in the background, signed in as you.
- rescrobble's servers never see your last.fm session and never store your listening history. Your history copy and change log stay in your browser.

## Credits

Powered by [AudioScrobbler](https://www.last.fm/api). rescrobble is a non-commercial project.

## License

[MIT](LICENSE)
