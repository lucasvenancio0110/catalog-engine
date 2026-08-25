import { queryD1Batch } from '../cloudflare-platform.js';
import { planTenantIncrementalScanFromProvider } from './incremental-scan.js';
import { buildIncrementalStageWritePlan } from './incremental-stage.js';

const MIN_INCREMENTAL_STAGE_SCHEMA_VERSION = 5;
const SCAN_LEASE_MINUTES = 14;

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
  if (context.phase === 'details') return { claimed: false, complete: true };
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
          AND phase='scan'
          AND status IN ('queued','scanning')
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
  await db
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
              scan_lease_until=NULL,
              next_attempt_at=NULL,
              last_error_code=NULL,
              updated_at=CURRENT_TIMESTAMP
        WHERE import_id=?1 AND tenant_id=?3 AND source_key=?4
          AND mode='incremental' AND phase='scan'`
    )
    .bind(
      context.importId,
      boundedCount(result.counts?.scannedAlbums),
      context.tenantId,
      context.sourceKey
    )
    .run();
}

async function markIncrementalStageBlocked(db, context, result) {
  const safeCode = safeIncrementalReason(result.reason || result.decision?.reasons?.[0]);
  await db
    .prepare(
      `UPDATE tenant_import_jobs
          SET status='failed', phase='scan',
              discovered_count=?2,
              scan_completed_at=CURRENT_TIMESTAMP,
              scan_lease_until=NULL,
              next_attempt_at=NULL,
              last_error_code=?3,
              updated_at=CURRENT_TIMESTAMP
        WHERE import_id=?1 AND tenant_id=?4 AND source_key=?5
          AND mode='incremental' AND phase='scan'`
    )
    .bind(
      context.importId,
      boundedCount(result.counts?.scannedAlbums),
      safeCode,
      context.tenantId,
      context.sourceKey
    )
    .run();
  return safeCode;
}

export async function handleTenantIncrementalScan(
  { db, context, provider, platform },
  { queryBatch = queryD1Batch, fetchImpl = fetch } = {}
) {
  assertIncrementalScanStageContext(context);
  if (context.phase === 'scan' && context.importStatus === 'failed') {
    return { outcome: 'success', alreadyFailed: true };
  }
  const lease = await claimIncrementalScanLease(db, context);
  if (lease.complete) return { outcome: 'success', alreadyStaged: true };
  if (!lease.claimed) return { outcome: 'busy' };

  try {
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
    return {
      outcome: 'success',
      stageOutcome: 'proceed',
      stageState: stage.state,
      detailCount: result.detailIds.length,
      counts: result.counts
    };
  } finally {
    await releaseIncrementalScanLease(db, context).catch(() => {});
  }
}
