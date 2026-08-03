/* Refreshes the offline-fallback copy of the app (desktop/app/) from the repo
 * root. Runs automatically before `npm start` and `npm run dist`, so the
 * bundled fallback is always the same version as the checkout being built. */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');
const DEST = path.join(__dirname, 'app');
const FILES = ['index.html', 'focus-sync.js', 'focus-push.js', 'confetti.browser.min.js'];

fs.mkdirSync(DEST, { recursive: true });
for (const f of FILES) {
  fs.copyFileSync(path.join(SRC, f), path.join(DEST, f));
}
console.log(`copied ${FILES.length} files into desktop/app/`);
