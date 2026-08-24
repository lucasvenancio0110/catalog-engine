import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CloudflarePlatformError,
  queryD1Batch,
  uploadTenantCatalogWorker
} from '../worker/cloudflare-platform.js';
import { TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION } from '../worker/tenant-data-plane-command.js';
import { TENANT_DATA_PLANE_SCHEMA_VERSION } from '../worker/tenant-data-plane-schema-v5.js';

const DEFAULT_DISPATCH_NAMESPACE = 'catalog-engine-production';
const DEFAULT_MAX_TENANTS = 100;
const MAX_TENANTS = 200;
const TENANT_ID_PATTERN = /^t_[a-f0-9]{20}$/;
const WORKER_SCRIPT_PATTERN = /^[a-z0-9][a-z0-9_-]{1,62}$/i;
const DATABASE_ID_PATTERN = /^[a-f0-9-]{32,40}$/i;
const NAMESPACE_PATTERN = /^[a-z0-9][a-z0-9_-]{1,62}$/i;
const ACTIVE_IMPORT_STATUSES = "'pending','queued','scanning','details','finalizing'";

export const FLEET_PREPARATION_DISCOVERY_SQL = `SELECT DISTINCT
              p.tenant_id, p.worker_script_name, p.d1_database_id, p.dispatch_namespace
         FROM tenant_data_plane_provider_state p
         JOIN tenant_catalog_instances i ON i.tenant_id=p.tenant_id
        WHERE i.status='ready'
          AND i.schema_version < ?1
          AND p.database_status='active'
          AND p.worker_status='active'
          AND p.d1_database_id IS NOT NULL
          AND p.dispatch_namespace=?2
          AND p.migration_command_version < ?3
          AND EXISTS (
            SELECT 1 FROM supplier_sources s
             WHERE s.tenant_id=p.tenant_id
               AND s.status='active'
               AND s.source_key<>'fleet-canary'
          )
          AND NOT EXISTS (
            SELECT 1 FROM tenant_import_jobs j
             WHERE j.tenant_id=p.tenant_id
               AND j.status IN (${ACTIVE_IMPORT_STATUSES})
          )
        ORDER BY p.tenant_id ASC
        LIMIT ?4`;

export const FLEET_PREPARATION_ELIGIBILITY_SQL = `SELECT COUNT(*) AS total
         FROM tenant_data_plane_provider_state p
         JOIN tenant_catalog_instances i ON i.tenant_id=p.tenant_id
        WHERE p.tenant_id=?1
          AND p.worker_script_name=?2
          AND p.d1_database_id=?3
          AND p.dispatch_namespace=?4
          AND p.database_status='active'
          AND p.worker_status='active'
          AND i.status='ready'
          AND i.schema_version < ?5
          AND p.migration_command_version < ?6
          AND EXISTS (
            SELECT 1 FROM supplier_sources s
             WHERE s.tenant_id=p.tenant_id
               AND s.status='active'
               AND (CAST(?7 AS INTEGER)=1 OR s.source_key<>'fleet-canary')
          )
          AND NOT EXISTS (
            SELECT 1 FROM tenant_import_jobs j
             WHERE j.tenant_id=p.tenant_id
               AND j.status IN (${ACTIVE_IMPORT_STATUSES})
          )`;

export const FLEET_PREPARATION_PROMOTION_SQL = `UPDATE tenant_data_plane_provider_state
          SET migration_command_version=?6,
              migration_command_prepared_at=CURRENT_TIMESTAMP,
              migration_command_last_error_code=NULL,
              worker_version=COALESCE(?8,worker_version),
              last_checked_at=CURRENT_TIMESTAMP,
              updated_at=CURRENT_TIMESTAMP
        WHERE tenant_id=?1
          AND worker_script_name=?2
          AND d1_database_id=?3
          AND dispatch_namespace=?4
          AND database_status='active'
          AND worker_status='active'
          AND migration_command_version < ?6
          AND EXISTS (
            SELECT 1 FROM tenant_catalog_instances i
             WHERE i.tenant_id=?1
               AND i.status='ready'
               AND i.schema_version < ?5
          )
          AND EXISTS (
            SELECT 1 FROM supplier_sources s
             WHERE s.tenant_id=?1
               AND s.status='active'
               AND (CAST(?7 AS INTEGER)=1 OR s.source_key<>'fleet-canary')
          )
          AND NOT EXISTS (
            SELECT 1 FROM tenant_import_jobs j
             WHERE j.tenant_id=?1
               AND j.status IN (${ACTIVE_IMPORT_STATUSES})
          )`;

export const FLEET_PREPARATION_FAILURE_SQL = `UPDATE tenant_data_plane_provider_state
          SET migration_command_last_error_code=?5,
              last_checked_at=CURRENT_TIMESTAMP,
              updated_at=CURRENT_TIMESTAMP
        WHERE tenant_id=?1
          AND worker_script_name=?2
          AND d1_database_id=?3
          AND dispatch_namespace=?4
          AND migration_command_version < ?6`;

function positiveBoundedInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function validateCandidate(candidate) {
  const normalized = {
    tenantId: String(candidate?.tenant_id || candidate?.tenantId || '').trim(),
    workerScriptName: String(
      candidate?.worker_script_name || candidate?.workerScriptName || ''
    ).trim(),
    databaseId: String(candidate?.d1_database_id || candidate?.databaseId || '').trim(),
    dispatchNamespace: String(
      candidate?.dispatch_namespace || candidate?.dispatchNamespace || ''
    ).trim()
  };
  if (!TENANT_ID_PATTERN.test(normalized.tenantId)) {
    throw new Error('fleet_preparation_tenant_invalid');
  }
  if (!WORKER_SCRIPT_PATTERN.test(normalized.workerScriptName)) {
    throw new Error('fleet_preparation_worker_invalid');
  }
  if (!DATABASE_ID_PATTERN.test(normalized.databaseId)) {
    throw new Error('fleet_preparation_database_invalid');
  }
  if (!NAMESPACE_PATTERN.test(normalized.dispatchNamespace)) {
    throw new Error('fleet_preparation_namespace_invalid');
  }
  return normalized;
}

function preparationErrorCode(error) {
  if (error instanceof CloudflarePlatformError) {
    if (error.code === 'cloudflare_platform_unreachable') {
      return 'tenant_migration_command_prepare_unreachable';
    }
    if (error.code === 'cloudflare_platform_timeout') {
      return 'tenant_migration_command_prepare_timeout';
    }
    if (error.code === 'cloudflare_platform_request_failed') {
      return 'tenant_migration_command_prepare_request_failed';
    }
  }
  return 'tenant_migration_command_prepare_failed';
}

function eligibilityParams(candidate, allowFleetCanary) {
  return [
    candidate.tenantId,
    candidate.workerScriptName,
    candidate.databaseId,
    candidate.dispatchNamespace,
    TENANT_DATA_PLANE_SCHEMA_VERSION,
    TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION,
    allowFleetCanary ? 1 : 0
  ];
}

export async function prepareTenantMigrationCommandCapability(
  candidateInput,
  { platform, controlBatch, uploadWorker = uploadTenantCatalogWorker, allowFleetCanary = false }
) {
  const candidate = validateCandidate(candidateInput);
  const params = eligibilityParams(candidate, allowFleetCanary);
  const eligibility = await controlBatch([{ sql: FLEET_PREPARATION_ELIGIBILITY_SQL, params }]);
  if (Number(eligibility[0]?.results?.[0]?.total || 0) !== 1) {
    return { tenantId: candidate.tenantId, outcome: 'skipped', reason: 'not_eligible' };
  }

  try {
    const upload = await uploadWorker({
      ...platform,
      scriptName: candidate.workerScriptName,
      databaseId: candidate.databaseId,
      tenantId: candidate.tenantId
    });
    const promotion = await controlBatch([
      {
        sql: FLEET_PREPARATION_PROMOTION_SQL,
        params: [...params, upload.versionId || null]
      }
    ]);
    if (Number(promotion[0]?.meta?.changes || 0) !== 1) {
      return {
        tenantId: candidate.tenantId,
        outcome: 'skipped',
        reason: 'eligibility_changed_after_upload'
      };
    }
    return {
      tenantId: candidate.tenantId,
      outcome: 'prepared',
      migrationCommandVersion: TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION
    };
  } catch (error) {
    const safeCode = preparationErrorCode(error);
    await controlBatch([
      {
        sql: FLEET_PREPARATION_FAILURE_SQL,
        params: [
          candidate.tenantId,
          candidate.workerScriptName,
          candidate.databaseId,
          candidate.dispatchNamespace,
          safeCode,
          TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION
        ]
      }
    ]);
    return { tenantId: candidate.tenantId, outcome: 'failed', safeErrorCode: safeCode };
  }
}

export async function runTrustedFleetPreparation(
  env = process.env,
  { controlBatch: controlBatchOverride, uploadWorker, maxTenants } = {}
) {
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const apiToken = String(env.CLOUDFLARE_API_TOKEN || '').trim();
  const dispatchNamespace = String(
    env.CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE || DEFAULT_DISPATCH_NAMESPACE
  ).trim();
  const controlDatabaseId = String(env.CATALOG_CONTROL_DATABASE_ID || '').trim();
  if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new Error('fleet_preparation_account_invalid');
  if (apiToken.length < 20) throw new Error('fleet_preparation_token_invalid');
  if (!NAMESPACE_PATTERN.test(dispatchNamespace)) {
    throw new Error('fleet_preparation_namespace_invalid');
  }
  if (!DATABASE_ID_PATTERN.test(controlDatabaseId)) {
    throw new Error('fleet_preparation_control_database_invalid');
  }
  const boundedLimit = positiveBoundedInteger(
    maxTenants ?? env.TENANT_FLEET_PREPARATION_MAX,
    DEFAULT_MAX_TENANTS,
    MAX_TENANTS
  );
  const platform = { accountId, apiToken, dispatchNamespace };
  const controlBatch =
    controlBatchOverride ||
    ((batch) => queryD1Batch({ ...platform, databaseId: controlDatabaseId, batch }));
  const discovery = await controlBatch([
    {
      sql: FLEET_PREPARATION_DISCOVERY_SQL,
      params: [
        TENANT_DATA_PLANE_SCHEMA_VERSION,
        dispatchNamespace,
        TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION,
        boundedLimit + 1
      ]
    }
  ]);
  const candidates = discovery[0]?.results || [];
  if (candidates.length > boundedLimit) {
    throw new Error('fleet_preparation_capacity_exceeded');
  }

  const outcomes = [];
  for (const candidate of candidates) {
    outcomes.push(
      await prepareTenantMigrationCommandCapability(candidate, {
        platform,
        controlBatch,
        uploadWorker,
        allowFleetCanary: false
      })
    );
  }
  return {
    tenantDataPlaneFleetPreparationCompleted: true,
    trustedCiOwnedUpload: true,
    recurringSyncAutomationEnabled: false,
    targetSchemaVersion: TENANT_DATA_PLANE_SCHEMA_VERSION,
    migrationCommandVersion: TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION,
    selected: candidates.length,
    prepared: outcomes.filter((entry) => entry.outcome === 'prepared').length,
    skipped: outcomes.filter((entry) => entry.outcome === 'skipped').length,
    failed: outcomes.filter((entry) => entry.outcome === 'failed').length,
    outcomes
  };
}

async function main() {
  const wrangler = JSON.parse(
    await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
  );
  const controlDatabaseId = String(
    wrangler.d1_databases?.find((entry) => entry.binding === 'CATALOG_DB')?.database_id || ''
  ).trim();
  if (String(wrangler.vars?.TENANT_SYNC_AUTOMATION_ENABLED || '') !== '0') {
    throw new Error('fleet_preparation_requires_recurring_sync_off');
  }
  const evidence = await runTrustedFleetPreparation({
    ...process.env,
    CATALOG_CONTROL_DATABASE_ID: controlDatabaseId
  });
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.failed > 0) {
    throw new Error('fleet_preparation_tenant_failure');
  }
}

const isDirectExecution =
  Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirectExecution) await main();
