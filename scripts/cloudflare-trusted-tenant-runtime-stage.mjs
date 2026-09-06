import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CloudflarePlatformError,
  queryD1Batch,
  uploadTenantCatalogWorker
} from '../worker/cloudflare-platform.js';
import { TENANT_CATALOG_RUNTIME_VERSION } from '../worker/tenant-catalog-runtime.js';

const DEFAULT_DISPATCH_NAMESPACE = 'catalog-engine-production';
const DEFAULT_LIMIT = 1;
const MAX_LIMIT = 2;
const MAX_AUTOMATIC_ATTEMPTS = 6;
const TENANT_ID_PATTERN = /^t_[a-f0-9]{20}$/;
const RESOURCE_PATTERN = /^[a-z0-9][a-z0-9_-]{1,62}$/i;
const DATABASE_ID_PATTERN = /^[a-f0-9-]{32,40}$/i;
const SAFE_CODE_PATTERN = /^[a-z0-9_.:-]{1,96}$/i;

function boundedInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function safeCode(error) {
  const candidate = String(
    error instanceof CloudflarePlatformError ? error.code : error?.code || error?.message || ''
  ).trim();
  return SAFE_CODE_PATTERN.test(candidate) ? candidate : 'trusted_runtime_stage_failed';
}

function validateCandidate(row) {
  const candidate = {
    jobId: String(row?.job_id || '').trim(),
    tenantId: String(row?.tenant_id || '').trim(),
    workerScriptName: String(row?.worker_script_name || '').trim(),
    databaseId: String(row?.d1_database_id || '').trim(),
    dispatchNamespace: String(row?.dispatch_namespace || '').trim(),
    store: {
      storeName: String(row?.store_name || '').trim(),
      logoPath: String(row?.logo_path || '').trim(),
      whatsapp: String(row?.whatsapp || '').trim(),
      instagram: String(row?.instagram || '').trim(),
      currency: String(row?.currency || 'BRL').trim(),
      themeKey: String(row?.theme_key || 'premium-dark').trim(),
      primaryColor: String(row?.primary_color || '').trim(),
      secondaryColor: String(row?.secondary_color || '').trim(),
      homeSectionsJson: String(row?.home_sections_json || '[]')
    }
  };
  if (!candidate.jobId) throw new Error('trusted_runtime_job_missing');
  if (!TENANT_ID_PATTERN.test(candidate.tenantId)) throw new Error('trusted_runtime_tenant_invalid');
  if (!RESOURCE_PATTERN.test(candidate.workerScriptName)) {
    throw new Error('trusted_runtime_worker_invalid');
  }
  if (!DATABASE_ID_PATTERN.test(candidate.databaseId)) {
    throw new Error('trusted_runtime_database_invalid');
  }
  if (!RESOURCE_PATTERN.test(candidate.dispatchNamespace)) {
    throw new Error('trusted_runtime_namespace_invalid');
  }
  if (!candidate.store.storeName) throw new Error('trusted_runtime_store_profile_missing');
  return candidate;
}

export const TRUSTED_RUNTIME_STAGE_DISCOVERY_SQL = `SELECT
       j.job_id,
       j.tenant_id,
       p.dispatch_namespace,
       p.worker_script_name,
       p.d1_database_id,
       s.store_name,
       s.logo_path,
       s.whatsapp,
       s.instagram,
       s.currency,
       s.theme_key,
       s.primary_color,
       s.secondary_color,
       s.home_sections_json
  FROM tenant_runtime_jobs j
  JOIN tenant_data_plane_provider_state p ON p.tenant_id=j.tenant_id
  JOIN tenant_catalog_instances i ON i.tenant_id=j.tenant_id
  JOIN tenant_store_profiles s ON s.tenant_id=j.tenant_id
 WHERE j.target_runtime_version=?1
   AND j.status IN ('pending','failed')
   AND j.attempt_count < ?2
   AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= CURRENT_TIMESTAMP)
   AND i.status='provisioning'
   AND i.schema_version >= 3
   AND p.dispatch_namespace=?3
   AND p.database_status='active'
   AND p.worker_status='active'
   AND p.d1_database_id IS NOT NULL
   AND (
     p.runtime_kind!='catalog' OR
     p.runtime_status NOT IN ('staged','verified') OR
     p.runtime_version < ?1
   )
   AND EXISTS (
     SELECT 1 FROM tenant_verification_jobs v
      WHERE v.tenant_id=j.tenant_id
        AND v.status='success'
   )
   AND EXISTS (
     SELECT 1 FROM tenant_provisioning_runs r
      WHERE r.tenant_id=j.tenant_id
        AND r.current_step='domain'
        AND r.status IN ('running','failed','blocked')
   )
 ORDER BY j.created_at ASC
 LIMIT ?4`;

function publicStoreProfile(store) {
  let homeSections = [];
  try {
    homeSections = JSON.parse(store.homeSectionsJson || '[]');
  } catch {
    homeSections = [];
  }
  const logoPath = String(store.logoPath || '');
  return {
    name: String(store.storeName || '').slice(0, 120),
    logoPath: /^\/[a-z0-9/_\-.]{1,240}$/i.test(logoPath) ? logoPath : null,
    whatsapp: String(store.whatsapp || '').replace(/[^+\d]/g, '').slice(0, 24) || null,
    instagram:
      String(store.instagram || '')
        .replace(/^@/, '')
        .replace(/[^a-z0-9._]/gi, '')
        .slice(0, 40) || null,
    currency: String(store.currency || 'BRL').slice(0, 8),
    themeKey: String(store.themeKey || 'premium-dark').slice(0, 80),
    primaryColor: /^#[a-f0-9]{6}$/i.test(String(store.primaryColor || ''))
      ? store.primaryColor
      : null,
    secondaryColor: /^#[a-f0-9]{6}$/i.test(String(store.secondaryColor || ''))
      ? store.secondaryColor
      : null,
    homeSections: Array.isArray(homeSections)
      ? homeSections.map((item) => String(item).slice(0, 80)).slice(0, 20)
      : []
  };
}

async function claimStage(controlBatch, candidate) {
  const result = await controlBatch([
    {
      sql: `UPDATE tenant_runtime_jobs
               SET status='running', attempt_count=attempt_count+1,
                   started_at=COALESCE(started_at,CURRENT_TIMESTAMP),
                   finished_at=NULL, last_error_code=NULL,
                   updated_at=CURRENT_TIMESTAMP
             WHERE job_id=?1 AND tenant_id=?2
               AND status IN ('pending','failed')
               AND attempt_count < ?3
               AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)`,
      params: [candidate.jobId, candidate.tenantId, MAX_AUTOMATIC_ATTEMPTS]
    },
    {
      sql: `UPDATE tenant_data_plane_provider_state
               SET runtime_status='staging', runtime_last_error_code=NULL,
                   updated_at=CURRENT_TIMESTAMP
             WHERE tenant_id=?1
               AND database_status='active'
               AND worker_status='active'`,
      params: [candidate.tenantId]
    }
  ]);
  return Number(result?.[0]?.meta?.changes || 0) === 1;
}

async function seedRuntimePublicMeta(platform, candidate) {
  const verification = await queryD1Batch({
    ...platform,
    databaseId: candidate.databaseId,
    batch: [
      { sql: 'SELECT COUNT(*) AS total FROM catalog_products', params: [] },
      {
        sql: `SELECT COUNT(*) AS total
                FROM data_plane_identity
               WHERE tenant_id=?1 AND schema_version>=3`,
        params: [candidate.tenantId]
      }
    ]
  });
  const products = Number(verification?.[0]?.results?.[0]?.total || 0);
  const identity = Number(verification?.[1]?.results?.[0]?.total || 0);
  if (products < 1 || identity !== 1) {
    throw new Error('trusted_runtime_catalog_not_ready');
  }

  const store = publicStoreProfile(candidate.store);
  const navigation = [
    { id: 'clubs', label: 'Clubes', kind: 'teams' },
    { id: 'national-teams', label: 'Seleções', kind: 'national_teams' },
    { id: 'new-arrivals', label: 'Novidades', kind: 'facet', facetId: 'new-arrivals' },
    { id: 'retro', label: 'Retrô', kind: 'facet', facetId: 'retro' }
  ];
  await queryD1Batch({
    ...platform,
    databaseId: candidate.databaseId,
    batch: [
      {
        sql: `INSERT INTO catalog_meta (key,value_json,updated_at)
              VALUES ('store',?1,CURRENT_TIMESTAMP)
              ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=CURRENT_TIMESTAMP`,
        params: [JSON.stringify(store)]
      },
      {
        sql: `INSERT INTO catalog_meta (key,value_json,updated_at)
              VALUES ('storage',?1,CURRENT_TIMESTAMP)
              ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=CURRENT_TIMESTAMP`,
        params: [JSON.stringify({ mode: 'edge-proxy' })]
      },
      {
        sql: `INSERT INTO catalog_meta (key,value_json,updated_at)
              VALUES ('navigation',?1,CURRENT_TIMESTAMP)
              ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=CURRENT_TIMESTAMP`,
        params: [JSON.stringify(navigation)]
      },
      {
        sql: `INSERT INTO catalog_meta (key,value_json,updated_at)
              VALUES ('stats',?1,CURRENT_TIMESTAMP)
              ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=CURRENT_TIMESTAMP`,
        params: [JSON.stringify({ products })]
      }
    ]
  });
  return products;
}

async function finishStage(controlBatch, candidate, upload) {
  const result = await controlBatch([
    {
      sql: `UPDATE tenant_data_plane_provider_state
               SET runtime_kind='catalog', runtime_status='staged', runtime_version=?2,
                   runtime_verified_at=NULL, runtime_last_error_code=NULL,
                   worker_version=COALESCE(?3,worker_version),
                   last_checked_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
             WHERE tenant_id=?1`,
      params: [candidate.tenantId, TENANT_CATALOG_RUNTIME_VERSION, upload.versionId || null]
    },
    {
      sql: `UPDATE tenant_runtime_jobs
               SET status='staged', staged_at=CURRENT_TIMESTAMP,
                   next_attempt_at=CURRENT_TIMESTAMP, finished_at=NULL,
                   last_error_code=NULL, updated_at=CURRENT_TIMESTAMP
             WHERE job_id=?1 AND tenant_id=?2 AND status='running'`,
      params: [candidate.jobId, candidate.tenantId]
    }
  ]);
  if (Number(result?.[1]?.meta?.changes || 0) !== 1) {
    throw new Error('trusted_runtime_stage_promotion_failed');
  }
}

async function failStage(controlBatch, candidate, code) {
  await controlBatch([
    {
      sql: `UPDATE tenant_runtime_jobs
               SET status='failed', finished_at=CURRENT_TIMESTAMP,
                   next_attempt_at=datetime(CURRENT_TIMESTAMP,'+10 minutes'),
                   last_error_code=?3, updated_at=CURRENT_TIMESTAMP
             WHERE job_id=?1 AND tenant_id=?2`,
      params: [candidate.jobId, candidate.tenantId, code]
    },
    {
      sql: `UPDATE tenant_data_plane_provider_state
               SET runtime_status='error', runtime_last_error_code=?2,
                   last_checked_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
             WHERE tenant_id=?1`,
      params: [candidate.tenantId, code]
    }
  ]);
}

export async function runTrustedTenantRuntimeStaging(
  env = process.env,
  { controlBatch: controlBatchOverride, uploadWorker = uploadTenantCatalogWorker, limit } = {}
) {
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const apiToken = String(env.CLOUDFLARE_API_TOKEN || '').trim();
  const dispatchNamespace = String(
    env.CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE || DEFAULT_DISPATCH_NAMESPACE
  ).trim();
  const controlDatabaseId = String(env.CATALOG_CONTROL_DATABASE_ID || '').trim();
  if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new Error('trusted_runtime_account_invalid');
  if (apiToken.length < 20) throw new Error('trusted_runtime_token_invalid');
  if (!RESOURCE_PATTERN.test(dispatchNamespace)) throw new Error('trusted_runtime_namespace_invalid');
  if (!DATABASE_ID_PATTERN.test(controlDatabaseId)) {
    throw new Error('trusted_runtime_control_database_invalid');
  }

  const boundedLimit = boundedInteger(
    limit ?? env.TRUSTED_RUNTIME_STAGE_LIMIT,
    DEFAULT_LIMIT,
    MAX_LIMIT
  );
  const platform = { accountId, apiToken, dispatchNamespace };
  const controlBatch =
    controlBatchOverride ||
    ((batch) => queryD1Batch({ ...platform, databaseId: controlDatabaseId, batch }));
  const discovery = await controlBatch([
    {
      sql: TRUSTED_RUNTIME_STAGE_DISCOVERY_SQL,
      params: [
        TENANT_CATALOG_RUNTIME_VERSION,
        MAX_AUTOMATIC_ATTEMPTS,
        dispatchNamespace,
        boundedLimit
      ]
    }
  ]);
  const candidates = (discovery?.[0]?.results || []).map(validateCandidate);
  const outcomes = [];

  for (const candidate of candidates) {
    if (!(await claimStage(controlBatch, candidate))) {
      outcomes.push({ outcome: 'skipped' });
      continue;
    }
    try {
      const products = await seedRuntimePublicMeta(platform, candidate);
      const upload = await uploadWorker({
        ...platform,
        scriptName: candidate.workerScriptName,
        databaseId: candidate.databaseId,
        tenantId: candidate.tenantId
      });
      await finishStage(controlBatch, candidate, upload);
      outcomes.push({ outcome: 'staged', products });
    } catch (error) {
      const code = safeCode(error);
      await failStage(controlBatch, candidate, code);
      outcomes.push({ outcome: 'failed', safeErrorCode: code });
    }
  }

  return {
    trustedTenantRuntimeStagingCompleted: true,
    trustedCiOwnsRuntimeUpload: true,
    recurringSyncAutomationEnabled: false,
    selected: candidates.length,
    staged: outcomes.filter((entry) => entry.outcome === 'staged').length,
    skipped: outcomes.filter((entry) => entry.outcome === 'skipped').length,
    failed: outcomes.filter((entry) => entry.outcome === 'failed').length,
    productCounts: outcomes
      .filter((entry) => entry.outcome === 'staged')
      .map((entry) => entry.products),
    safeErrorCodes: outcomes
      .filter((entry) => entry.outcome === 'failed')
      .map((entry) => entry.safeErrorCode)
  };
}

async function main() {
  const wrangler = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  if (String(wrangler.vars?.TENANT_SYNC_AUTOMATION_ENABLED || '') !== '0') {
    throw new Error('trusted_runtime_requires_recurring_sync_off');
  }
  const controlDatabaseId = String(
    wrangler.d1_databases?.find((entry) => entry.binding === 'CATALOG_DB')?.database_id || ''
  ).trim();
  const evidence = await runTrustedTenantRuntimeStaging({
    ...process.env,
    CATALOG_CONTROL_DATABASE_ID: controlDatabaseId
  });
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.failed > 0) throw new Error('trusted_runtime_stage_failure');
}

const isDirectExecution =
  Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirectExecution) await main();