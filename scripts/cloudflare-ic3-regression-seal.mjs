import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const IC3_SEALED_PRODUCTION_SHA = '9cc5b3ef9757dc76266d1423e7056af8d332d8af';

// These are the production/runtime inputs that materially define the IC3 listing path.
// Proof-only files are intentionally excluded: changing CI must not invalidate an
// already-proven runtime implementation, while any production-path drift fails over to
// a fresh measured A/B proof with the permanent 5% gate unchanged.
export const IC3_SEALED_RUNTIME_PATHS = Object.freeze([
  'worker/import-scan-entry.js',
  'worker/ingestion/scan-consumer.js',
  'worker/ingestion/initial-construction-progress.js',
  'worker/ingestion/yupoo-listing.js',
  'worker/ingestion/providers/yupoo.js',
  'worker/ingestion/yupoo-preview-seed.js',
  'worker/runtime-identity.js',
  'src/catalog-provider/provider-contract.js',
  'src/catalog-provider/yupoo-source.js',
  'wrangler.import-scan.jsonc',
  'package.json',
  'package-lock.json'
]);

export const IC3_SEALED_PRODUCTION_EVIDENCE = Object.freeze({
  baselineMs: 106416,
  fanoutMs: 96591,
  improvementPct: 9.2,
  speedupRatio: 1.1,
  productCount: 6111,
  identityMatch: true,
  taxonomyMatch: true,
  baselinePages: 125,
  fanoutPages: 71,
  baselineRequests: 452,
  fanoutRequests: 342,
  baselineMaxActive: 4,
  fanoutMaxActive: 4,
  progressiveBatches: 1,
  progressiveItems: 48,
  requestConcurrency: 4,
  minimumImprovementPct: 5
});

function normalizedChangedPaths(changedPaths = []) {
  return [
    ...new Set(
      changedPaths
        .map((value) => String(value || '').trim().replaceAll('\\', '/'))
        .filter(Boolean)
    )
  ].sort();
}

export function classifyIc3RegressionSeal(changedPaths = []) {
  const normalized = normalizedChangedPaths(changedPaths);
  return {
    implementationSealed: normalized.length === 0,
    changedPathCount: normalized.length
  };
}

export async function inspectIc3RegressionSeal() {
  if (!/^[a-f0-9]{40}$/.test(IC3_SEALED_PRODUCTION_SHA)) {
    throw new Error('ic3_sealed_production_sha_invalid');
  }
  if (!IC3_SEALED_RUNTIME_PATHS.length) throw new Error('ic3_sealed_runtime_paths_missing');

  const { stdout } = await execFileAsync(
    'git',
    [
      'diff',
      '--name-only',
      `${IC3_SEALED_PRODUCTION_SHA}..HEAD`,
      '--',
      ...IC3_SEALED_RUNTIME_PATHS
    ],
    { encoding: 'utf8', maxBuffer: 512_000, timeout: 15_000 }
  );

  const classification = classifyIc3RegressionSeal(String(stdout || '').split(/\r?\n/));
  return {
    ic3RegressionSeal: classification.implementationSealed ? 'passed' : 'drift',
    sealedProductionSha: IC3_SEALED_PRODUCTION_SHA,
    ...classification,
    referenceImprovementPct: IC3_SEALED_PRODUCTION_EVIDENCE.improvementPct,
    minimumImprovementPct: IC3_SEALED_PRODUCTION_EVIDENCE.minimumImprovementPct,
    privateIdentifiersExposed: false
  };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  inspectIc3RegressionSeal()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error) => {
      console.error(String(error?.message || error).slice(0, 120));
      process.exitCode = 1;
    });
}
