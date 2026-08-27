import { incrementalTenantImportId } from './tenant-import-queue.js';

const DEFAULT_LIMIT = 1;
const MAX_LIMIT = 10;
const ACTIVE_COHORT_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;
export const DEFAULT_TENANT_SYNC_INTERVAL_MINUTES = 360;
export const MIN_TENANT_SYNC_INTERVAL_MINUTES = 15;
export const MAX_TENANT_SYNC_INTERVAL_MINUTES = 10080;

export const TENANT_SYNC_DECISION_CODES = Object.freeze([
  'tenant_sync_enrollment_disabled',
  'tenant_sync_cohort_mismatch',
  'tenant_sync_tenant_not_ready',
  'tenant_sync_source_not_ready',
  'tenant_sync_initial_not_ready',
  'tenant_sync_migration_conflict',
  'tenant_sync_unresolved_failure',
  'tenant_sync_job_conflict',
  'tenant_sync_schedule_missing',
  'tenant_sync_schedule_inactive',
  'tenant_sync_not_due',
  'tenant_sync_ready'
]);

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

function configuredCohort(env) {
  const value = String(env?.TENANT_SYNC_ACTIVE_COHORT || '').trim();
  if (!value) return { cohort: null, reason: 'tenant_sync_cohort_unset' };
  if (!ACTIVE_COHORT_PATTERN.test(value)) {
    return { cohort: null, reason: 'tenant_sync_cohort_invalid' };
  }
  return { cohort: value, reason: null };
}

function emptyDecisionCounts() {
  return Object.fromEntries(TENANT_SYNC_DECISION_CODES.map((code) => [code, 0]));
}

function inactiveSummary(reason) {
  return {
    enabled: false,
    reason,
    limit: 0,
    discovered: 0,
    selected: 0,
    scheduled: 0,
    decisionCounts: emptyDecisionCounts()
  };
}

export function tenantSyncAutomationEnabled(env) {
  return String(env?.TENANT_SYNC_AUTOMATION_ENABLED || '').trim() === '1';
}

async function discoverEligibleSchedules(db, cohort, limit, intervalMinutes) {
  const result = await db
    .prepare(
      `SELECT source.tenant_id, source.source_key
         FROM tenant_sync_enrollments enrollment
         JOIN supplier_sources source
           ON source.tenant_id=enrollment.tenant_id
          AND source.source_key=enrollment.source_key
         JOIN catalog_tenants tenant ON tenant.tenant_id=source.tenant_id
         JOIN tenant_catalog_instances instance ON instance.tenant_id=source.tenant_id
         JOIN tenant_store_profiles profile ON profile.tenant_id=source.tenant_id
        WHERE enrollment.status='enrolled'
          AND enrollment.cohort_key=?1
          AND tenant.status='active'
          AND source.status='active'
          AND source.sync_strategy='incremental'
          AND instance.status='ready'
          AND profile.setup_status IN ('ready','published')
          AND EXISTS (
            SELECT 1
              FROM tenant_import_jobs initial_job
             WHERE initial_job.tenant_id=source.tenant_id
               AND initial_job.source_key=source.source_key
               AND initial_job.mode='initial'
               AND initial_job.status='success'
          )
          AND NOT EXISTS (
            SELECT 1
              FROM tenant_sync_schedules existing_schedule
             WHERE existing_schedule.tenant_id=source.tenant_id
               AND existing_schedule.source_key=source.source_key
          )
        ORDER BY source.created_at ASC, source.tenant_id ASC, source.source_key ASC
        LIMIT ?2`
    )
    .bind(cohort, limit)
    .all();

  let discovered = 0;
  const intervalModifier = `+${intervalMinutes} minutes`;
  for (const row of result.results || []) {
    const outcome = await db
      .prepare(
        `INSERT OR IGNORE INTO tenant_sync_schedules
          (tenant_id, source_key, status, incremental_interval_minutes, next_sync_at,
           created_at, updated_at)
         SELECT ?1, ?2, 'active', ?3, datetime(CURRENT_TIMESTAMP, ?4),
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          WHERE EXISTS (
            SELECT 1
              FROM tenant_sync_enrollments enrollment
             WHERE enrollment.tenant_id=?1
               AND enrollment.source_key=?2
               AND enrollment.status='enrolled'
               AND enrollment.cohort_key=?5
          )`
      )
      .bind(row.tenant_id, row.source_key, intervalMinutes, intervalModifier, cohort)
      .run();
    if (Number(outcome?.meta?.changes || 0) > 0) discovered += 1;
  }
  return discovered;
}

async function schedulingDecisionCounts(db, cohort) {
  const result = await db
    .prepare(
      `SELECT decision.reason_code, COUNT(*) AS total
         FROM (
           SELECT CASE
             WHEN enrollment.status<>'enrolled' THEN 'tenant_sync_enrollment_disabled'
             WHEN enrollment.cohort_key<>?1 THEN 'tenant_sync_cohort_mismatch'
             WHEN tenant.status<>'active'
               OR COALESCE(instance.status,'')<>'ready'
               OR COALESCE(profile.setup_status,'') NOT IN ('ready','published')
               THEN 'tenant_sync_tenant_not_ready'
             WHEN source.status<>'active' OR source.sync_strategy<>'incremental'
               THEN 'tenant_sync_source_not_ready'
             WHEN NOT EXISTS (
               SELECT 1
                 FROM tenant_import_jobs initial_job
                WHERE initial_job.tenant_id=enrollment.tenant_id
                  AND initial_job.source_key=enrollment.source_key
                  AND initial_job.mode='initial'
                  AND initial_job.status='success'
             ) THEN 'tenant_sync_initial_not_ready'
             WHEN EXISTS (
               SELECT 1
                 FROM tenant_data_plane_migration_jobs migration_job
                WHERE migration_job.tenant_id=enrollment.tenant_id
                  AND migration_job.status IN ('pending','running','failed')
             ) THEN 'tenant_sync_migration_conflict'
             WHEN EXISTS (
               SELECT 1
                 FROM tenant_import_jobs unresolved_job
                WHERE unresolved_job.tenant_id=enrollment.tenant_id
                  AND unresolved_job.source_key=enrollment.source_key
                  AND unresolved_job.mode IN ('incremental','recovery')
                  AND unresolved_job.status='failed'
             ) THEN 'tenant_sync_unresolved_failure'
             WHEN EXISTS (
               SELECT 1
                 FROM tenant_import_jobs active_job
                WHERE active_job.tenant_id=enrollment.tenant_id
                  AND active_job.source_key=enrollment.source_key
                  AND active_job.status IN ('pending','queued','scanning','details','finalizing')
             ) THEN 'tenant_sync_job_conflict'
             WHEN schedule.tenant_id IS NULL THEN 'tenant_sync_schedule_missing'
             WHEN schedule.status<>'active' THEN 'tenant_sync_schedule_inactive'
             WHEN schedule.next_sync_at>CURRENT_TIMESTAMP THEN 'tenant_sync_not_due'
             ELSE 'tenant_sync_ready'
           END AS reason_code
             FROM tenant_sync_enrollments enrollment
             JOIN supplier_sources source
               ON source.tenant_id=enrollment.tenant_id
              AND source.source_key=enrollment.source_key
             JOIN catalog_tenants tenant ON tenant.tenant_id=enrollment.tenant_id
             LEFT JOIN tenant_catalog_instances instance ON instance.tenant_id=enrollment.tenant_id
             LEFT JOIN tenant_store_profiles profile ON profile.tenant_id=enrollment.tenant_id
             LEFT JOIN tenant_sync_schedules schedule
               ON schedule.tenant_id=enrollment.tenant_id
              AND schedule.source_key=enrollment.source_key
         ) decision
        GROUP BY decision.reason_code`
    )
    .bind(cohort)
    .all();

  const counts = emptyDecisionCounts();
  for (const row of result.results || []) {
    if (Object.hasOwn(counts, row.reason_code)) counts[row.reason_code] = Number(row.total || 0);
  }
  return counts;
}

async function dueSchedules(db, cohort, limit) {
  const result = await db
    .prepare(
      `SELECT schedule.tenant_id, schedule.source_key, schedule.next_sync_at,
              schedule.incremental_interval_minutes
         FROM tenant_sync_schedules schedule
         JOIN tenant_sync_enrollments enrollment
           ON enrollment.tenant_id=schedule.tenant_id
          AND enrollment.source_key=schedule.source_key
         JOIN supplier_sources source
           ON source.tenant_id=schedule.tenant_id AND source.source_key=schedule.source_key
         JOIN catalog_tenants tenant ON tenant.tenant_id=schedule.tenant_id
         JOIN tenant_catalog_instances instance ON instance.tenant_id=schedule.tenant_id
         JOIN tenant_store_profiles profile ON profile.tenant_id=schedule.tenant_id
        WHERE enrollment.status='enrolled'
          AND enrollment.cohort_key=?1
          AND schedule.status='active'
          AND schedule.next_sync_at<=CURRENT_TIMESTAMP
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
              FROM tenant_data_plane_migration_jobs migration_job
             WHERE migration_job.tenant_id=schedule.tenant_id
               AND migration_job.status IN ('pending','running','failed')
          )
          AND NOT EXISTS (
            SELECT 1
              FROM tenant_import_jobs active_job
             WHERE active_job.tenant_id=schedule.tenant_id
               AND active_job.source_key=schedule.source_key
               AND active_job.status IN ('pending','queued','scanning','details','finalizing')
          )
          AND NOT EXISTS (
            SELECT 1
              FROM tenant_import_jobs unresolved_job
             WHERE unresolved_job.tenant_id=schedule.tenant_id
               AND unresolved_job.source_key=schedule.source_key
               AND unresolved_job.mode IN ('incremental','recovery')
               AND unresolved_job.status='failed'
          )
        ORDER BY schedule.next_sync_at ASC, schedule.tenant_id ASC, schedule.source_key ASC
        LIMIT ?2`
    )
    .bind(cohort, limit)
    .all();
  return result.results || [];
}

async function createIncrementalJob(db, cohort, schedule) {
  const scheduledFor = String(schedule.next_sync_at || '').trim();
  const importId = await incrementalTenantImportId({
    tenantId: schedule.tenant_id,
    sourceKey: schedule.source_key,
    scheduledFor
  });

  const inserted = await db
    .prepare(
      `INSERT OR IGNORE INTO tenant_import_jobs
        (import_id, tenant_id, source_key, mode, status, phase, attempt_count,
         next_attempt_at, sync_scheduled_for, created_at, updated_at)
       SELECT ?1, ?2, ?3, 'incremental', 'pending', 'scan', 0,
              CURRENT_TIMESTAMP, ?5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
         FROM tenant_sync_schedules schedule
         JOIN tenant_sync_enrollments enrollment
           ON enrollment.tenant_id=schedule.tenant_id
          AND enrollment.source_key=schedule.source_key
         JOIN supplier_sources source
           ON source.tenant_id=schedule.tenant_id
          AND source.source_key=schedule.source_key
         JOIN catalog_tenants tenant ON tenant.tenant_id=schedule.tenant_id
         JOIN tenant_catalog_instances instance ON instance.tenant_id=schedule.tenant_id
         JOIN tenant_store_profiles profile ON profile.tenant_id=schedule.tenant_id
        WHERE schedule.tenant_id=?2
          AND schedule.source_key=?3
          AND schedule.status='active'
          AND schedule.next_sync_at=?5
          AND schedule.next_sync_at<=CURRENT_TIMESTAMP
          AND enrollment.status='enrolled'
          AND enrollment.cohort_key=?4
          AND source.status='active'
          AND source.sync_strategy='incremental'
          AND tenant.status='active'
          AND instance.status='ready'
          AND profile.setup_status IN ('ready','published')
          AND EXISTS (
            SELECT 1 FROM tenant_import_jobs initial_job
             WHERE initial_job.tenant_id=?2
               AND initial_job.source_key=?3
               AND initial_job.mode='initial'
               AND initial_job.status='success'
          )
          AND NOT EXISTS (
            SELECT 1 FROM tenant_data_plane_migration_jobs migration_job
             WHERE migration_job.tenant_id=?2
               AND migration_job.status IN ('pending','running','failed')
          )
          AND NOT EXISTS (
            SELECT 1 FROM tenant_import_jobs conflicting_job
             WHERE conflicting_job.tenant_id=?2
               AND conflicting_job.source_key=?3
               AND (
                 conflicting_job.status IN ('pending','queued','scanning','details','finalizing')
                 OR (
                   conflicting_job.mode IN ('incremental','recovery')
                   AND conflicting_job.status='failed'
                 )
               )
          )`
    )
    .bind(importId, schedule.tenant_id, schedule.source_key, cohort, scheduledFor)
    .run();

  if (Number(inserted?.meta?.changes || 0) !== 1) {
    return { scheduled: false, importId: null };
  }

  const verification = await db
    .prepare(
      `SELECT import_id, status, phase, sync_scheduled_for
         FROM tenant_import_jobs
        WHERE import_id=?1
          AND tenant_id=?2
          AND source_key=?3
          AND mode='incremental'
        LIMIT 1`
    )
    .bind(importId, schedule.tenant_id, schedule.source_key)
    .first();

  return verification?.import_id === importId && verification?.sync_scheduled_for === scheduledFor
    ? { scheduled: true, importId }
    : { scheduled: false, importId: null };
}

export async function runDueTenantSyncScheduling(
  env,
  { limit, defaultIntervalMinutes = DEFAULT_TENANT_SYNC_INTERVAL_MINUTES } = {}
) {
  if (!env?.CATALOG_DB) return inactiveSummary('database_unbound');
  if (!tenantSyncAutomationEnabled(env)) {
    return inactiveSummary('tenant_sync_automation_disabled');
  }

  const cohortDecision = configuredCohort(env);
  if (!cohortDecision.cohort) return inactiveSummary(cohortDecision.reason);

  const db = env.CATALOG_DB;
  const jobLimit = boundedLimit(limit ?? env.TENANT_SYNC_MAX_JOBS_PER_TICK);
  const intervalMinutes = boundedIntervalMinutes(defaultIntervalMinutes);
  const discovered = await discoverEligibleSchedules(
    db,
    cohortDecision.cohort,
    jobLimit,
    intervalMinutes
  );
  const decisionCounts = await schedulingDecisionCounts(db, cohortDecision.cohort);
  const due = await dueSchedules(db, cohortDecision.cohort, jobLimit);
  let scheduled = 0;
  let busy = 0;

  for (const schedule of due) {
    const outcome = await createIncrementalJob(db, cohortDecision.cohort, schedule);
    if (outcome.scheduled) scheduled += 1;
    else busy += 1;
  }

  const matchingEnrollmentCount = TENANT_SYNC_DECISION_CODES.filter(
    (code) =>
      code !== 'tenant_sync_enrollment_disabled' && code !== 'tenant_sync_cohort_mismatch'
  ).reduce((total, code) => total + decisionCounts[code], 0);

  return {
    enabled: true,
    reason:
      matchingEnrollmentCount === 0
        ? 'tenant_sync_no_matching_enrollment'
        : due.length === 0
          ? 'tenant_sync_no_due_enrollment'
          : null,
    limit: jobLimit,
    discovered,
    selected: due.length,
    processed: due.length,
    scheduled,
    succeeded: scheduled,
    busy,
    failed: 0,
    decisionCounts
  };
}
