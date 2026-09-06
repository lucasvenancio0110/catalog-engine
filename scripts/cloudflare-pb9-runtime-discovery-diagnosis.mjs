import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryD1Batch } from '../worker/cloudflare-platform.js';
import { TENANT_CATALOG_RUNTIME_VERSION } from '../worker/tenant-catalog-runtime.js';

const DEFAULT_MERCHANT = 'CROCCODILOS';
const RUNTIME_MAX_AUTOMATIC_ATTEMPTS = 6;

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name}_missing`);
  return value;
}

function safeCode(value, fallback = 'none') {
  const code = String(value || '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_:-]{0,79}$/.test(code) ? code : fallback;
}

function integer(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

async function controlDatabaseId() {
  const raw = await fs.readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const config = JSON.parse(raw);
  const database = (config.d1_databases || []).find((entry) => entry?.binding === 'CATALOG_DB');
  if (!database?.database_id) throw new Error('pb9_control_database_missing');
  return String(database.database_id);
}

export function evaluateRuntimeDiscovery(row = {}) {
  const predicates = {
    uniqueMerchant: integer(row.tenant_count) === 1,
    provisioningAtDomain:
      safeCode(row.provisioning_step) === 'domain' &&
      ['running', 'failed', 'blocked'].includes(safeCode(row.provisioning_status)),
    instanceProvisioning:
      safeCode(row.instance_status) === 'provisioning' && integer(row.schema_version) >= 3,
    dataPlaneActive:
      safeCode(row.database_status) === 'active' && safeCode(row.worker_status) === 'active',
    verificationReady:
      safeCode(row.verification_status) === 'success' && integer(row.finding_count) === 0,
    runtimeNeedsWork:
      safeCode(row.runtime_status) !== 'verified' ||
      integer(row.runtime_version) < integer(row.target_runtime_version || 1),
    noBlockingJob: !['pending', 'running'].includes(safeCode(row.runtime_job_status))
  };
  const discoverable = Object.values(predicates).every(Boolean);
  const candidatesAhead = integer(row.eligible_candidates_ahead);

  return {
    discoverable,
    predicates,
    state: {
      provisioningStatus: safeCode(row.provisioning_status),
      provisioningStep: safeCode(row.provisioning_step),
      instanceStatus: safeCode(row.instance_status),
      schemaVersion: integer(row.schema_version),
      databaseStatus: safeCode(row.database_status),
      workerStatus: safeCode(row.worker_status),
      verificationStatus: safeCode(row.verification_status),
      verificationFindings: integer(row.finding_count),
      runtimeStatus: safeCode(row.runtime_status),
      runtimeVersion: integer(row.runtime_version),
      targetRuntimeVersion: integer(row.target_runtime_version || 1),
      runtimeJobStatus: safeCode(row.runtime_job_status)
    },
    scheduling: {
      eligibleCandidates: integer(row.eligible_candidates_total),
      candidatesAhead,
      selectionRank: discoverable ? candidatesAhead + 1 : 0,
      exhaustedEligibleJobs: integer(row.exhausted_eligible_jobs),
      oldestCandidateExhausted: integer(row.oldest_candidate_exhausted) === 1,
      dueRuntimeJobs: integer(row.due_runtime_jobs)
    }
  };
}

export function safeRuntimeDiscoveryEvidence(merchant, evaluation) {
  const evidence = {
    pb9RuntimeDiscovery: evaluation.discoverable ? 'discoverable' : 'not_discoverable',
    merchant: String(merchant || DEFAULT_MERCHANT).slice(0, 80),
    predicates: evaluation.predicates,
    state: evaluation.state,
    scheduling: evaluation.scheduling
  };
  const serialized = JSON.stringify(evidence);
  if (/t_[a-f0-9]{20}|prn_[a-f0-9]{20}|rtjob_[a-f0-9]{20}|[a-f0-9]{8}-[a-f0-9-]{27,}|worker_script|workers\.dev|yupoo\.com|d1_database_id/i.test(serialized)) {
    throw new Error('pb9_runtime_discovery_private_leak');
  }
  return evidence;
}

export async function runRuntimeDiscoveryDiagnosis() {
  const merchant = String(process.env.PB9_MERCHANT_DISPLAY_NAME || DEFAULT_MERCHANT).trim();
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
        sql: `WITH target AS (
                SELECT tenant_id
                  FROM catalog_tenants
                 WHERE UPPER(display_name)=UPPER(?1)
                   AND status='active'
              ),
              target_run AS (
                SELECT r.*
                  FROM tenant_provisioning_runs r
                  JOIN target t ON t.tenant_id=r.tenant_id
                 ORDER BY r.updated_at DESC, r.created_at DESC
                 LIMIT 1
              ),
              eligible AS (
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
                     p.runtime_version < ?2
                   )
                 GROUP BY r.tenant_id
              ),
              target_eligible AS (
                SELECT e.candidate_created_at
                  FROM eligible e
                  JOIN target t ON t.tenant_id=e.tenant_id
                 LIMIT 1
              ),
              oldest_eligible AS (
                SELECT tenant_id
                  FROM eligible
                 ORDER BY candidate_created_at ASC
                 LIMIT 1
              )
              SELECT
                (SELECT COUNT(*) FROM target) AS tenant_count,
                r.status AS provisioning_status,
                r.current_step AS provisioning_step,
                i.status AS instance_status,
                i.schema_version,
                p.database_status,
                p.worker_status,
                p.runtime_status,
                p.runtime_version,
                ?2 AS target_runtime_version,
                v.status AS verification_status,
                v.finding_count,
                (SELECT j.status
                   FROM tenant_runtime_jobs j
                  WHERE j.tenant_id=t.tenant_id
                    AND j.target_runtime_version=?2
                  ORDER BY j.updated_at DESC, j.created_at DESC
                  LIMIT 1) AS runtime_job_status,
                (SELECT COUNT(*) FROM eligible) AS eligible_candidates_total,
                (SELECT COUNT(*)
                   FROM eligible e
                  WHERE e.tenant_id NOT IN (SELECT tenant_id FROM target)
                    AND e.candidate_created_at < COALESCE(
                      (SELECT candidate_created_at FROM target_eligible),
                      '9999-12-31 23:59:59'
                    )) AS eligible_candidates_ahead,
                (SELECT COUNT(DISTINCT e.tenant_id)
                   FROM eligible e
                   JOIN tenant_runtime_jobs j ON j.tenant_id=e.tenant_id
                  WHERE j.target_runtime_version=?2
                    AND j.attempt_count >= ?3
                    AND j.status!='success') AS exhausted_eligible_jobs,
                CASE WHEN EXISTS(
                  SELECT 1
                    FROM tenant_runtime_jobs j
                   WHERE j.tenant_id=(SELECT tenant_id FROM oldest_eligible)
                     AND j.target_runtime_version=?2
                     AND j.attempt_count >= ?3
                     AND j.status!='success'
                ) THEN 1 ELSE 0 END AS oldest_candidate_exhausted,
                (SELECT COUNT(*)
                   FROM tenant_runtime_jobs j
                  WHERE j.target_runtime_version=?2
                    AND j.status IN ('pending','failed','staged')
                    AND j.attempt_count < ?3
                    AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= CURRENT_TIMESTAMP)) AS due_runtime_jobs
              FROM target t
              LEFT JOIN target_run r ON r.tenant_id=t.tenant_id
              LEFT JOIN tenant_catalog_instances i ON i.tenant_id=t.tenant_id
              LEFT JOIN tenant_data_plane_provider_state p ON p.tenant_id=t.tenant_id
              LEFT JOIN tenant_verification_jobs v ON v.job_id=(
                SELECT v2.job_id
                  FROM tenant_verification_jobs v2
                 WHERE v2.tenant_id=t.tenant_id
                 ORDER BY v2.created_at DESC, v2.job_id DESC
                 LIMIT 1
              )
              LIMIT 1`,
        params: [merchant, TENANT_CATALOG_RUNTIME_VERSION, RUNTIME_MAX_AUTOMATIC_ATTEMPTS]
      }
    ]
  });

  const row = result?.[0]?.results?.[0] || {};
  const evidence = safeRuntimeDiscoveryEvidence(merchant, evaluateRuntimeDiscovery(row));
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  runRuntimeDiscoveryDiagnosis().catch((error) => {
    console.error(String(error?.message || error).slice(0, 120));
    process.exitCode = 1;
  });
}
