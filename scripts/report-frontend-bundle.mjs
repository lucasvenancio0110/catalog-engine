import { gzipSync } from 'node:zlib';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = 'dist';
const trackedExtensions = new Set(['.js', '.css']);

function extension(path) {
  const index = path.lastIndexOf('.');
  return index === -1 ? '' : path.slice(index);
}

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(path));
    else if (trackedExtensions.has(extension(entry.name))) files.push(path);
  }
  return files;
}

const files = await collect(root);
const assets = [];
for (const path of files) {
  const contents = await readFile(path);
  assets.push({
    file: relative(root, path).replaceAll('\\', '/'),
    rawBytes: contents.byteLength,
    gzipBytes: gzipSync(contents, { level: 9 }).byteLength
  });
}
assets.sort((a, b) => b.gzipBytes - a.gzipBytes || a.file.localeCompare(b.file));

const totals = assets.reduce(
  (sum, asset) => ({
    rawBytes: sum.rawBytes + asset.rawBytes,
    gzipBytes: sum.gzipBytes + asset.gzipBytes
  }),
  { rawBytes: 0, gzipBytes: 0 }
);

console.log(JSON.stringify({
  assetCount: assets.length,
  totals,
  assets
}, null, 2));
