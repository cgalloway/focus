# Focus 2.0.1

- Serve the tested, bundled interface at the existing HTTPS origin inside Electron. This removes website availability from startup and keeps existing local storage. Desktop interface updates now require a rebuild.
- Compare merged sync state with the freshly fetched remote state to avoid unchanged uploads and repair remote regressions.
- Capture local changes after network reads; queue a follow-up when a sync request arrives during another request.
- Bound sync requests to 20 seconds and report oversized sync payloads as failures.
- Skip hidden-window task polling and redundant main timer digit rendering.
- Escape quotation marks in task/project markup.
- Restrict native IPC to the app's main frame and route outside navigation to the browser.
- Preserve normal window bounds on repeated compact requests and save pending compact bounds on close.
- Update Electron to 44.2.0 and electron-builder to 26.15.3; add a reproducible dependency lockfile.

Validation: five sync regression tests, isolated Electron launch/renderer checks,
original storage origin, text escaping, repeated compact toggle and restore.
The isolated smoke test blocks external APIs and does not complete real tasks.
Run `npm test` and `node_modules/.bin/electron test/smoke.cjs` from this directory
(after `node copy-app.js`).
