const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const files = require('../app-files.js');
const root = path.join(__dirname,'../..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');

test('every bundled interface file exists in the repository',()=>{
 for (const file of files) assert.ok(fs.existsSync(path.join(root,file)),file);
});
test('index.html loads only bundled scripts and stylesheets',()=>{
 const loaded = [...read('index.html').matchAll(/<(?:script[^>]*\ssrc|link[^>]*rel="stylesheet"[^>]*\shref)="([^"]+)"/g)].map(m=>m[1]);
 assert.ok(loaded.length > 0);
 for (const file of loaded) assert.ok(files.includes(file),file);
});
test('the service worker caches every bundled interface file',()=>{
 const sw = read('sw.js');
 for (const file of files) assert.ok(sw.includes(`'./${file}'`),file);
});
test('the packaged desktop app includes the shared file list',()=>{
 const pkg = JSON.parse(read('desktop/package.json'));
 assert.ok(pkg.build.files.includes('app-files.js'));
});
