# Focus — macOS desktop app

Electron shell around the same `index.html` the iPhone app uses. The window
loads the **deployed** web app (`https://cgalloway.github.io/focus/`) on every
launch, so the desktop app picks up new fixes automatically — no rebuilds.
When offline, it falls back to the copy bundled at build time.

## Run it

```bash
cd desktop
npm install
npm start
```

## Build the DMG (once)

```bash
npm run dist
```

The installer lands in `desktop/dist/Focus-*.dmg`. Drag Focus.app to
Applications. Because the app loads the live site first, this DMG keeps
itself current — rebuild only if the shell itself (`main.js`/`preload.js`)
changes.

## First launch

Paste your Todoist API token into Settings (it's stored encrypted via macOS
safeStorage, not in the page). Your streaks, session and time goals come back
automatically through Focus Sync once the token is in.

## Notes

- `copy-app.js` refreshes `app/` (the offline fallback) from the repo root
  before every start/build.
- If the deployed URL ever changes (e.g. a custom domain), update `APP_URL`
  at the top of `main.js`.
