import {
  assertPublicSafeImportMessage,
  buildTenantImportFinalizeMessage,
  buildTenantImportScanMessage,
  buildTenantImportScanMessageForJob,
  initialTenantImportId
} from './tenant-import-queue.js';
import { reclaimExpiredTenantSyncPhaseLeases } from './tenant-sync-phase-lease.js';

const MAX_AUTOMATIC_ATTEMPTS = 6;
const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 5;

function boundedLimit(value) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

export function tenantImportAutomationEnabled(env) {
  return String(env?.TENANT_IMPORT_AUTOMATION_ENABLED || '').trim() === '1';
}

export function tenantImportQueueConfigured(env) {
  return Boolean(
    env?.TENANT_IMPORT_QUEUE &&
      typeof env.TENANT_IMPORT_QUEUE.send === 'function' &&
      env?.TENANT_IMPORT_DETAIL_QUEUE &&
      typeof env.TENANT_IMPORT_DETAIL_QUEUE.send === 'function' &&
      typeof env.TENANT_IMPORT_DETAIL_QUEUE.sendBatch === 'function'
  );
}

async function discoverImportCandidates(db, limit) {
  const result = await db
    .prepare(
      `SELECT DISTINCT r.tenant_id, s.source_key, r.provisioning_id
         FROM tenant_provisioning_runs r
         JOIN tenant_catalog_instances i ON i.tenant_id=r.tenant_id
         JOIN tenant_data_plane_provider_state p ON p.tenant_id=r.tenant_id
         JOIN supplier_sources s ON s.tenant_id=r.tenant_id AND s.status='active'
         LEFT JOIN tenant_import_jobs j ON j.tenant_id=r.tenant_id
           AND j.source_key=s.source_key
           AND j.status IN ('pending','queued','scanning','details','finalizing')
        WHERE r.current_step='import'
          AND r.status IN ('running','failed','blocked')
          AND i.status='provisioning'
          AND i.schema_version >= 3
          AND p.database_status='active'
          AND p.worker_status='active'
          AND p.d1_database_id IS NOT NULL
          AND j.import_id IS NULL
        ORDER BY r.created_at ASC, s.created_at ASC
        LIMIT ?1`
    )
    .bind(limit)
    .all();

  const created = [];
  for (const row of result.results || []) {
    const importId = await initialTenantImportId({
      tenantId: row.tenant_id,
      sourceKey: row.source_key
    });
    await db
      .prepare(
        `INSERT INTO tenant_import_jobs
          (import_id, tenant_id, source_key, mode, status, phase, attempt_count,
           next_attempt_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'initial', 'pending', 'scan', 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(import_id) DO UPDATE SET
           status=CASE
             WHEN tenant_import_jobs.status IN ('success','cancelled') THEN tenant_import_jobs.status
             WHEN tenant_import_jobs.status IN ('queued','scanning','details','finalizing') THEN tenant_import_jobs.status
             ELSE 'pending'
           END,
           next_attempt_at=CASE
             WHEN tenant_import_jobs.status IN ('success','cancelled','queued','scanning','details','finalizing') THEN tenant_import_jobs.next_attempt_at
             ELSE CURRENT_TIMESTAMP
           END,
           last_error_code=CASE
             WHEN tenant_import_jobs.status IN ('success','cancelled','queued','scanning','details','finalizing') THEN tenant_import_jobs.last_error_code
             ELSE NULL
           END,
           updated_at=CURRENT_TIMESTAMP`
      )
      .bind(importId, row.tenant_id, row.source_key)
      .run();
    created.push({
      importId,
      tenantId: row.tenant_id,
      sourceKey: row.source_key,
      provisioningId: row.provisioning_id || null
    });
  }
  return created;
}

async function reclaimStaleScans(db) {
  await db
    .prepare(
      `UPDATE tenant_import_jobs
          SET status='failed', next_attempt_at=CURRENT_TIMESTAMP,
              scan_lease_until=NULL, last_error_code='tenant_import_scan_lease_reclaimed',
              last_failure_phase='scan',state_revision=state_revision+1,
              updated_at=CURRENT_TIMESTAMP
        WHERE status='scanning'
          AND (
            (mode='initial' AND phase IN ('scan','details')) OR
            (mode='incremental' AND phase='scan')
          )
          AND scan_lease_until IS NOT NULL
          AND scan_lease_until <= CURRENT_TIMESTAMP
          AND phase_lease_token IS NULL`
    )
    .run();
}

async function dueImportJobs(db, limit) {
  const result = await db
    .prepare(
      `SELECT j.import_id, j.tenant_id, j.source_key, j.mode, j.attempt_count, j.phase,
              CASE WHEN j.mode='initial' THEN r.provisioning_id ELSE NULL END AS provisioning_id
         FROM tenant_import_jobs j
         LEFT JOIN tenant_provisioning_runs r ON r.provisioning_id=(
           SELECT r2.provisioning_id
             FROM tenant_provisioning_runs r2
            WHERE r2.tenant_id=j.tenant_id
            ORDER BY r2.created_at DESC
            LIMIT 1
         )
        WHERE j.attempt_count < ?1
          AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= CURRENT_TIMESTAMP)
          AND (
            (j.mode='initial' AND (
              (j.phase='scan' AND (
                j.status='pending' OR
                (j.status='failed' AND j.next_attempt_at IS NOT NULL)
              )) OR
              (j.phase='details' AND j.status='failed'
                AND j.detail_enqueue_cursor < j.discovered_count)
            )) OR
            (j.mode='incremental' AND j.phase='scan' AND (
              j.status='pending' OR
              (j.status='failed' AND j.next_attempt_at IS NOT NULL)
            ))
          )
        ORDER BY COALESCE(j.next_attempt_at,j.created_at) ASC, j.created_at ASC
        LIMIT ?2`
    )
    .bind(MAX_AUTOMATIC_ATTEMPTS, limit)
    .all();
  return result.results || [];
}

async function dueFinalizeJobs(db, limit) {
  const result = await db
    .prepare(
      `SELECT import_id, tenant_id, source_key
         FROM tenant_import_jobs
        WHERE mode='initial'
          AND status IN ('details','finalizing')
          AND phase IN ('details','finalize')
          AND discovered_count > 0
          AND queued_detail_count = discovered_count
        ORDER BY updated_at ASC
        LIMIT ?1`
    )
    .bind(limit)
    .all();
  return result.results || [];
}

async function markQueued(db, job) {
  const statements = [
    db
      .prepare(
        `UPDATE tenant_import_jobs
            SET status='queued', attempt_count=attempt_count+1,
                started_at=COALESCE(started_at,CURRENT_TIMESTAMP),
                next_attempt_at=NULL, last_error_code=NULL,
                last_delivery_at=CURRENT_TIMESTAMP,state_revision=state_revision+1,
                updated_at=CURRENT_TIMESTAMP
          WHERE import_id=?1 AND tenant_id=?2 AND status IN ('pending','failed')
            AND phase_lease_token IS NULL`
      )
      .bind(job.import_id, job.tenant_id)
  ];
  if (job.provisioning_id) {
    statements.push(
      db
        .prepare(
          `UPDATE tenant_provisioning_steps
              SET status='running',
                  attempt_count=CASE WHEN attempt_count < 1 THEN 1 ELSE attempt_count END,
                  started_at=COALESCE(started_at,CURRENT_TIMESTAMP),
                  finished_at=NULL, last_error=NULL, updated_at=CURRENT_TIMESTAMP
            WHERE provisioning_id=?1 AND step_key='import'`
        )
        .bind(job.provisioning_id)
    );
    statements.push(
      db
        .prepare(
          `UPDATE tenant_provisioning_runs
              SET status='running', current_step='import', last_error=NULL, updated_at=CURRENT_TIMESTAMP
            WHERE provisioning_id=?1 AND tenant_id=?2`
        )
        .bind(job.provisioning_id, job.tenant_id)
    );
  }
  await db.batch(statements);
}

async function markDispatchFailure(db, job, safeCode) {
  await db
    .prepare(
      `UPDATE tenant_import_jobs
          SET status='failed', attempt_count=attempt_count+1,
              next_attempt_at=datetime(CURRENT_TIMESTAMP,'+10 minutes'),
              last_error_code=?2, updated_at=CURRENT_TIMESTAMP
        WHERE import_id=?1 AND tenant_id=?3 AND status IN ('pending','failed')`
    )
    .bind(job.import_id, safeCode, job.tenant_id)
    .run();
}

async function dispatchFinalizeMessages(env, jobs) {
  const outcomes = [];
  for (const job of jobs) {
    try {
      const message = assertPublicSafeImportMessage(
        buildTenantImportFinalizeMessage({
          importId: job.import_id,
          tenantId: job.tenant_id,
          sourceKey: job.source_key
        })
      );
      await env.TENANT_IMPORT_DETAIL_QUEUE.send(message, {
        contentType: 'json',
        delaySeconds: 0
      });
      outcomes.push({ importId: job.import_id, outcome: 'queued' });
    } catch {
      outcomes.push({ importId: job.import_id, outcome: 'failed' });
    }
  }
  return outcomes;
}

async function scanMessageForJob(job) {
  if (job.mode === 'incremental') {
    return buildTenantImportScanMessageForJob({
      importId: job.import_id,
      tenantId: job.tenant_id,
      sourceKey: job.source_key
    });
  }
  const message = await buildTenantImportScanMessage({
    tenantId: job.tenant_id,
    sourceKey: job.source_key
  });
  if (message.importId !== job.import_id) throw new Error('tenant_import_identity_mismatch');
  return message;
}

export async function runDueTenantImportDispatches(
  env,
  { limit = DEFAULT_LIMIT } = {}
) {
  if (!env.CATALOG_DB) return { enabled: false, reason: 'database_unbound', dispatched: 0 };
  if (!tenantImportAutomationEnabled(env)) {
    return { enabled: false, reason: 'tenant_import_automation_disabled', dispatched: 0 };
  }
  if (!tenantImportQueueConfigured(env)) {
    return { enabled: false, reason: 'tenant_import_queue_unbound', dispatched: 0 };
  }

  const db = env.CATALOG_DB;
  const jobLimit = boundedLimit(limit);
  await reclaimExpiredTenantSyncPhaseLeases(db);
  await reclaimStaleScans(db);
  const discovered = await discoverImportCandidates(db, jobLimit);
  const due = await dueImportJobs(db, jobLimit);
  const outcomes = [];

  for (const job of due) {
    try {
      const message = assertPublicSafeImportMessage(await scanMessageForJob(job));
      await env.TENANT_IMPORT_QUEUE.send(message, {
        contentType: 'json',
        delaySeconds: 0
      });
      await markQueued(db, job);
      outcomes.push({ importId: job.import_id, phase: job.phase, outcome: 'queued' });
    } catch {
      await markDispatchFailure(db, job, 'tenant_import_queue_send_failed');
      outcomes.push({ importId: job.import_id, phase: job.phase, outcome: 'failed' });
    }
  }

  const finalizeDue = await dueFinalizeJobs(db, jobLimit);
  const finalizeOutcomes = await dispatchFinalizeMessages(env, finalizeDue);
  const scanQueued = outcomes.filter((entry) => entry.outcome === 'queued').length;
  const finalizeQueued = finalizeOutcomes.filter((entry) => entry.outcome === 'queued').length;

  return {
    enabled: true,
    discovered: discovered.length,
    selected: due.length,
    finalizeSelected: finalizeDue.length,
    dispatched: scanQueued + finalizeQueued,
    scanDispatched: scanQueued,
    finalizeDispatched: finalizeQueued,
    failed:
      outcomes.filter((entry) => entry.outcome === 'failed').length +
      finalizeOutcomes.filter((entry) => entry.outcome === 'failed').length,
    outcomes,
    finalizeOutcomes
  };
}
