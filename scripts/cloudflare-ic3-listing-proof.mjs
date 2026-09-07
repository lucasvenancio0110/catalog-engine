import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { queryD1Batch } from '../worker/cloudflare-platform.js';
import { yupooIngestionProvider } from '../worker/ingestion/providers/yupoo.js';
import {
  IC3_LISTING_PROOF_BASELINE_SHA,
  IC3_LISTING_PROOF_CONTRACT_VERSION,
  IC3_LISTING_PROOF_MIN_IMPROVEMENT_PCT,
  IC3_LISTING_PROOF_REQUEST_CONCURRENCY
} from '../worker/ingestion/ic3-listing-proof-contract.js';

const execFileAsync = promisify(execFile);
const DEFAULT_MERCHANT = 'CROCCODILOS';
const SOURCE_KEY = 'primary';
const DISPATCH_NAMESPACE = 'catalog-engine-production';
const MAX_SCAN_PAGES = 500;

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name}_missing`);
  return value;
}

async function loadRuntimeConfig() {
  const raw = await fs.readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const config = JSON.parse(raw);
  const database = (config.d1_databases || []).find((entry) => entry?.binding === 'CATALOG_DB');
  if (!database?.database_id) throw new Error('ic3_control_db_config_missing');
  return {
    databaseId: String(database.database_id),
    initialImportEnabled: String(config.vars?.TENANT_IMPORT_AUTOMATION_ENABLED || '') === '1',
    recurringSyncEnabled: String(config.vars?.TENANT_SYNC_AUTOMATION_ENABLED || '') === '1',
    activeSyncCohort: String(config.vars?.TENANT_SYNC_ACTIVE_COHORT || ''),
    maxSyncJobsPerTick: String(config.vars?.TENANT_SYNC_MAX_JOBS_PER_TICK || '')
  };
}

async function loadMerchantSource({ accountId, apiToken, databaseId, merchant }) {
  const result = await queryD1Batch({
    accountId,
    apiToken,
    dispatchNamespace: DISPATCH_NAMESPACE,
    databaseId,
    batch: [
      {
        sql: `SELECT COUNT(*) AS source_count,
                    MAX(s.provider) AS provider,
                    MAX(s.source_url) AS source_url
               FROM supplier_sources s
               JOIN catalog_tenants t
                 ON t.tenant_id=s.tenant_id
               JOIN tenant_source_connections c
                 ON c.tenant_id=s.tenant_id
                AND c.source_key=s.source_key
                AND c.provider=s.provider
                AND c.status='active'
              WHERE UPPER(t.display_name)=UPPER(?1)
                AND t.status='active'
                AND s.source_key=?2
                AND s.status='active'`,
        params: [merchant, SOURCE_KEY]
      }
    ]
  });
  const row = result?.[0]?.results?.[0] || null;
  if (Number(row?.source_count || 0) !== 1) throw new Error('ic3_proof_source_not_unique');
  const provider = String(row?.provider || '').trim().toLowerCase();
  const sourceUrl = String(row?.source_url || '').trim();
  if (provider !== 'yupoo' || !sourceUrl) throw new Error('ic3_proof_provider_unsupported');
  return { provider, sourceUrl };
}

function identityDigest(scan) {
  const ids = (scan?.items || [])
    .map((item) => String(item?.publicProductId || ''))
    .filter(Boolean)
    .sort();
  return createHash('sha256').update(ids.join('\n')).digest('hex');
}

function totalPages(scan) {
  return Math.max(0, Number(scan?.stats?.rootPages || 0)) + Math.max(0, Number(scan?.stats?.categoryPages || 0));
}

function safeDuration(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function safeProviderCode(error, fallback) {
  const code = String(error?.code || error?.message || '').trim().toLowerCase();
  if (/^(supplier|catalog_provider)_[a-z0-9_]{1,100}$/.test(code)) return code;
  return fallback;
}

async function loadBaselineScanner() {
  if (!/^[a-f0-9]{40}$/.test(IC3_LISTING_PROOF_BASELINE_SHA)) {
    throw new Error('ic3_baseline_sha_invalid');
  }
  const { stdout } = await execFileAsync(
    'git',
    ['show', `${IC3_LISTING_PROOF_BASELINE_SHA}:worker/ingestion/yupoo-listing.js`],
    { encoding: 'utf8', maxBuffer: 2_000_000, timeout: 15_000 }
  );
  if (!stdout.includes('scanYupooListingIndex')) throw new Error('ic3_baseline_scanner_missing');
  const directory = fileURLToPath(new URL('../worker/ingestion/', import.meta.url));
  const filename = `.ic3-baseline-${process.pid}-${Date.now()}.mjs`;
  const filepath = path.join(directory, filename);
  await fs.writeFile(filepath, stdout, 'utf8');
  try {
    const module = await import(`${pathToFileURL(filepath).href}?v=${Date.now()}`);
    if (typeof module.scanYupooListingIndex !== 'function') {
      throw new Error('ic3_baseline_scanner_missing');
    }
    return { scan: module.scanYupooListingIndex, filepath };
  } catch (error) {
    await fs.rm(filepath, { force: true }).catch(() => {});
    throw error;
  }
}

async function timedScan(scan, sourceUrl, options, failureCode) {
  const started = performance.now();
  try {
    const result = await scan(sourceUrl, options);
    return { result, elapsedMs: safeDuration(performance.now() - started) };
  } catch (error) {
    throw new Error(safeProviderCode(error, failureCode));
  }
}

export function evaluateIc3ProductionProof({ current, baseline, currentMs, baselineMs, runtime }) {
  const currentCount = Number(current?.items?.length || 0);
  const baselineCount = Number(baseline?.items?.length || 0);
  const currentDuration = safeDuration(currentMs);
  const baselineDuration = safeDuration(baselineMs);
  const improvementPct =
    baselineDuration > 0
      ? Number((((baselineDuration - currentDuration) / baselineDuration) * 100).toFixed(1))
      : 0;
  const speedupRatio =
    currentDuration > 0 ? Number((baselineDuration / currentDuration).toFixed(2)) : 0;
  const identityMatch =
    currentCount > 0 && currentCount === baselineCount && identityDigest(current) === identityDigest(baseline);
  const taxonomyMatch = Number(current?.taxonomy?.length || 0) === Number(baseline?.taxonomy?.length || 0);
  const checks = {
    currentComplete: current?.complete === true,
    baselineComplete: baseline?.complete === true,
    productCountObserved: currentCount > 0,
    identityMatch,
    taxonomyMatch,
    boundedConcurrency:
      Number(current?.stats?.requestConcurrency || 0) === IC3_LISTING_PROOF_REQUEST_CONCURRENCY,
    measuredImprovement: improvementPct >= IC3_LISTING_PROOF_MIN_IMPROVEMENT_PCT,
    initialImportEnabled: runtime?.initialImportEnabled === true,
    recurringSyncDisabled: runtime?.recurringSyncEnabled === false,
    syncCohortEmpty: String(runtime?.activeSyncCohort || '') === '',
    syncTickBounded: String(runtime?.maxSyncJobsPerTick || '') === '1'
  };
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    currentMs: currentDuration,
    baselineMs: baselineDuration,
    improvementPct,
    speedupRatio,
    productCount: currentCount,
    identityMatch,
    taxonomyMatch,
    currentPages: totalPages(current),
    baselinePages: totalPages(baseline)
  };
}

export function safeIc3Evidence(merchant, evaluation) {
  const evidence = {
    ic3ProductionProof: evaluation.passed ? 'passed' : 'pending',
    contractVersion: IC3_LISTING_PROOF_CONTRACT_VERSION,
    merchant: String(merchant || DEFAULT_MERCHANT).slice(0, 80),
    baselineMs: evaluation.baselineMs,
    fanoutMs: evaluation.currentMs,
    improvementPct: evaluation.improvementPct,
    speedupRatio: evaluation.speedupRatio,
    productCount: evaluation.productCount,
    identityMatch: evaluation.identityMatch,
    taxonomyMatch: evaluation.taxonomyMatch,
    baselinePages: evaluation.baselinePages,
    fanoutPages: evaluation.currentPages,
    requestConcurrency: IC3_LISTING_PROOF_REQUEST_CONCURRENCY,
    minimumImprovementPct: IC3_LISTING_PROOF_MIN_IMPROVEMENT_PCT,
    initialImportEnabled: evaluation.checks.initialImportEnabled,
    recurringIntelligentSyncEnabled: !evaluation.checks.recurringSyncDisabled
  };
  const serialized = JSON.stringify(evidence);
  const privateIdentifiersExposed =
    /https?:\/\/|yupoo\.com|source_url|album_source_id|source_category_id|database_id|dispatch_namespace|worker_script|t_[a-f0-9]{20}/i.test(
      serialized
    );
  return { ...evidence, privateIdentifiersExposed };
}

export async function runIc3ProductionProof() {
  const merchant = String(process.env.IC3_MERCHANT_DISPLAY_NAME || DEFAULT_MERCHANT).trim();
  const accountId = requiredEnv('CLOUDFLARE_ACCOUNT_ID');
  const apiToken = requiredEnv('CLOUDFLARE_API_TOKEN');
  const runtime = await loadRuntimeConfig();
  const source = await loadMerchantSource({
    accountId,
    apiToken,
    databaseId: runtime.databaseId,
    merchant
  });
  const baselineModule = await loadBaselineScanner();
  try {
    // Run the production Provider Engine path first. The old scanner runs second and therefore
    // receives any incidental upstream/CDN warming advantage; an IC3 win remains conservative.
    const current = await timedScan(
      yupooIngestionProvider.scanListingIndex,
      source.sourceUrl,
      {
        maxRootPages: MAX_SCAN_PAGES,
        maxCategoryPages: MAX_SCAN_PAGES,
        categoryConcurrency: IC3_LISTING_PROOF_REQUEST_CONCURRENCY,
        pageConcurrency: IC3_LISTING_PROOF_REQUEST_CONCURRENCY
      },
      'ic3_current_scan_failed'
    );
    const baseline = await timedScan(
      baselineModule.scan,
      source.sourceUrl,
      {
        maxRootPages: MAX_SCAN_PAGES,
        maxCategoryPages: MAX_SCAN_PAGES,
        categoryConcurrency: IC3_LISTING_PROOF_REQUEST_CONCURRENCY
      },
      'ic3_baseline_scan_failed'
    );
    const evaluation = evaluateIc3ProductionProof({
      current: current.result,
      baseline: baseline.result,
      currentMs: current.elapsedMs,
      baselineMs: baseline.elapsedMs,
      runtime
    });
    const evidence = safeIc3Evidence(merchant, evaluation);
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    if (evidence.privateIdentifiersExposed) throw new Error('ic3_proof_private_evidence_detected');
    if (!evaluation.passed) throw new Error('ic3_listing_improvement_not_proven');
    return evidence;
  } finally {
    await fs.rm(baselineModule.filepath, { force: true }).catch(() => {});
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  runIc3ProductionProof().catch((error) => {
    console.error(String(error?.message || error).slice(0, 120));
    process.exitCode = 1;
  });
}
