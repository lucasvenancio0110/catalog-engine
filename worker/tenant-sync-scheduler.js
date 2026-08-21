import { incrementalTenantImportId } from './tenant-import-queue.js';

const DEFAULT_LIMIT = 4;
const MAX_LIMIT = 10;
export const DEFAULT_TENANT_SYNC_INTERVAL_MINUTES = 360;
export const MIN_TENANT_SYNC_INTERVAL_MINUTES = 15;
export const MAX_TENANT_SYNC_INTERVAL_MINUTES = 10080;

function boundedLimit(value) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function boundedIntervalMinutes(value) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return DEFAULT_TENANT_SYNC_INTERVAL_MINUTES;
  return Math.min(
    MAX_TENANT_SYNC_INTERVAL_MINUTES,
    Math.max(MIN_TENANT_SYNC_INTERVAL_MINUTES, parsed)
  );
}

export function tenantSyncAutomationEnabled(env) {
  return String(env?.TENANT_SYNC_AUTOMATION_ENABLED || '').trim() === '1';
}

async function discoverEligibleSchedules(db, limit, intervalMinutes) {
  const result = await db
    .prepare(
      `SELECT s.tenant_id, s.source_key
         FROM supplier_sources s
         JOIN catalog_tenants t ON t.tenant_id=s.tenant_id
         JOIN tenant_catalog_instances i ON i.tenant_id=s.tenant_id
         JOIN tenant_store_profiles p ON p.tenant_id=s.tenant_id
        WHERE t.status='active'
          AND s.status='active'
          AND s.sync_strategy='incremental'
          AND i.status='ready'
          AND p.setup_status IN ('ready','published')
          AND EXISTS (
            SELECT 1
              FROM tenant_import_jobs initial_job
             WHERE initial_job.tenant_id=s.tenant_id
               AND initial_job.source_key=s.source_key
               AND initial_job.mode='initial'
               AND initial_job.status='success'
          )
          AND NOT EXISTS (
            SELECT 1
              FROM tenant_sync_schedules existing_schedule
             WHERE existing_schedule.tenant_id=s.tenant_id
               AND existing_schedule.source_key=s.source_key
          )
        ORDER BY s.created_at ASC, s.tenant_id ASC, s.source_key ASC
        LIMIT ?1`
    )
    .bind(limit)
    .all();

  let discovered = 0;
  const intervalModifier = `+${intervalMinutes} minutes`;
  for (const row of result.results || []) {
    const outcome = await db
      .prepare(
        `INSERT OR IGNORE INTO tenant_sync_schedules
          (tenant_id, source_key, status, incremental_interval_minutes, next_sync_at,
           created_at, updated_at)
         VALUES (?1, ?2, 'active', ?3, datetime(CURRENT_TIMESTAMP, ?4),
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      )
      .bind(row.tenant_id, row.source_key, intervalMinutes, intervalModifier)
      .run();
    if (Number(outcome?.meta?.changes || 0) > 0) discovered += 1;
  }
  return discovered;
}

async function dueSchedules(db, limit) {
  const result = await db
    .prepare(
      `SELECT schedule.tenant_id, schedule.source_key, schedule.next_sync_at,
              schedule.incremental_interval_minutes
         FROM tenant_sync_schedules schedule
         JOIN supplier_sources source
           ON source.tenant_id=schedule.tenant_id AND source.source_key=schedule.source_key
         JOIN catalog_tenants tenant ON tenant.tenant_id=schedule.tenant_id
         JOIN tenant_catalog_instances instance ON instance.tenant_id=schedule.tenant_id
         JOIN tenant_store_profiles profile ON profile.tenant_id=schedule.tenant_id
        WHERE schedule.status='active'
          AND schedule.next_sync_at <= CURRENT_TIMESTAMP
          AND source.status='active'
          AND source.sync_strategy='incremental'
          AND tenant.status='active'
          AND instance.status='ready'
          AND profile.setup_status IN ('ready','published')
          AND EXISTS (
            SELECT 1
              FROM tenant_import_jobs initial_job
             WHERE initial_job.tenant_id=schedule.tenant_id
               AND initial_job.source_key=schedule.source_key
               AND initial_job.mode='initial'
               AND initial_job.status='success'
          )
          AND NOT EXISTS (
            SELECT 1
              FROM tenant_import_jobs active_job
             WHERE active_job.tenant_id=schedule.tenant_id
               AND active_job.source_key=schedule.source_key
               AND active_job.status IN ('pending','queued','scanning','details','finalizing')
          )
        ORDER BY schedule.next_sync_at ASC, schedule.tenant_id ASC, schedule.source_key ASC
        LIMIT ?1`
    )
    .bind(limit)
    .all();
  return result.results || [];
}

async function createIncrementalJob(db, schedule) {
  const intervalMinutes = boundedIntervalMinutes(schedule.incremental_interval_minutes);
  const scheduledFor = String(schedule.next_sync_at || '').trim();
  const importId = await incrementalTenantImportId({
    tenantId: schedule.tenant_id,
    sourceKey: schedule.source_key,
    scheduledFor
  });
  const intervalModifier = `+${intervalMinutes} minutes`;

  const batchResults = await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO tenant_import_jobs
          (import_id, tenant_id, source_key, mode, status, phase, attempt_count,
           next_attempt_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'incremental', 'pending', 'scan', 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      )
      .bind(importId, schedule.tenant_id, schedule.source_key),
    db
      .prepare(
        `UPDATE tenant_sync_schedules
            SET last_scheduled_at=CURRENT_TIMESTAMP,
                last_import_id=?4,
                next_sync_at=datetime(CURRENT_TIMESTAMP, ?5),
                updated_at=CURRENT_TIMESTAMP
          WHERE tenant_id=?1
            AND source_key=?2
            AND status='active'
            AND next_sync_at=?3
            AND EXISTS (
              SELECT 1
                FROM tenant_import_jobs scheduled_job
               WHERE scheduled_job.import_id=?4
                 AND scheduled_job.tenant_id=?1
                 AND scheduled_job.source_key=?2
                 AND scheduled_job.mode='incremental'
            )`
      )
      .bind(
        schedule.tenant_id,
        schedule.source_key,
        scheduledFor,
        importId,
        intervalModifier
      )
  ]);

  const claimed = Number(batchResults?.[1]?.meta?.changes || 0) > 0;
  if (!claimed) return { scheduled: false, importId: null };

  const verification = await db
    .prepare(
      `SELECT import_id, status, phase
         FROM tenant_import_jobs
        WHERE import_id=?1
          AND tenant_id=?2
          AND source_key=?3
          AND mode='incremental'
        LIMIT 1`
    )
    .bind(importId, schedule.tenant_id, schedule.source_key)
    .first();

  return verification?.import_id === importId
    ? { scheduled: true, importId }
    : { scheduled: false, importId: null };
}

export async function runDueTenantSyncScheduling(
  env,
  {
    limit = DEFAULT_LIMIT,
    defaultIntervalMinutes = DEFAULT_TENANT_SYNC_INTERVAL_MINUTES
  } = {}
) {
  if (!env?.CATALOG_DB) {
    return { enabled: false, reason: 'database_unbound', discovered: 0, selected: 0, scheduled: 0 };
  }
  if (!tenantSyncAutomationEnabled(env)) {
    return {
      enabled: false,
      reason: 'tenant_sync_automation_disabled',
      discovered: 0,
      selected: 0,
      scheduled: 0
    };
  }

  const db = env.CATALOG_DB;
  const jobLimit = boundedLimit(limit);
  const intervalMinutes = boundedIntervalMinutes(defaultIntervalMinutes);
  const discovered = await discoverEligibleSchedules(db, jobLimit, intervalMinutes);
  const due = await dueSchedules(db, jobLimit);
  let scheduled = 0;
  let busy = 0;

  for (const schedule of due) {
    const outcome = await createIncrementalJob(db, schedule);
    if (outcome.scheduled) scheduled += 1;
    else busy += 1;
  }

  return {
    enabled: true,
    discovered,
    selected: due.length,
    processed: due.length,
    scheduled,
    succeeded: scheduled,
    busy,
    failed: 0
  };
}
