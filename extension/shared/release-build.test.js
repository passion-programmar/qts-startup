// The release zip's background worker holds its importScripts files (one file to load on every
// wake-up instead of 46). The merge keeps their order and their text exactly, and anything it
// cannot read safely stops the build.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const esbuild = require('esbuild');
const { mergeWorkerImports } = require('../../scripts/build-extension.cjs');

const background = path.resolve(__dirname, '../background');
const read = (file) => fs.readFileSync(path.resolve(background, file), 'utf8');

test('the release worker holds every imported file, in order, and imports nothing', async () => {
  const source = read('service-worker.js');
  const { files, source: merged } = mergeWorkerImports(source, read);
  assert.ok(files.length > 40, `${files.length} imported files`);
  assert.doesNotMatch(merged, /\bimportScripts\s*\(/);
  let at = 0;
  for (const file of files) {
    const index = merged.indexOf(read(file), at);
    assert.ok(index >= at, `${file} is inside, after the file before it`);
    at = index + 1;
  }
  // The worker's own code follows them, unchanged.
  assert.ok(merged.endsWith(source.slice(-2000)));
  // Still one valid classic script, minified as the build does it.
  await esbuild.transform(merged, { loader: 'js', minify: true, target: 'chrome120' });
});

test('file text is placed as it is, even "$&" patterns a string replace would expand', () => {
  const files = { 'a.js': "x.replace(/a/, '$&$1$`');", 'b.js': 'b()' };
  const { source } = mergeWorkerImports("importScripts(\n  'a.js',\n  'b.js'\n);\nrun();\n", (file) => files[file]);
  assert.equal(source, "// a.js\nx.replace(/a/, '$&$1$`');\n;\n// b.js\nb()\n;\n\nrun();\n");
});

test('a worker whose imports cannot be read safely stops the build', () => {
  assert.throws(() => mergeWorkerImports("importScripts('a.js');\nimportScripts('b.js');\n", () => ''), /one importScripts/);
  assert.throws(() => mergeWorkerImports('importScripts(dynamicFile);\n', () => ''), /one importScripts/);
  assert.throws(() => mergeWorkerImports('self.run();\n', () => ''), /one importScripts/);
});
