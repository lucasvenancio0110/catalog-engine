import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);
const ZIP_ENTRY =
  /^(64x64|128x128|256x256|512x512)\/([a-z0-9][a-z0-9-]{0,119})\.football-logos\.cc\.png$/;
const TARGET_SIZE = 256;
const TARGET_DIRECTORY = `${TARGET_SIZE}x${TARGET_SIZE}`;
const GENERATED_ASSET = /^tc_[a-f0-9]{20}\.png$/;

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function parseCrestZipEntry(entry) {
  const value = String(entry || '');
  if (!value || value.startsWith('/') || value.includes('\\') || value.split('/').includes('..')) {
    throw new Error(`team_crest_archive_path_rejected:${value}`);
  }
  if (value.endsWith('/')) return null;
  const match = ZIP_ENTRY.exec(value);
  if (!match) throw new Error(`team_crest_archive_entry_rejected:${value}`);
  return { size: match[1], slug: match[2], selected: match[1] === TARGET_DIRECTORY };
}

export function crestAssetId(buffer) {
  return `tc_${sha256(buffer).slice(0, 20)}`;
}

async function listArchiveEntries(archivePath) {
  const { stdout } = await execFileAsync('unzip', ['-Z1', archivePath], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024
  });
  return stdout.split(/\r?\n/).filter(Boolean);
}

async function readArchiveEntry(archivePath, entry) {
  const { stdout } = await execFileAsync('unzip', ['-p', archivePath, entry], {
    encoding: 'buffer',
    maxBuffer: 16 * 1024 * 1024
  });
  return Buffer.from(stdout);
}

async function normalizePng(buffer, label) {
  if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error(`team_crest_png_signature_invalid:${label}`);
  }
  const image = sharp(buffer, { failOn: 'error', limitInputPixels: TARGET_SIZE * TARGET_SIZE });
  const [metadata, stats] = await Promise.all([image.metadata(), image.stats()]);
  if (
    metadata.format !== 'png' ||
    metadata.width !== TARGET_SIZE ||
    metadata.height !== TARGET_SIZE ||
    metadata.pages > 1
  ) {
    throw new Error(`team_crest_png_contract_invalid:${label}`);
  }
  return {
    buffer: await image.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer(),
    opaque: Boolean(stats.isOpaque)
  };
}

export async function importTeamCrests({
  sourceDir = resolve(process.cwd(), 'upload'),
  outputDir = resolve(process.cwd(), 'src/assets/team-crests'),
  manifestPath = resolve(process.cwd(), 'src/catalog/team-crest-manifest.json')
} = {}) {
  const archiveNames = (await readdir(sourceDir))
    .filter((name) => name.toLowerCase().endsWith('.zip'))
    .sort((a, b) => a.localeCompare(b));
  if (!archiveNames.length) throw new Error('team_crest_archives_missing');

  const uniqueArchives = new Map();
  for (const name of archiveNames) {
    const archivePath = resolve(sourceDir, name);
    const fingerprint = sha256(await readFile(archivePath));
    if (!uniqueArchives.has(fingerprint)) uniqueArchives.set(fingerprint, { name, archivePath });
  }

  const bySlug = new Map();
  for (const [archiveFingerprint, archive] of [...uniqueArchives.entries()].sort((a, b) =>
    a[1].name.localeCompare(b[1].name)
  )) {
    const entries = await listArchiveEntries(archive.archivePath);
    const parsedEntries = entries.map((entry) => ({ entry, parsed: parseCrestZipEntry(entry) }));
    for (const { entry, parsed } of parsedEntries) {
      if (!parsed?.selected) continue;
      const normalized = await normalizePng(
        await readArchiveEntry(archive.archivePath, entry),
        `${archive.name}:${entry}`
      );
      const contentHash = sha256(normalized.buffer);
      const existing = bySlug.get(parsed.slug);
      if (existing && existing.contentHash !== contentHash) {
        throw new Error(`team_crest_slug_conflict:${parsed.slug}`);
      }
      bySlug.set(parsed.slug, {
        assetId: crestAssetId(normalized.buffer),
        archiveFingerprint,
        buffer: normalized.buffer,
        contentHash,
        opaque: normalized.opaque
      });
    }
  }

  const assets = new Map();
  for (const entry of bySlug.values()) assets.set(entry.assetId, entry.buffer);
  await mkdir(outputDir, { recursive: true });
  await mkdir(dirname(manifestPath), { recursive: true });

  for (const [assetId, buffer] of [...assets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    await writeFile(resolve(outputDir, `${assetId}.png`), buffer);
  }
  const expectedFiles = new Set([...assets.keys()].map((assetId) => `${assetId}.png`));
  for (const name of await readdir(outputDir)) {
    if (GENERATED_ASSET.test(name) && !expectedFiles.has(name))
      await unlink(resolve(outputDir, name));
  }

  const manifest = {
    schemaVersion: 1,
    masterSize: TARGET_SIZE,
    teamCount: bySlug.size,
    assetCount: assets.size,
    opaqueAssetCount: new Set(
      [...bySlug.values()].filter((entry) => entry.opaque).map((entry) => entry.assetId)
    ).size,
    provenance: {
      delivery: 'project-owner-provided-archives',
      commercialAuthorization: 'confirmed-by-project-owner',
      confirmedOn: '2026-09-01',
      originalArchivesCommitted: false
    },
    archiveFingerprints: [...uniqueArchives.keys()].sort(),
    assets: Object.fromEntries(
      [...bySlug.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([slug, entry]) => [slug, entry.assetId])
    )
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return {
    archivesReceived: archiveNames.length,
    uniqueArchives: uniqueArchives.size,
    teamCount: bySlug.size,
    assetCount: assets.size,
    outputBytes: [...assets.values()].reduce((total, buffer) => total + buffer.length, 0)
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const summary = await importTeamCrests();
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

export const teamCrestImportContract = Object.freeze({
  targetSize: TARGET_SIZE,
  targetDirectory: TARGET_DIRECTORY,
  generatedAssetPattern: GENERATED_ASSET.source,
  script: basename(fileURLToPath(import.meta.url))
});
