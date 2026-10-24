// Builds the unpacked Chrome extension: dist/extension (minified, for
// "Load unpacked") and dist/qts-extension-<version>.zip for sharing.
// Files stay one-to-one with extension/ because the extension loads them by
// path (manifest, importScripts, chrome.scripting.executeScript).

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const sourceDir = path.join(root, "extension");
const distDir = path.join(root, "dist");
const outputDir = path.join(distDir, "extension");

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}

async function buildFile(sourcePath) {
  const relativePath = path.relative(sourceDir, sourcePath);
  const outputPath = path.join(outputDir, relativePath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const extension = path.extname(sourcePath);
  if (extension === ".js" || extension === ".css") {
    // Without a module format esbuild keeps top-level names, which these
    // classic scripts share as globals across files.
    const result = await esbuild.transform(fs.readFileSync(sourcePath, "utf8"), {
      loader: extension.slice(1),
      minify: true,
      target: "chrome120",
      legalComments: "none",
    });
    fs.writeFileSync(outputPath, result.code);
  } else {
    fs.copyFileSync(sourcePath, outputPath);
  }
  return relativePath.split(path.sep).join("/");
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

async function main() {
  fs.rmSync(outputDir, { recursive: true, force: true });
  const sourceFiles = listFiles(sourceDir).filter((file) => !file.endsWith(".test.js"));
  const builtFiles = [];
  for (const file of sourceFiles) builtFiles.push(await buildFile(file));
  builtFiles.sort();

  const { version } = JSON.parse(fs.readFileSync(path.join(sourceDir, "manifest.json"), "utf8"));
  const zipPath = path.join(distDir, `qts-extension-${version}.zip`);
  const zip = createZip(builtFiles.map((name) => ({
    name,
    data: fs.readFileSync(path.join(outputDir, name)),
  })));
  fs.writeFileSync(zipPath, zip);

  const sizeOf = (files, dir) => files.reduce((size, file) => size + fs.statSync(path.join(dir, file)).size, 0);
  const sourceSize = sizeOf(sourceFiles.map((file) => path.relative(sourceDir, file)), sourceDir);
  console.log(`Built ${builtFiles.length} files into ${path.relative(root, outputDir)}`);
  console.log(`Size: ${Math.round(sourceSize / 1024)} KB -> ${Math.round(sizeOf(builtFiles, outputDir) / 1024)} KB`);
  console.log(`Zip: ${path.relative(root, zipPath)} (${Math.round(zip.length / 1024)} KB)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
