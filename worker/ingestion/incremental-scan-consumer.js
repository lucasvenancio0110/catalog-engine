import { queryD1Batch } from '../cloudflare-platform.js';
import {
  assertPublicSafeImportMessage,
  buildTenantImportDetailMessage
} from '../tenant-import-queue.js';
import { planTenantIncrementalScanFromProvider } from './incremental-scan.js';
import { buildIncrementalStageWritePlan } from './incremental-stage.js';

const MIN_INCREMENTAL_STAGE_SCHEMA_VERSION = 5;
const MIN_INCREMENTAL_DETAIL_SCHEMA_VERSION = 6;
const SCAN_LEASE_MINUTES = 14;
const DETAIL_QUEUE_BATCH = 100;

function safeIncrementalReason(value, fallback = 'sync_safety_blocked') {
  const code = String(value || '').trim();
  return /^sync_[a-z0-9_]+$/.test(code) ? code : fallback;
}

function boundedCount(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

export function assertIncrementalScanStageContext(context) {
  if (context?.mode !== 'incremental') {
    throw new Error('tenant_sync_incremental_context_required');
  }
  if (Number(context.schemaVersion || 0) < MIN_INCREMENTAL_STAGE_SCHEMA_VERSION) {
    throw new Error('tenant_schema_not_ready');
  }
  if (!['scan', 'details'].includes(context.phase)) {
    throw new Error('tenant_import_phase_not_runnable');
  }
}

async function claimIncrementalScanLease(db, context) {
  if (
    context.phase === 'details' &&
    boundedCount(context.detailEnqueueCursor) >= boundedCount(context.discoveredCount)
  ) {
    return { claimed: false, complete: true };
  }
  const result = await db
    .prepare(
      `UPDATE tenant_import_jobs
          SET status='scanning',
              scan_lease_until=datetime(CURRENT_TIMESTAMP, ?2),
              started_at=COALESCE(started_at,CURRENT_TIMESTAMP),
              last_error_code=NULL,
              updated_at=CURRENT_TIMESTAMP
        WHERE import_id=?1
          AND tenant_id=?3
          AND source_key=?4
          AND mode='incremental'
          AND (
            (phase='scan' AND status IN ('queued','scanning')) OR
            (phase='details' AND status IN ('details','failed'))
          )
          AND (scan_lease_until IS NULL OR scan_lease_until <= CURRENT_TIMESTAMP)`
    )
    .bind(
      context.importId,
      `+${SCAN_LEASE_MINUTES} minutes`,
      context.tenantId,
      context.sourceKey
    )
    .run();
  return { claimed: Number(result.meta?.changes || 0) > 0, complete: false };
}

async function releaseIncrementalScanLease(db, context) {
  await db
    .prepare(
      `UPDATE tenant_import_jobs
          SET scan_lease_until=NULL, updated_at=CURRENT_TIMESTAMP
        WHERE import_id=?1 AND tenant_id=?2 AND source_key=?3 AND mode='incremental'`
    )
    .bind(context.importId, context.tenantId, context.sourceKey)
    .run();
}

async function executeStageWritePlan(context, platform, writePlan, { queryBatch, fetchImpl }) {
  const request = (batch) =>
    queryBatch(
      { ...platform, databaseId: context.dataPlane.databaseId, batch },
      { fetchImpl }
    );

  await request(writePlan.beginBatch);
  for (const batch of writePlan.observationBatches) await request(batch);
  for (const batch of writePlan.eventBatches) await request(batch);
  for (const batch of writePlan.categoryBatches) await request(batch);
  await request(writePlan.sealBatch);

  const verification = await request([
    {
      sql: `SELECT state, safety_outcome, observed_count, staged_observation_count,
                   expected_event_count, staged_event_count, expected_detail_count,
                   staged_category_count, last_error_code
              FROM supplier_sync_stage_runs
             WHERE run_id=?1 AND tenant_id=?2 AND source_key=?3
             LIMIT 1`,
      params: [context.importId, context.tenantId, context.sourceKey]
    }
  ]);
  const row = verification[0]?.results?.[0] || null;
  if (!row) throw new Error('tenant_sync_stage_missing');
  if (row.state === 'failed') {
    throw new Error(safeIncrementalReason(row.last_error_code, 'sync_stage_count_mismatch'));
  }
  return row;
}

async function markIncrementalStageReady(db, context, result) {
  const detailCount = boundedCount(result.detailIds?.length);
  const update = await db
    .prepare(
      `UPDATE tenant_import_jobs
          SET status='details', phase='details',
              discovered_count=?2,
              detail_enqueue_cursor=0,
              queued_detail_count=0,
              completed_detail_count=0,
              failed_detail_count=0,
              deferred_detail_count=0,
              scan_completed_at=CURRENT_TIMESTAMP,
              scan_lease_until=datetime(CURRENT_TIMESTAMP, ?5),
              next_attempt_at=NULL,
              last_error_code=NULL,
              updated_at=CURRENT_TIMESTAMP
        WHERE import_id=?1 AND tenant_id=?3 AND source_key=?4
          AND mode='incremental' AND phase='scan' AND status='scanning'`
    )
    .bind(
      context.importId,
      detailCount,
      context.tenantId,
      context.sourceKey,
      `+${SCAN_LEASE_MINUTES} minutes`
    )
    .run();
  if (Number(update.meta?.changes || 0) !== 1) {
    throw new Error('tenant_sync_job_state_conflict');
  }
}

async function markIncrementalStageBlocked(db, context, result) {
  const safeCode = safeIncrementalReason(result.reason || result.decision?.reasons?.[0]);
  const update = await db
    .prepare(
      `UPDATE tenant_import_jobs
          SET status='failed', phase='scan',
              discovered_count=0,
              detail_enqueue_cursor=0,
              queued_detail_count=0,
              scan_completed_at=CURRENT_TIMESTAMP,
              scan_lease_until=NULL,
              next_attempt_at=NULL,
              last_error_code=?2,
              updated_at=CURRENT_TIMESTAMP
        WHERE import_id=?1 AND tenant_id=?3 AND source_key=?4
          AND mode='incremental' AND phase='scan' AND status='scanning'`
    )
    .bind(context.importId, safeCode, context.tenantId, context.sourceKey)
    .run();
  if (Number(update.meta?.changes || 0) !== 1) {
    throw new Error('tenant_sync_job_state_conflict');
  }
  return safeCode;
}

async function nextAffectedDetailIds(context, platform, cursor, queryBatch, fetchImpl) {
  const result = await queryBatch(
    {
      ...platform,
      databaseId: context.dataPlane.databaseId,
      batch: [
        {
          sql: `SELECT album_source_id
                  FROM supplier_sync_stage_events
                 WHERE run_id=?1 AND needs_detail=1
                 ORDER BY album_source_id ASC
                 LIMIT ?2 OFFSET ?3`,
          params: [context.importId, DETAIL_QUEUE_BATCH, cursor]
        }
      ]
    },
    { fetchImpl }
  );
  return (result[0]?.results || []).map((row) => String(row.album_source_id || '')).filter(Boolean);
}

async function updateFanoutCursor(db, context, previousCursor, nextCursor) {
  const update = await db
    .prepare(
      `UPDATE tenant_import_jobs
          SET detail_enqueue_cursor=?2,
              queued_detail_count=?2,
              scan_lease_until=datetime(CURRENT_TIMESTAMP, ?3),
              updated_at=CURRENT_TIMESTAMP
        WHERE import_id=?1 AND tenant_id=?4 AND source_key=?5
          AND mode='incremental' AND phase='details'
          AND detail_enqueue_cursor=?6`
    )
    .bind(
      context.importId,
      nextCursor,
      `+${SCAN_LEASE_MINUTES} minutes`,
      context.tenantId,
      context.sourceKey,
      previousCursor
    )
    .run();
  if (Number(update.meta?.changes || 0) !== 1) {
    throw new Error('tenant_sync_detail_fanout_cursor_conflict');
  }
}

async function finishDetailFanout(db, context, discoveredCount) {
  const update = await db
    .prepare(
      `UPDATE tenant_import_jobs
          SET status='details', phase='details',
              detail_enqueue_cursor=?2,
              queued_detail_count=?2,
              scan_lease_until=NULL,
              next_attempt_at=NULL,
              last_error_code=NULL,
              updated_at=CURRENT_TIMESTAMP
        WHERE import_id=?1 AND tenant_id=?3 AND source_key=?4
          AND mode='incremental' AND phase='details'`
    )
    .bind(context.importId, discoveredCount, context.tenantId, context.sourceKey)
    .run();
  if (Number(update.meta?.changes || 0) !== 1) {
    throw new Error('tenant_sync_job_state_conflict');
  }
}

async function prepareFanoutRetry(db, context) {
  await db
    .prepare(
      `UPDATE tenant_import_jobs
          SET phase='scan', scan_lease_until=NULL, updated_at=CURRENT_TIMESTAMP
        WHERE import_id=?1 AND tenant_id=?2 AND source_key=?3
          AND mode='incremental' AND phase='details'
          AND detail_enqueue_cursor < discovered_count`
    )
    .bind(context.importId, context.tenantId, context.sourceKey)
    .run();
}

async function fanOutAffectedDetails(
  db,
  context,
  platform,
  detailQueue,
  { queryBatch, fetchImpl }
) {
  if (!detailQueue || typeof detailQueue.sendBatch !== 'function') {
    throw new Error('tenant_import_detail_queue_unbound');
  }
  if (Number(context.schemaVersion || 0) < MIN_INCREMENTAL_DETAIL_SCHEMA_VERSION) {
    throw new Error('tenant_schema_not_ready');
  }
  let cursor = boundedCount(context.detailEnqueueCursor);
  const discoveredCount = boundedCount(context.discoveredCount);
  while (cursor < discoveredCount) {
    const albumIds = await nextAffectedDetailIds(
      context,
      platform,
      cursor,
      queryBatch,
      fetchImpl
    );
    if (!albumIds.length) throw new Error('sync_detail_stage_incomplete');
    const messages = albumIds.map((albumSourceId) => ({
      body: assertPublicSafeImportMessage(
        buildTenantImportDetailMessage({
          importId: context.importId,
          tenantId: context.tenantId,
          sourceKey: context.sourceKey,
          albumSourceId
        })
      ),
      contentType: 'json'
    }));
    await detailQueue.sendBatch(messages);
    const nextCursor = cursor + albumIds.length;
    await updateFanoutCursor(db, context, cursor, nextCursor);
    cursor = nextCursor;
  }
  await finishDetailFanout(db, context, discoveredCount);
  return cursor;
}

async function loadExistingStageForFanout(context, platform, queryBatch, fetchImpl) {
  const result = await queryBatch(
    {
      ...platform,
      databaseId: context.dataPlane.databaseId,
      batch: [
        {
          sql: `SELECT state, safety_outcome, expected_detail_count
                  FROM supplier_sync_stage_runs
                 WHERE run_id=?1 AND tenant_id=?2 AND source_key=?3
                 LIMIT 1`,
          params: [context.importId, context.tenantId, context.sourceKey]
        }
      ]
    },
    { fetchImpl }
  );
  return result[0]?.results?.[0] || null;
}

export async function handleTenantIncrementalScan(
  { db, context, provider, platform, detailQueue = null },
  { queryBatch = queryD1Batch, fetchImpl = fetch } = {}
) {
  assertIncrementalScanStageContext(context);
  if (context.phase === 'scan' && context.importStatus === 'failed' && context.discoveredCount <= 0) {
    return { outcome: 'success', alreadyFailed: true };
  }
  const lease = await claimIncrementalScanLease(db, context);
  if (lease.complete) return { outcome: 'success', alreadyStaged: true };
  if (!lease.claimed) return { outcome: 'busy' };

  try {
    if (context.discoveredCount > 0) {
      const existing = await loadExistingStageForFanout(context, platform, queryBatch, fetchImpl);
      if (
        existing &&
        existing.safety_outcome === 'proceed' &&
        ['details_pending', 'details_complete'].includes(String(existing.state || '')) &&
        boundedCount(existing.expected_detail_count) === boundedCount(context.discoveredCount)
      ) {
        if (context.phase === 'scan') {
          const resumed = await db
            .prepare(
              `UPDATE tenant_import_jobs
                  SET status='details', phase='details',
                      scan_lease_until=datetime(CURRENT_TIMESTAMP, ?2),
                      last_error_code=NULL, updated_at=CURRENT_TIMESTAMP
                WHERE import_id=?1 AND tenant_id=?3 AND source_key=?4
                  AND mode='incremental' AND status='scanning'`
            )
            .bind(
              context.importId,
              `+${SCAN_LEASE_MINUTES} minutes`,
              context.tenantId,
              context.sourceKey
            )
            .run();
          if (Number(resumed.meta?.changes || 0) !== 1) {
            throw new Error('tenant_sync_job_state_conflict');
          }
        }
        const resumeContext = { ...context, phase: 'details' };
        try {
          const queued = await fanOutAffectedDetails(
            db,
            resumeContext,
            platform,
            detailQueue,
            { queryBatch, fetchImpl }
          );
          return {
            outcome: 'success',
            alreadyStaged: true,
            stageState: String(existing.state || 'details_pending'),
            detailCount: boundedCount(context.discoveredCount),
            queued
          };
        } catch (error) {
          await prepareFanoutRetry(db, resumeContext).catch(() => {});
          throw error;
        }
      }
    }

    const result = await planTenantIncrementalScanFromProvider(
      { context, provider, platform },
      { queryBatch, fetchImpl }
    );
    const writePlan = buildIncrementalStageWritePlan({
      context,
      scan: result.scan,
      plan: result.plan
    });
    const stage = await executeStageWritePlan(context, platform, writePlan, {
      queryBatch,
      fetchImpl
    });

    if (result.decision.outcome !== 'proceed') {
      const reason = await markIncrementalStageBlocked(db, context, result);
      return {
        outcome: 'success',
        stageOutcome: result.decision.outcome,
        stageState: stage.state,
        reason,
        detailCount: 0,
        counts: result.counts
      };
    }

    if (!['planned', 'details_pending'].includes(String(stage.state || ''))) {
      throw new Error('tenant_sync_stage_state_invalid');
    }
    await markIncrementalStageReady(db, context, result);
    const detailCount = boundedCount(result.detailIds.length);
    let queued = 0;
    if (detailCount > 0) {
      const detailContext = {
        ...context,
        phase: 'details',
        importStatus: 'details',
        discoveredCount: detailCount,
        detailEnqueueCursor: 0
      };
      try {
        queued = await fanOutAffectedDetails(
          db,
          detailContext,
          platform,
          detailQueue,
          { queryBatch, fetchImpl }
        );
      } catch (error) {
        await prepareFanoutRetry(db, detailContext).catch(() => {});
        throw error;
      }
    } else {
      await finishDetailFanout(db, { ...context, phase: 'details' }, 0);
    }
    return {
      outcome: 'success',
      stageOutcome: 'proceed',
      stageState: stage.state,
      detailCount,
      queued,
      counts: result.counts
    };
  } finally {
    await releaseIncrementalScanLease(db, context).catch(() => {});
  }
}
