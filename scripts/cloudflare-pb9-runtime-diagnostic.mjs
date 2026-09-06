import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryD1Batch } from '../worker/cloudflare-platform.js';
import { TENANT_CATALOG_RUNTIME_VERSION } from '../worker/tenant-catalog-runtime.js';

const DEFAULT_MERCHANT = 'CROCCODILOS';
const DEFAULT_TENANT_ID = 't_00000000000000000001';
const DISPATCH_NAMESPACE = 'catalog-engine-production';

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name}_missing`);
  return value;
}

function integer(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function flag(value) {
  return integer(value) === 1;
}

function safeCode(value) {
  const code = String(value || '').trim().toLowerCase();
  return /^[a-z][a-z0-9_]{0,119}$/.test(code) ? code : null;
}

async function loadControlDatabaseId() {
  const raw = await fs.readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const config = JSON.parse(raw);
  const database = (config.d1_databases || []).find((entry) => entry?.binding === 'CATALOG_DB');
  if (!database?.database_id) throw new Error('pb9_control_database_missing');
  return String(database.database_id);
}

function platformConfig(accountId, apiToken, databaseId) {
  return {
    accountId,
    apiToken,
    dispatchNamespace: DISPATCH_NAMESPACE,
    databaseId
  };
}

async function readRuntimeDiagnostic({ accountId, apiToken, databaseId, merchant }) {
  const result = await queryD1Batch({
    ...platformConfig(accountId, apiToken, databaseId),
    batch: [
      {
        sql: `WITH target AS (
                SELECT tenant_id
                  FROM catalog_tenants
                 WHERE UPPER(display_name)=UPPER(?1)
                   AND status='active'
              ),
              target_candidate AS (
                SELECT DISTINCT r.tenant_id, MIN(r.created_at) AS candidate_created_at
                  FROM target t
                  JOIN tenant_provisioning_runs r ON r.tenant_id=t.tenant_id
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
                     p.runtime_version < ?3
                   )
                 GROUP BY r.tenant_id
              ),
              target_job AS (
                SELECT j.*
                  FROM tenant_runtime_jobs j
                  JOIN target t ON t.tenant_id=j.tenant_id
                 WHERE j.target_runtime_version=?3
                 LIMIT 1
              )
              SELECT
                (SELECT COUNT(*) FROM target) AS target_count,
                CASE WHEN EXISTS(
                  SELECT 1 FROM target t
                  JOIN tenant_provisioning_runs r ON r.tenant_id=t.tenant_id
                  WHERE r.current_step='domain'
                ) THEN 1 ELSE 0 END AS provisioning_at_domain,
                CASE WHEN EXISTS(
                  SELECT 1 FROM target t
                  JOIN tenant_provisioning_runs r ON r.tenant_id=t.tenant_id
                  WHERE r.current_step='domain'
                    AND r.status IN ('running','failed','blocked')
                ) THEN 1 ELSE 0 END AS provisioning_runnable,
                CASE WHEN EXISTS(
                  SELECT 1 FROM target t
                  JOIN tenant_catalog_instances i ON i.tenant_id=t.tenant_id
                  WHERE i.status='provisioning'
                ) THEN 1 ELSE 0 END AS instance_provisioning,
                CASE WHEN EXISTS(
                  SELECT 1 FROM target t
                  JOIN tenant_catalog_instances i ON i.tenant_id=t.tenant_id
                  WHERE i.schema_version >= 3
                ) THEN 1 ELSE 0 END AS schema_ready,
                CASE WHEN EXISTS(
                  SELECT 1 FROM target t
                  JOIN tenant_data_plane_provider_state p ON p.tenant_id=t.tenant_id
                  WHERE p.database_status='active'
                ) THEN 1 ELSE 0 END AS database_active,
                CASE WHEN EXISTS(
                  SELECT 1 FROM target t
                  JOIN tenant_data_plane_provider_state p ON p.tenant_id=t.tenant_id
                  WHERE p.worker_status='active'
                ) THEN 1 ELSE 0 END AS worker_active,
                CASE WHEN EXISTS(
                  SELECT 1 FROM target t
                  JOIN tenant_data_plane_provider_state p ON p.tenant_id=t.tenant_id
                  WHERE p.d1_database_id IS NOT NULL
                ) THEN 1 ELSE 0 END AS data_plane_locator_present,
                CASE WHEN EXISTS(
                  SELECT 1 FROM target t
                  JOIN tenant_verification_jobs v ON v.tenant_id=t.tenant_id
                  WHERE v.status='success'
                ) THEN 1 ELSE 0 END AS verification_success,
                CASE WHEN EXISTS(SELECT 1 FROM target_candidate) THEN 1 ELSE 0 END AS candidate_eligible,
                CASE WHEN EXISTS(
                  SELECT 1 FROM target t
                  JOIN tenant_data_plane_provider_state p ON p.tenant_id=t.tenant_id
                  WHERE p.runtime_kind='catalog'
                ) THEN 1 ELSE 0 END AS runtime_kind_catalog,
                CASE WHEN EXISTS(
                  SELECT 1 FROM target t
                  JOIN tenant_data_plane_provider_state p ON p.tenant_id=t.tenant_id
                  WHERE p.runtime_status='verified'
                ) THEN 1 ELSE 0 END AS runtime_status_verified,
                CASE WHEN EXISTS(
                  SELECT 1 FROM target t
                  JOIN tenant_data_plane_provider_state p ON p.tenant_id=t.tenant_id
                  WHERE p.runtime_status='error'
                ) THEN 1 ELSE 0 END AS runtime_status_error,
                CASE WHEN EXISTS(
                  SELECT 1 FROM target t
                  JOIN tenant_data_plane_provider_state p ON p.tenant_id=t.tenant_id
                  WHERE p.runtime_version >= ?3
                ) THEN 1 ELSE 0 END AS runtime_version_current,
                (SELECT runtime_last_error_code
                   FROM target t
                   JOIN tenant_data_plane_provider_state p ON p.tenant_id=t.tenant_id
                   LIMIT 1) AS provider_last_error_code,
                CASE WHEN EXISTS(SELECT 1 FROM target_job) THEN 1 ELSE 0 END AS runtime_job_present,
                CASE WHEN EXISTS(SELECT 1 FROM target_job WHERE status='pending') THEN 1 ELSE 0 END AS runtime_job_pending,
                CASE WHEN EXISTS(SELECT 1 FROM target_job WHERE status='running') THEN 1 ELSE 0 END AS runtime_job_running,
                CASE WHEN EXISTS(SELECT 1 FROM target_job WHERE status='staged') THEN 1 ELSE 0 END AS runtime_job_staged,
                CASE WHEN EXISTS(SELECT 1 FROM target_job WHERE status='failed') THEN 1 ELSE 0 END AS runtime_job_failed,
                CASE WHEN EXISTS(SELECT 1 FROM target_job WHERE status='success') THEN 1 ELSE 0 END AS runtime_job_success,
                COALESCE((SELECT attempt_count FROM target_job),0) AS runtime_job_attempt_count,
                CASE WHEN EXISTS(
                  SELECT 1 FROM target_job
                  WHERE status IN ('pending','failed','staged')
                    AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
                ) THEN 1 ELSE 0 END AS runtime_job_due,
                CASE WHEN EXISTS(
                  SELECT 1 FROM target_job
                  WHERE status IN ('pending','failed','staged')
                    AND next_attempt_at > CURRENT_TIMESTAMP
                ) THEN 1 ELSE 0 END AS runtime_job_retry_deferred,
                (SELECT last_error_code FROM target_job) AS runtime_job_last_error_code,
                (
                  SELECT COUNT(DISTINCT r2.tenant_id)
                    FROM tenant_provisioning_runs r2
                    JOIN tenant_catalog_instances i2 ON i2.tenant_id=r2.tenant_id
                    JOIN tenant_data_plane_provider_state p2 ON p2.tenant_id=r2.tenant_id
                    JOIN tenant_verification_jobs v2 ON v2.tenant_id=r2.tenant_id
                      AND v2.status='success'
                   WHERE r2.current_step='domain'
                     AND r2.status IN ('running','failed','blocked')
                     AND i2.status='provisioning'
                     AND i2.schema_version >= 3
                     AND p2.database_status='active'
                     AND p2.worker_status='active'
                     AND p2.d1_database_id IS NOT NULL
                     AND (
                       p2.runtime_kind!='catalog' OR
                       p2.runtime_status!='verified' OR
                       p2.runtime_version < ?3
                     )
                ) AS eligible_candidates_total,
                (
                  SELECT COUNT(DISTINCT r2.tenant_id)
                    FROM tenant_provisioning_runs r2
                    JOIN tenant_catalog_instances i2 ON i2.tenant_id=r2.tenant_id
                    JOIN tenant_data_plane_provider_state p2 ON p2.tenant_id=r2.tenant_id
                    JOIN tenant_verification_jobs v2 ON v2.tenant_id=r2.tenant_id
                      AND v2.status='success'
                   WHERE r2.current_step='domain'
                     AND r2.status IN ('running','failed','blocked')
                     AND i2.status='provisioning'
                     AND i2.schema_version >= 3
                     AND p2.database_status='active'
                     AND p2.worker_status='active'
                     AND p2.d1_database_id IS NOT NULL
                     AND (
                       p2.runtime_kind!='catalog' OR
                       p2.runtime_status!='verified' OR
                       p2.runtime_version < ?3
                     )
                     AND r2.created_at < COALESCE(
                       (SELECT candidate_created_at FROM target_candidate LIMIT 1),
                       CURRENT_TIMESTAMP
                     )
                     AND r2.tenant_id NOT IN (SELECT tenant_id FROM target)
                ) AS eligible_candidates_ahead,
                (
                  SELECT COUNT(*)
                    FROM tenant_runtime_jobs j2
                   WHERE j2.target_runtime_version=?3
                     AND j2.status IN ('pending','failed','staged')
                     AND (j2.next_attempt_at IS NULL OR j2.next_attempt_at <= CURRENT_TIMESTAMP)
                ) AS due_runtime_jobs_total,
                CASE WHEN EXISTS(
                  SELECT 1 FROM target t WHERE t.tenant_id=?2
                ) THEN 1 ELSE 0 END AS target_is_default
              `,
        params: [merchant, DEFAULT_TENANT_ID, TENANT_CATALOG_RUNTIME_VERSION]
      }
    ]
  });
  return result?.[0]?.results?.[0] || null;
}

export function sanitizePb9RuntimeDiagnostic(merchant, row) {
  const output = {
    pb9RuntimeDiagnostic: 'safe',
    merchant: String(merchant || DEFAULT_MERCHANT).slice(0, 80),
    targetUnique: integer(row?.target_count) === 1,
    targetIsDefault: flag(row?.target_is_default),
    gates: {
      provisioningAtDomain: flag(row?.provisioning_at_domain),
      provisioningRunnable: flag(row?.provisioning_runnable),
      instanceProvisioning: flag(row?.instance_provisioning),
      schemaReady: flag(row?.schema_ready),
      databaseActive: flag(row?.database_active),
      workerActive: flag(row?.worker_active),
      dataPlaneLocatorPresent: flag(row?.data_plane_locator_present),
      verificationSuccess: flag(row?.verification_success),
      candidateEligible: flag(row?.candidate_eligible),
      runtimeKindCatalog: flag(row?.runtime_kind_catalog),
      runtimeStatusVerified: flag(row?.runtime_status_verified),
      runtimeStatusError: flag(row?.runtime_status_error),
      runtimeVersionCurrent: flag(row?.runtime_version_current)
    },
    queue: {
      jobPresent: flag(row?.runtime_job_present),
      jobPending: flag(row?.runtime_job_pending),
      jobRunning: flag(row?.runtime_job_running),
      jobStaged: flag(row?.runtime_job_staged),
      jobFailed: flag(row?.runtime_job_failed),
      jobSuccess: flag(row?.runtime_job_success),
      jobAttemptCount: integer(row?.runtime_job_attempt_count),
      jobDue: flag(row?.runtime_job_due),
      jobRetryDeferred: flag(row?.runtime_job_retry_deferred),
      eligibleCandidatesTotal: integer(row?.eligible_candidates_total),
      eligibleCandidatesAhead: integer(row?.eligible_candidates_ahead),
      dueRuntimeJobsTotal: integer(row?.due_runtime_jobs_total)
    },
    errors: {
      provider: safeCode(row?.provider_last_error_code),
      job: safeCode(row?.runtime_job_last_error_code)
    }
  };
  const serialized = JSON.stringify(output);
  if (/t_[a-f0-9]{20}|prn_[a-f0-9]{20}|rtjob_[a-f0-9]{20}|[a-f0-9]{8}-[a-f0-9-]{27,}|worker_script|d1_database|workers\.dev|yupoo\.com|source_url/i.test(serialized)) {
    throw new Error('pb9_runtime_diagnostic_private_leak');
  }
  return output;
}

export async function runPb9RuntimeDiagnostic() {
  const merchant = String(process.env.PB9_MERCHANT_DISPLAY_NAME || DEFAULT_MERCHANT).trim();
  const accountId = requiredEnv('CLOUDFLARE_ACCOUNT_ID');
  const apiToken = requiredEnv('CLOUDFLARE_API_TOKEN');
  const databaseId = await loadControlDatabaseId();
  const row = await readRuntimeDiagnostic({ accountId, apiToken, databaseId, merchant });
  const evidence = sanitizePb9RuntimeDiagnostic(merchant, row);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  runPb9RuntimeDiagnostic().catch((error) => {
    console.error(String(error?.message || error).slice(0, 120));
    process.exitCode = 1;
  });
}
