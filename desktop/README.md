# Focus macOS desktop app

The desktop app runs its bundled interface, including offline, at the original
app origin inside Electron. Existing settings, sessions and sync identity stay
in the same storage location. Website changes require rebuilding the desktop.
Todoist and Focus Sync continue to use their normal network APIs.

Run `npm ci`, then `npm start` to develop or `npm run dist` to build a DMG.
`copy-app.js` refreshes the bundled interface before each start/build.
Keep the bundle identifier and app name unchanged to preserve existing data.
