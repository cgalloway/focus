/* Refreshes the bundled copy of the interface (desktop/app/) from the repo
 * root. Runs automatically before `npm start` and `npm run dist`, so the
 * desktop app always ships the same version as the checkout being built. */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');
const DEST = path.join(__dirname, 'app');
const FILES = require('./app-files.js');

fs.mkdirSync(DEST, { recursive: true });
for (const f of FILES) {
  fs.copyFileSync(path.join(SRC, f), path.join(DEST, f));
}
console.log(`copied ${FILES.length} files into desktop/app/`);
