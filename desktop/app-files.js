/* The interface files bundled into the desktop app. copy-app.js copies them
 * into desktop/app/ and main.js serves them at the app origin. When adding a
 * file, also list it in ../sw.js for the web build; test/app-files.test.js
 * fails if the lists drift or index.html loads a file missing from here. */

module.exports = [
  'index.html',
  'workspace.css',
  'workspace.js',
  'workspace-core.js',
  'compact.js',
  'compact.css',
  'focus-sync.js',
  'todoist-completion.js',
  'focus-push.js',
  'confetti.browser.min.js'
];
