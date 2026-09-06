import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryD1Batch } from '../worker/cloudflare-platform.js';
import { TENANT_CATALOG_RUNTIME_VERSION } from '../worker/tenant-catalog-runtime.js';

const ALLOWED_STAGES = new Set([
  'never',
  'entered',
  'configured',
  'discovered',
  'selected',
  'completed',
  'failed',
  'disabled'
]);

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name}_missing`);
  return value;
}

function integer(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function boolean(value) {
  return integer(value) === 1;
}

function safeCode(value, fallback = 'none') {
  const code = String(value || '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_:-]{0,79}$/.test(code) ? code : fallback;
}

async function controlDatabaseId() {
  const raw = await fs.readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const config = JSON.parse(raw);
  const database = (config.d1_databases || []).find((entry) => entry?.binding === 'CATALOG_DB');
  if (!database?.database_id) throw new Error('pb9_control_database_missing');
  return String(database.database_id);
}

export function evaluateRuntimeSchedulerHeartbeat(row = {}) {
  const rawStage = String(row.stage || 'never').trim().toLowerCase();
  const stage = ALLOWED_STAGES.has(rawStage) ? rawStage : 'unknown';
  return {
    observed: stage !== 'never' && stage !== 'unknown',
    stage,
    discovered: integer(row.discovered_count),
    selected: integer(row.selected_count),
    processed: integer(row.processed_count),
    lastErrorCode: safeCode(row.last_error_code),
    heartbeatAgeSeconds: integer(row.heartbeat_age_seconds)
  };
}

export function evaluateOldestCandidatePreclaim(row = {}) {
  const gates = {
    dataPlaneActive: boolean(row.data_plane_active),
    dataPlaneLocatorPresent: boolean(row.data_plane_locator_present),
    workerLocatorPresent: boolean(row.worker_locator_present),
    dispatchNamespaceMatches: boolean(row.dispatch_namespace_matches),
    schemaReady: boolean(row.schema_ready)
  };
  return {
    ready: Object.values(gates).every(Boolean),
    gates
  };
}

export function safeRuntimeSchedulerHeartbeatEvidence(evaluation, preclaim) {
  const evidence = {
    pb9RuntimeSchedulerHeartbeat: evaluation.observed ? 'observed' : 'not_observed',
    scheduler: evaluation,
    oldestCandidatePreclaim: preclaim
  };
  const serialized = JSON.stringify(evidence);
  if (/t_[a-f0-9]{20}|prn_[a-f0-9]{20}|rtjob_[a-f0-9]{20}|[a-f0-9]{8}-[a-f0-9-]{27,}|worker_script|workers\.dev|yupoo\.com|d1_database_id/i.test(serialized)) {
    throw new Error('pb9_runtime_scheduler_heartbeat_private_leak');
  }
  return evidence;
}

export async function runRuntimeSchedulerHeartbeatDiagnosis() {
  const accountId = requiredEnv('CLOUDFLARE_ACCOUNT_ID');
  const apiToken = requiredEnv('CLOUDFLARE_API_TOKEN');
  const databaseId = await controlDatabaseId();
  const result = await queryD1Batch({
    accountId,
    apiToken,
    databaseId,
    dispatchNamespace: 'catalog-engine-production',
    batch: [
      {
        sql: `SELECT stage,
                     discovered_count,
                     selected_count,
                     processed_count,
                     last_error_code,
                     MAX(0, CAST(strftime('%s','now') AS INTEGER) - CAST(strftime('%s',updated_at) AS INTEGER)) AS heartbeat_age_seconds
                FROM tenant_runtime_scheduler_state
               WHERE singleton_id=1
               LIMIT 1`,
        params: []
      },
      {
        sql: `WITH eligible AS (
                SELECT r.tenant_id, MIN(r.created_at) AS candidate_created_at
                  FROM tenant_provisioning_runs r
                  JOIN tenant_catalog_instances i ON i.tenant_id=r.tenant_id
                  JOIN tenant_data_plane_provider_state p ON p.tenant_id=r.tenant_id
                  JOIN tenant_verification_jobs v ON v.tenant_id=r.tenant_id
                    AND v.status='success'
                 WHERE r.current_step='domain'
                   AND r.status IN ('running','failed','blocked')
                   AND i.status='provisioning'
                   AND i.schema_version >= 3
                   AND p.database_status='active'
                   AND p.worker_status='active'
                   AND p.d1_database_id IS NOT NULL
                   AND (
                     p.runtime_kind!='catalog' OR
                     p.runtime_status!='verified' OR
                     p.runtime_version < ?1
                   )
                 GROUP BY r.tenant_id
              ),
              oldest AS (
                SELECT tenant_id
                  FROM eligible
                 ORDER BY candidate_created_at ASC
                 LIMIT 1
              )
              SELECT
                CASE WHEN p.database_status='active' AND p.worker_status='active' THEN 1 ELSE 0 END AS data_plane_active,
                CASE WHEN p.d1_database_id IS NOT NULL AND LENGTH(TRIM(p.d1_database_id)) > 0 THEN 1 ELSE 0 END AS data_plane_locator_present,
                CASE WHEN p.worker_script_name IS NOT NULL AND LENGTH(TRIM(p.worker_script_name)) > 0 THEN 1 ELSE 0 END AS worker_locator_present,
                CASE WHEN p.dispatch_namespace='catalog-engine-production' THEN 1 ELSE 0 END AS dispatch_namespace_matches,
                CASE WHEN i.schema_version >= 3 THEN 1 ELSE 0 END AS schema_ready
                FROM oldest o
                LEFT JOIN tenant_data_plane_provider_state p ON p.tenant_id=o.tenant_id
                LEFT JOIN tenant_catalog_instances i ON i.tenant_id=o.tenant_id
               LIMIT 1`,
        params: [TENANT_CATALOG_RUNTIME_VERSION]
      }
    ]
  });
  const heartbeatRow = result?.[0]?.results?.[0] || {};
  const preclaimRow = result?.[1]?.results?.[0] || {};
  const evidence = safeRuntimeSchedulerHeartbeatEvidence(
    evaluateRuntimeSchedulerHeartbeat(heartbeatRow),
    evaluateOldestCandidatePreclaim(preclaimRow)
  );
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  runRuntimeSchedulerHeartbeatDiagnosis().catch(() => {
    console.error('pb9_runtime_scheduler_heartbeat_diagnosis_failed');
    process.exitCode = 1;
  });
}
