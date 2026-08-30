import { z } from 'zod';
import { queryD1Batch } from './cloudflare-platform.js';
import {
  assertPublicSafeImportMessage,
  buildTenantImportDetailMessage
} from './tenant-import-queue.js';
import { stableOpaqueId } from './runtime-identity.js';
import { safeTenantSyncErrorCode, tenantSyncRecoveryDelayMinutes } from './tenant-sync-phase-lease.js';
import {
  ingestionPlatformConfig,
  loadTenantImportContext
} from './ingestion/context.js';

const MAX_REPLAY_ATTEMPTS = 3;
const MAX_REPLAY_DETAIL_BATCH = 100;
const MAX_REPLAY_DETAIL_ITEMS = 500;
const REPLAY_LEASE_MINUTES = 5;
const DEFAULT_LIMIT = 2;
const MAX_LIMIT = 5;

const replayRequestSchema = z.object({
  importId: z.string().regex(/^imp_[a-f0-9]{20}$/),
  phase: z.enum(['scan', 'detail', 'classification', 'verification', 'finalization']),
  expectedJobRevision: z.number().int().min(0),
  expectedAuthorityRevision: z.number().int().min(0)
}).strict();

const FAILURE_PHASE_FOR_REPLAY = Object.freeze({
  scan: 'scan',
  detail: 'detail',
  classification: 'classification',
  verification: 'verification',
  finalization: 'finalization'
});

function boundedLimit(value) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function platformRuntimeConfigured(env) {
  if (env?.TENANT_DISPATCH && typeof env.TENANT_DISPATCH.get === 'function') return true;
  const accountId = String(env?.CLOUDFLARE_PLATFORM_ACCOUNT_ID || '').trim();
  const apiToken = String(env?.CLOUDFLARE_PLATFORM_API_TOKEN || '').trim();
  return /^[a-f0-9]{32}$/i.test(accountId) && apiToken.length >= 20;
}

function publicReplay(row) {
  return {
    replayId: row.replay_id,
    runId: row.import_id,
    phase: row.phase,
    state: row.status,
    attemptCount: Number(row.attempt_count || 0),
    replayedItemCount: Number(row.replayed_item_count || 0),
    safeErrorCode: row.last_error_code
      ? safeTenantSyncErrorCode(row.last_error_code, 'tenant_sync_operation_failed')
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at || null
  };
}

export async function createTenantSyncReplayRequest(
  db,
  { tenantId, requestedByPrincipalId, ...input }
) {
  const parsed = replayRequestSchema.parse(input);
  const job = await db
    .prepare(
      `SELECT import_id,tenant_id,source_key,mode,status,phase,state_revision,
              last_failure_phase
         FROM tenant_import_jobs
        WHERE import_id=?1 AND tenant_id=?2
        LIMIT 1`
    )
    .bind(parsed.importId, tenantId)
    .first();
  if (!job || job.mode !== 'incremental') {
    throw Object.assign(new Error('sync_replay_run_not_found'), {
      status: 404,
      code: 'sync_replay_run_not_found'
    });
  }
  if (
    job.status !== 'failed' ||
    Number(job.state_revision || 0) !== parsed.expectedJobRevision ||
    job.last_failure_phase !== FAILURE_PHASE_FOR_REPLAY[parsed.phase]
  ) {
    throw Object.assign(new Error('sync_replay_stale_request'), {
      status: 409,
      code: 'sync_replay_stale_request'
    });
  }

  const replayId = await stableOpaqueId(
    'rpl',
    `${job.import_id}:${parsed.phase}:${parsed.expectedJobRevision}:${parsed.expectedAuthorityRevision}:v1`
  );
  await db
    .prepare(
      `INSERT INTO tenant_sync_replay_requests
        (replay_id,tenant_id,source_key,import_id,phase,
         expected_job_revision,expected_authority_revision,status,attempt_count,
         next_attempt_at,requested_by_principal_id,created_at,updated_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,'pending',0,CURRENT_TIMESTAMP,?8,
               CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
       ON CONFLICT(import_id,phase,expected_job_revision,expected_authority_revision)
       DO NOTHING`
    )
    .bind(
      replayId,
      tenantId,
      job.source_key,
      job.import_id,
      parsed.phase,
      parsed.expectedJobRevision,
      parsed.expectedAuthorityRevision,
      requestedByPrincipalId
    )
    .run();
  const row = await db
    .prepare(
      `SELECT replay_id,import_id,phase,status,attempt_count,replayed_item_count,
              last_error_code,created_at,updated_at,finished_at
         FROM tenant_sync_replay_requests
        WHERE import_id=?1 AND phase=?2 AND expected_job_revision=?3
          AND expected_authority_revision=?4
        LIMIT 1`
    )
    .bind(
      job.import_id,
      parsed.phase,
      parsed.expectedJobRevision,
      parsed.expectedAuthorityRevision
    )
    .first();
  return publicReplay(row);
}

async function discoverDueReplays(db, limit) {
  const result = await db
    .prepare(
      `WITH due_replays AS (
         SELECT replay_id,tenant_id,source_key,import_id,phase,
                expected_job_revision,expected_authority_revision,attempt_count,
                next_attempt_at,created_at,
                ROW_NUMBER() OVER (
                  PARTITION BY tenant_id
                  ORDER BY COALESCE(next_attempt_at,created_at) ASC,created_at ASC,replay_id ASC
                ) AS tenant_rank
           FROM tenant_sync_replay_requests
          WHERE attempt_count < ?1
            AND (
              (
                status IN ('pending','failed')
                AND (next_attempt_at IS NULL OR next_attempt_at<=CURRENT_TIMESTAMP)
                AND (lease_token IS NULL OR lease_until IS NULL OR lease_until<=CURRENT_TIMESTAMP)
              ) OR (
                status='processing' AND lease_token IS NOT NULL
                AND lease_until IS NOT NULL AND lease_until<=CURRENT_TIMESTAMP
              )
            )
       )
       SELECT replay_id,tenant_id,source_key,import_id,phase,
              expected_job_revision,expected_authority_revision,attempt_count
         FROM due_replays
        WHERE tenant_rank=1
        ORDER BY COALESCE(next_attempt_at,created_at) ASC,created_at ASC,replay_id ASC
        LIMIT ?2`
    )
    .bind(MAX_REPLAY_ATTEMPTS, limit)
    .all();
  return result.results || [];
}

async function claimReplay(db, replay) {
  const token = crypto.randomUUID();
  const result = await db
    .prepare(
      `UPDATE tenant_sync_replay_requests
          SET status='processing',attempt_count=attempt_count+1,
              lease_token=?2,lease_until=datetime(CURRENT_TIMESTAMP,?3),
              started_at=COALESCE(started_at,CURRENT_TIMESTAMP),
              last_error_code=NULL,updated_at=CURRENT_TIMESTAMP
        WHERE replay_id=?1
          AND attempt_count=CAST(?4 AS INTEGER) AND attempt_count < ?5
          AND (
            (
              status IN ('pending','failed')
              AND (next_attempt_at IS NULL OR next_attempt_at<=CURRENT_TIMESTAMP)
              AND (lease_token IS NULL OR lease_until IS NULL OR lease_until<=CURRENT_TIMESTAMP)
            ) OR (
              status='processing' AND lease_token IS NOT NULL
              AND lease_until IS NOT NULL AND lease_until<=CURRENT_TIMESTAMP
            )
          )`
    )
    .bind(
      replay.replay_id,
      token,
      `+${REPLAY_LEASE_MINUTES} minutes`,
      replay.attempt_count,
      MAX_REPLAY_ATTEMPTS
    )
    .run();
  return Number(result?.meta?.changes || 0) === 1 ? token : null;
}

async function loadReplayJob(db, replay) {
  return db
    .prepare(
      `SELECT import_id,tenant_id,source_key,mode,status,phase,state_revision,
              last_failure_phase,last_error_code
         FROM tenant_import_jobs
        WHERE import_id=?1 AND tenant_id=?2 AND source_key=?3
          AND mode='incremental' AND status='failed'
          AND state_revision=CAST(?4 AS INTEGER)
          AND phase_lease_token IS NULL
        LIMIT 1`
    )
    .bind(
      replay.import_id,
      replay.tenant_id,
      replay.source_key,
      replay.expected_job_revision
    )
    .first();
}

async function loadReplayAuthority(context, env, queryBatch, fetchImpl) {
  const platform = {
    ...ingestionPlatformConfig(env, context.dataPlane.dispatchNamespace),
    tenantId: context.tenantId
  };
  const result = await queryBatch(
    {
      ...platform,
      databaseId: context.dataPlane.databaseId,
      batch: [
        {
          sql: `SELECT a.revision AS current_authority_revision,
                       a.last_promoted_run_id,a.last_promoted_source_key,
                       r.state,r.safety_outcome,r.last_error_code,
                       sa.base_authority_revision
                  FROM catalog_serving_authority a
                  LEFT JOIN supplier_sync_stage_runs r
                    ON r.tenant_id=a.tenant_id AND r.run_id=?1 AND r.source_key=?3
                  LEFT JOIN supplier_sync_stage_authority sa
                    ON sa.run_id=r.run_id AND sa.tenant_id=r.tenant_id
                   AND sa.source_key=r.source_key
                 WHERE a.tenant_id=?2
                 LIMIT 1`,
          params: [context.importId, context.tenantId, context.sourceKey]
        }
      ]
    },
    { fetchImpl }
  );
  return { platform, row: result[0]?.results?.[0] || null };
}

function replayAuthorityAdmissible(replay, context, row) {
  if (!row || Number(row.current_authority_revision) !== Number(replay.expected_authority_revision)) {
    return false;
  }
  if (!row.state) return replay.phase === 'scan';
  const base = Number(row.base_authority_revision);
  const current = Number(row.current_authority_revision);
  if (row.state === 'promoted') {
    return (
      replay.phase === 'finalization' &&
      current === base + 1 &&
      row.last_promoted_run_id === context.importId &&
      row.last_promoted_source_key === context.sourceKey
    );
  }
  return current === base;
}

async function resetReplayVerification(context, authority, queryBatch, fetchImpl) {
  const result = await queryBatch(
    {
      ...authority.platform,
      databaseId: context.dataPlane.databaseId,
      batch: [
        {
          sql: `UPDATE supplier_sync_stage_runs
                   SET state='details_complete',verification_code=NULL,last_error_code=NULL,
                       updated_at=CURRENT_TIMESTAMP
                 WHERE run_id=?1 AND tenant_id=?2 AND source_key=?3
                   AND state='failed' AND safety_outcome='proceed'`,
          params: [context.importId, context.tenantId, context.sourceKey]
        },
        {
          sql: `UPDATE supplier_sync_runs
                   SET status='running',finished_at=NULL,error_text=NULL
                 WHERE run_id=?1 AND tenant_id=?2 AND source_key=?3 AND status='failed'`,
          params: [context.importId, context.tenantId, context.sourceKey]
        }
      ]
    },
    { fetchImpl }
  );
  return Number(result[0]?.meta?.changes || 0) === 1;
}

async function replayDetailCandidates(context, authority, env, queryBatch, fetchImpl) {
  if (!env?.TENANT_IMPORT_DETAIL_QUEUE || typeof env.TENANT_IMPORT_DETAIL_QUEUE.sendBatch !== 'function') {
    throw new Error('tenant_import_detail_queue_unbound');
  }
  if (authority.row.state !== 'details_pending' || authority.row.safety_outcome !== 'proceed') {
    throw new Error('sync_replay_detail_stage_not_admissible');
  }
  const envelope = await queryBatch(
    {
      ...authority.platform,
      databaseId: context.dataPlane.databaseId,
      batch: [
        {
          sql: `SELECT COUNT(*) AS total
                  FROM supplier_sync_stage_product_details d
                 WHERE d.run_id=?1
                   AND (
                     d.detail_state IN ('pending','failed') OR
                     (d.detail_state='processing' AND (d.lease_until IS NULL OR d.lease_until<=CURRENT_TIMESTAMP))
                   )
                   AND EXISTS (
                     SELECT 1 FROM supplier_sync_stage_runs r
                      WHERE r.run_id=d.run_id AND r.tenant_id=?2 AND r.source_key=?3
                   )`,
          params: [context.importId, context.tenantId, context.sourceKey]
        }
      ]
    },
    { fetchImpl }
  );
  const envelopeSize = Number(envelope[0]?.results?.[0]?.total || 0);
  if (envelopeSize > MAX_REPLAY_DETAIL_ITEMS) {
    throw new Error('sync_replay_detail_envelope_exceeded');
  }

  await queryBatch(
    {
      ...authority.platform,
      databaseId: context.dataPlane.databaseId,
      batch: [
        {
          sql: `UPDATE supplier_sync_stage_product_details
                   SET detail_state='pending',attempt_count=0,claim_token=NULL,lease_until=NULL,
                       outcome_code=NULL,last_error_code=NULL,processed_at=NULL,
                       updated_at=CURRENT_TIMESTAMP
                 WHERE run_id=?1
                   AND (
                     detail_state='failed' OR
                     (detail_state='processing' AND (lease_until IS NULL OR lease_until<=CURRENT_TIMESTAMP))
                   )
                   AND EXISTS (
                     SELECT 1 FROM supplier_sync_stage_runs r
                      WHERE r.run_id=supplier_sync_stage_product_details.run_id
                        AND r.tenant_id=?2 AND r.source_key=?3
                   )`,
          params: [context.importId, context.tenantId, context.sourceKey]
        }
      ]
    },
    { fetchImpl }
  );
  const selected = await queryBatch(
    {
      ...authority.platform,
      databaseId: context.dataPlane.databaseId,
      batch: [
        {
          sql: `SELECT album_source_id,public_product_id
                  FROM supplier_sync_stage_product_details d
                 WHERE d.run_id=?1 AND d.detail_state='pending'
                   AND EXISTS (
                     SELECT 1 FROM supplier_sync_stage_runs r
                      WHERE r.run_id=d.run_id AND r.tenant_id=?3 AND r.source_key=?4
                   )
                 ORDER BY public_product_id ASC
                 LIMIT ?2`,
          params: [
            context.importId,
            MAX_REPLAY_DETAIL_ITEMS,
            context.tenantId,
            context.sourceKey
          ]
        }
      ]
    },
    { fetchImpl }
  );
  const rows = selected[0]?.results || [];
  if (!rows.length) throw new Error('sync_replay_detail_candidate_missing');
  for (let offset = 0; offset < rows.length; offset += MAX_REPLAY_DETAIL_BATCH) {
    const chunk = rows.slice(offset, offset + MAX_REPLAY_DETAIL_BATCH);
    await env.TENANT_IMPORT_DETAIL_QUEUE.sendBatch(
      chunk.map((row) => ({
        body: assertPublicSafeImportMessage(
          buildTenantImportDetailMessage({
            importId: context.importId,
            tenantId: context.tenantId,
            sourceKey: context.sourceKey,
            albumSourceId: row.album_source_id
          })
        ),
        contentType: 'json'
      }))
    );
  }
  await queryBatch(
    {
      ...authority.platform,
      databaseId: context.dataPlane.databaseId,
      batch: rows.map((row) => ({
        sql: `UPDATE supplier_sync_stage_product_details
                 SET outcome_code='sync_detail_replay_queued',updated_at=CURRENT_TIMESTAMP
               WHERE run_id=?1 AND public_product_id=?2 AND detail_state='pending'`,
        params: [context.importId, row.public_product_id]
      }))
    },
    { fetchImpl }
  );
  return rows.length;
}

async function replayDecision(replay, context, authority, env, queryBatch, fetchImpl) {
  const row = authority.row;
  if (!replayAuthorityAdmissible(replay, context, row)) {
    throw new Error('sync_replay_authority_stale');
  }
  if (replay.phase === 'scan') {
    if (row.state && !['staging', 'failed', 'preserved', 'quarantined'].includes(row.state)) {
      throw new Error('sync_replay_scan_stage_not_admissible');
    }
    return { status: 'pending', phase: 'scan', itemCount: 0 };
  }
  if (replay.phase === 'detail') {
    const itemCount = await replayDetailCandidates(context, authority, env, queryBatch, fetchImpl);
    return { status: 'details', phase: 'details', itemCount };
  }
  if (replay.phase === 'classification') {
    if (row.state !== 'details_complete' || row.safety_outcome !== 'proceed') {
      throw new Error('sync_replay_classification_stage_not_admissible');
    }
    return { status: 'details', phase: 'details', itemCount: 0 };
  }
  if (replay.phase === 'verification') {
    if (!['failed', 'details_complete'].includes(row.state) || row.safety_outcome !== 'proceed') {
      throw new Error('sync_replay_verification_stage_not_admissible');
    }
    if (row.state === 'failed') {
      const reset = await resetReplayVerification(context, authority, queryBatch, fetchImpl);
      if (!reset) throw new Error('sync_replay_verification_cas_conflict');
    }
    return { status: 'details', phase: 'details', itemCount: 0 };
  }
  if (!['verified', 'promoted'].includes(row.state)) {
    throw new Error('sync_replay_finalization_stage_not_admissible');
  }
  return { status: 'finalizing', phase: 'finalize', itemCount: 0 };
}

async function commitReplay(db, replay, job, token, decision) {
  const results = await db.batch([
    db
      .prepare(
        `UPDATE tenant_import_jobs
          SET status=?5,phase=?6,next_attempt_at=CASE WHEN ?5='pending' THEN CURRENT_TIMESTAMP ELSE NULL END,
              recovery_attempt_count=0,last_failure_phase=NULL,last_error_code=NULL,
              last_recovery_at=CURRENT_TIMESTAMP,state_revision=state_revision+1,
              updated_at=CURRENT_TIMESTAMP
        WHERE import_id=?1 AND tenant_id=?2 AND source_key=?3
          AND status='failed' AND state_revision=CAST(?4 AS INTEGER)
          AND EXISTS (
            SELECT 1 FROM tenant_sync_replay_requests request
             WHERE request.replay_id=?7 AND request.status='processing'
               AND request.lease_token=?8 AND request.lease_until>CURRENT_TIMESTAMP
          )`
      )
      .bind(
        job.import_id,
        job.tenant_id,
        job.source_key,
        replay.expected_job_revision,
        decision.status,
        decision.phase,
        replay.replay_id,
        token
      ),
    db
      .prepare(
        `UPDATE tenant_sync_replay_requests
          SET status='success',replayed_item_count=replayed_item_count+?3,
              next_attempt_at=NULL,lease_token=NULL,lease_until=NULL,last_error_code=NULL,
              finished_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
        WHERE replay_id=?1 AND status='processing' AND lease_token=?2`
      )
      .bind(replay.replay_id, token, decision.itemCount)
  ]);
  return (
    Number(results?.[0]?.meta?.changes || 0) === 1 &&
    Number(results?.[1]?.meta?.changes || 0) === 1
  );
}

async function failReplay(db, replay, token, error) {
  const code = safeTenantSyncErrorCode(error, 'sync_replay_failed');
  const nextAttempt = Number(replay.attempt_count || 0) + 1;
  const retry = nextAttempt < MAX_REPLAY_ATTEMPTS && /(?:failed|unavailable|unreachable|timeout)$/.test(code);
  const modifier = `+${tenantSyncRecoveryDelayMinutes(nextAttempt)} minutes`;
  await db
    .prepare(
      `UPDATE tenant_sync_replay_requests
          SET status='failed',next_attempt_at=CASE WHEN ?3=1 THEN datetime(CURRENT_TIMESTAMP,?4) ELSE NULL END,
              lease_token=NULL,lease_until=NULL,last_error_code=?5,
              finished_at=CASE WHEN ?3=1 THEN NULL ELSE CURRENT_TIMESTAMP END,
              updated_at=CURRENT_TIMESTAMP
        WHERE replay_id=?1 AND status='processing' AND lease_token=?2`
    )
    .bind(replay.replay_id, token, retry ? 1 : 0, modifier, code)
    .run();
  return code;
}

export async function runDueTenantSyncReplays(
  env,
  { limit = DEFAULT_LIMIT, queryBatch = queryD1Batch, fetchImpl = fetch } = {}
) {
  if (!env?.CATALOG_DB) return { enabled: false, reason: 'database_unbound', processed: 0 };
  if (!platformRuntimeConfigured(env)) {
    return { enabled: false, reason: 'tenant_ingestion_platform_unconfigured', processed: 0 };
  }
  const db = env.CATALOG_DB;
  const due = await discoverDueReplays(db, boundedLimit(limit));
  const outcomes = [];

  for (const replay of due) {
    const token = await claimReplay(db, replay);
    if (!token) {
      outcomes.push({ replayId: replay.replay_id, phase: replay.phase, outcome: 'busy' });
      continue;
    }
    try {
      const job = await loadReplayJob(db, replay);
      if (!job || job.last_failure_phase !== FAILURE_PHASE_FOR_REPLAY[replay.phase]) {
        throw new Error('sync_replay_job_stale');
      }
      const context = await loadTenantImportContext(
        db,
        {
          importId: replay.import_id,
          tenantId: replay.tenant_id,
          sourceKey: replay.source_key
        },
        { allowedModes: ['incremental'] }
      );
      const authority = await loadReplayAuthority(context, env, queryBatch, fetchImpl);
      const decision = await replayDecision(
        replay,
        context,
        authority,
        env,
        queryBatch,
        fetchImpl
      );
      const committed = await commitReplay(db, replay, job, token, decision);
      if (!committed) throw new Error('sync_replay_control_cas_conflict');
      outcomes.push({
        replayId: replay.replay_id,
        runId: replay.import_id,
        phase: replay.phase,
        outcome: 'success',
        itemCount: decision.itemCount
      });
    } catch (error) {
      const code = await failReplay(db, replay, token, error);
      outcomes.push({
        replayId: replay.replay_id,
        runId: replay.import_id,
        phase: replay.phase,
        outcome: 'failed',
        error: code
      });
    }
  }

  return {
    enabled: true,
    reason: null,
    selected: due.length,
    processed: outcomes.length,
    succeeded: outcomes.filter((entry) => entry.outcome === 'success').length,
    failed: outcomes.filter((entry) => entry.outcome === 'failed').length,
    busy: outcomes.filter((entry) => entry.outcome === 'busy').length,
    outcomes
  };
}

export async function readTenantSyncOperations(db, tenantId, { limit = 20 } = {}) {
  const bounded = Math.min(Math.max(Number.parseInt(limit, 10) || 20, 1), 50);
  const [jobs, replays, counts] = await Promise.all([
    db
      .prepare(
        `SELECT import_id,status,phase,state_revision,recovery_attempt_count,last_failure_phase,
                last_error_code,next_attempt_at,phase_lease_until,last_delivery_at,
                created_at,updated_at,finished_at
           FROM tenant_import_jobs
          WHERE tenant_id=?1 AND mode='incremental'
          ORDER BY created_at DESC
          LIMIT ?2`
      )
      .bind(tenantId, bounded)
      .all(),
    db
      .prepare(
        `SELECT replay_id,import_id,phase,status,attempt_count,replayed_item_count,
                last_error_code,created_at,updated_at,finished_at
           FROM tenant_sync_replay_requests
          WHERE tenant_id=?1
          ORDER BY created_at DESC
          LIMIT ?2`
      )
      .bind(tenantId, bounded)
      .all(),
    db
      .prepare(
        `SELECT
           SUM(CASE WHEN status IN ('pending','queued','scanning','details','finalizing') THEN 1 ELSE 0 END) AS backlog,
           SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
           SUM(CASE WHEN phase_lease_token IS NOT NULL AND phase_lease_until>CURRENT_TIMESTAMP THEN 1 ELSE 0 END) AS leased
           FROM tenant_import_jobs
          WHERE tenant_id=?1 AND mode='incremental'`
      )
      .bind(tenantId)
      .first()
  ]);
  return {
    tenantId,
    queue: { status: 'managed', backlog: Number(counts?.backlog || 0), dlqCount: null },
    failedCount: Number(counts?.failed || 0),
    activeLeaseCount: Number(counts?.leased || 0),
    jobs: (jobs.results || []).map((row) => ({
      runId: row.import_id,
      phase: row.phase,
      state: row.status,
      revision: Number(row.state_revision || 0),
      retryCount: Number(row.recovery_attempt_count || 0),
      failurePhase: row.last_failure_phase || null,
      safeErrorCode: row.last_error_code
        ? safeTenantSyncErrorCode(row.last_error_code, 'tenant_sync_operation_failed')
        : null,
      nextAttemptAt: row.next_attempt_at || null,
      leaseUntil: row.phase_lease_until || null,
      lastDeliveryAt: row.last_delivery_at || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      finishedAt: row.finished_at || null
    })),
    replays: (replays.results || []).map(publicReplay)
  };
}
