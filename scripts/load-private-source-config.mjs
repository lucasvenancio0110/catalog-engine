import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeYupooCatalogUrl } from '../src/domain/tenant-source-connection.js';

export function extractPrivateSourceUrl(payload) {
  const batches = Array.isArray(payload) ? payload : [payload];
  const rows = batches.flatMap((batch) => batch?.results || batch?.result || []);
  const sourceUrl = rows.find((row) => row?.source_url)?.source_url;
  if (!sourceUrl) throw new Error('No active supplier source is configured for this tenant/source key.');
  return normalizeYupooCatalogUrl(sourceUrl).canonicalUrl;
}

export function writeGitHubSourceEnv(sourceUrl, { envFile = process.env.GITHUB_ENV, stdout = process.stdout } = {}) {
  if (!envFile) throw new Error('GITHUB_ENV is not available.');
  const canonicalUrl = normalizeYupooCatalogUrl(sourceUrl).canonicalUrl;
  stdout.write(`::add-mask::${canonicalUrl}\n`);
  fs.appendFileSync(envFile, `SOURCE_URL=${canonicalUrl}\n`);
  stdout.write('Loaded supplier source from private tenant configuration.\n');
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error('Pass the Wrangler JSON result file path.');
  const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  writeGitHubSourceEnv(extractPrivateSourceUrl(payload));
}
