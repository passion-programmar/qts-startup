// Builds dist/qts-extension-<version>.zip (minified) for sharing with other PCs.
// Chrome on this PC loads extension/ itself, so the zip is the only build output:
// older zips and unpacked build folders in dist/ are removed.
// Files stay one-to-one with extension/ because the extension loads them by
// path (manifest, chrome.scripting.executeScript). The one change: the background
// worker's importScripts files are placed inside it, in the same order, so a
// wake-up loads one file instead of 46 (about twice as fast to wake in a quick test).
// Those files stay in the zip too, since pages load some of them by path.

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const sourceDir = path.join(root, "extension");
const distDir = path.join(root, "dist");
const WORKER = "background/service-worker.js";

// Classic scripts loaded with importScripts share one global scope, so placing their text in
// the worker, in order, runs the same code. Anything but one importScripts of plain file names
// stops the build rather than ship a worker that might not start.
function mergeWorkerImports(workerSource, readImport) {
  const calls = workerSource.match(/\bimportScripts\s*\(/g) || [];
  const call = workerSource.match(/^importScripts\(((?:\s*'[^']+',?)+)\s*\);/m);
  if (calls.length !== 1 || !call) {
    throw new Error(`${WORKER}: expected one importScripts(...) of plain file names`);
  }
  const files = [...call[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const merged = files.map((file) => `// ${file}\n${readImport(file)}\n;\n`).join("");
  // A function, so "$&" and the like in the files' text are kept as they are.
  return { files, source: workerSource.replace(call[0], () => merged) };
}

function readWorkerImport(file) {
  const fullPath = path.resolve(sourceDir, path.dirname(WORKER), file);
  if (!fullPath.startsWith(sourceDir + path.sep)) throw new Error(`${WORKER}: ${file} is outside extension/`);
  return fs.readFileSync(fullPath, "utf8");
}

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}

async function buildFile(sourcePath) {
  const name = path.relative(sourceDir, sourcePath).split(path.sep).join("/");
  const extension = path.extname(sourcePath);
  if (extension === ".js" || extension === ".css") {
    let source = fs.readFileSync(sourcePath, "utf8");
    if (name === WORKER) source = mergeWorkerImports(source, readWorkerImport).source;
    // Without a module format esbuild keeps top-level names, which these
    // classic scripts share as globals across files.
    const result = await esbuild.transform(source, {
      loader: extension.slice(1),
      minify: true,
      target: "chrome120",
      legalComments: "none",
    });
    return { name, data: Buffer.from(result.code, "utf8") };
  }
  return { name, data: fs.readFileSync(sourcePath) };
}

// Minimal ZIP writer (deflate, no external dependency).
function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuffer = Buffer.from(name, "utf8");
    const compressed = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(local, nameBuffer, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + compressed.length;
  }
  const centralSize = centralParts.reduce((size, part) => size + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

// Earlier builds: the unpacked dist/extension folder and every qts-extension-* zip or folder.
function removeOldBuilds() {
  if (!fs.existsSync(distDir)) return;
  for (const entry of fs.readdirSync(distDir)) {
    if (entry === "extension" || entry.startsWith("qts-extension-")) {
      fs.rmSync(path.join(distDir, entry), { recursive: true, force: true });
    }
  }
}

async function main() {
  const sourceFiles = listFiles(sourceDir).filter((file) => !file.endsWith(".test.js"));
  const builtFiles = [];
  for (const file of sourceFiles) builtFiles.push(await buildFile(file));
  builtFiles.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const { version } = JSON.parse(fs.readFileSync(path.join(sourceDir, "manifest.json"), "utf8"));
  const zipPath = path.join(distDir, `qts-extension-${version}.zip`);
  const zip = createZip(builtFiles);
  removeOldBuilds();
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(zipPath, zip);

  const sourceSize = sourceFiles.reduce((size, file) => size + fs.statSync(file).size, 0);
  const builtSize = builtFiles.reduce((size, file) => size + file.data.length, 0);
  console.log(`Built ${builtFiles.length} files`);
  console.log(`Size: ${Math.round(sourceSize / 1024)} KB -> ${Math.round(builtSize / 1024)} KB`);
  console.log(`Zip: ${path.relative(root, zipPath)} (${Math.round(zip.length / 1024)} KB)`);
}

module.exports = { mergeWorkerImports };

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
