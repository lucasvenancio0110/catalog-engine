import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { incrementalTenantImportId } from '../worker/tenant-import-queue.js';
import {
  runDueTenantSyncScheduling,
  tenantSyncAutomationEnabled
} from '../worker/tenant-sync-scheduler.js';

const scheduleMigrationPath = new URL(
  '../migrations/0017_tenant_sync_schedules.sql',
  import.meta.url
);
const enrollmentMigrationPath = new URL(
  '../migrations/0020_tenant_sync_controlled_enrollment.sql',
  import.meta.url
);
const finalizationMigrationPath = new URL(
  '../migrations/0021_tenant_sync_finalization.sql',
  import.meta.url
);
const databases = [];

class BoundStatement {
  constructor(statement, params = []) {
    this.statement = statement;
    this.params = params;
  }

  bind(...params) {
    return new BoundStatement(this.statement, params);
  }

  all() {
    return { results: this.statement.all(...this.params) };
  }

  first() {
    return this.statement.get(...this.params) || null;
  }

  run() {
    const result = this.statement.run(...this.params);
    return {
      success: true,
      meta: { changes: Number(result.changes || 0) }
    };
  }
}

class D1SqliteAdapter {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new BoundStatement(this.database.prepare(sql));
  }

  async batch(statements) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((statement) => statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

async function createDatabase() {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  database.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE catalog_tenants (
      tenant_id TEXT PRIMARY KEY,
      status TEXT NOT NULL
    );

    CREATE TABLE supplier_sources (
      tenant_id TEXT NOT NULL,
      source_key TEXT NOT NULL,
      status TEXT NOT NULL,
      sync_strategy TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, source_key),
      FOREIGN KEY (tenant_id) REFERENCES catalog_tenants(tenant_id) ON DELETE CASCADE
    );

    CREATE TABLE tenant_catalog_instances (
      tenant_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES catalog_tenants(tenant_id) ON DELETE CASCADE
    );

    CREATE TABLE tenant_store_profiles (
      tenant_id TEXT PRIMARY KEY,
      setup_status TEXT NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES catalog_tenants(tenant_id) ON DELETE CASCADE
    );

    CREATE TABLE tenant_import_jobs (
      import_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      source_key TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      phase TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tenant_id, source_key) REFERENCES supplier_sources(tenant_id, source_key) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX idx_tenant_import_jobs_one_active
      ON tenant_import_jobs (tenant_id, source_key)
      WHERE status IN ('pending', 'queued', 'scanning', 'details', 'finalizing');

    CREATE TABLE tenant_data_plane_migration_jobs (
      job_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'success', 'failed', 'cancelled')),
      FOREIGN KEY (tenant_id) REFERENCES catalog_tenants(tenant_id) ON DELETE CASCADE
    );
  `);
  database.exec(await readFile(scheduleMigrationPath, 'utf8'));
  database.exec(await readFile(enrollmentMigrationPath, 'utf8'));
  database.exec(await readFile(finalizationMigrationPath, 'utf8'));
  return { database, d1: new D1SqliteAdapter(database) };
}

function seedTenant(
  database,
  {
    tenantId = 't_0123456789abcdefabcd',
    sourceKey = 'primary',
    tenantStatus = 'active',
    sourceStatus = 'active',
    syncStrategy = 'incremental',
    instanceStatus = 'ready',
    profileStatus = 'published',
    initialStatus = 'success'
  } = {}
) {
  database
    .prepare('INSERT INTO catalog_tenants (tenant_id, status) VALUES (?, ?)')
    .run(tenantId, tenantStatus);
  database
    .prepare(
      'INSERT INTO supplier_sources (tenant_id, source_key, status, sync_strategy) VALUES (?, ?, ?, ?)'
    )
    .run(tenantId, sourceKey, sourceStatus, syncStrategy);
  database
    .prepare('INSERT INTO tenant_catalog_instances (tenant_id, status) VALUES (?, ?)')
    .run(tenantId, instanceStatus);
  database
    .prepare('INSERT INTO tenant_store_profiles (tenant_id, setup_status) VALUES (?, ?)')
    .run(tenantId, profileStatus);
  if (initialStatus) {
    database
      .prepare(
        `INSERT INTO tenant_import_jobs
          (import_id, tenant_id, source_key, mode, status, phase)
         VALUES (?, ?, ?, 'initial', ?, 'complete')`
      )
      .run(`initial_${tenantId.slice(2)}`, tenantId, sourceKey, initialStatus);
  }
}

function seedEnrollment(
  database,
  {
    tenantId = 't_0123456789abcdefabcd',
    sourceKey = 'primary',
    status = 'enrolled',
    cohortKey = 'pilot'
  } = {}
) {
  database
    .prepare(
      `INSERT INTO tenant_sync_enrollments
        (tenant_id, source_key, status, cohort_key)
       VALUES (?, ?, ?, ?)`
    )
    .run(tenantId, sourceKey, status, cohortKey);
}

function enabledEnv(d1, overrides = {}) {
  return {
    CATALOG_DB: d1,
    TENANT_SYNC_AUTOMATION_ENABLED: '1',
    TENANT_SYNC_ACTIVE_COHORT: 'pilot',
    TENANT_SYNC_MAX_JOBS_PER_TICK: '1',
    ...overrides
  };
}

afterEach(() => {
  while (databases.length) databases.pop().close();
});

describe('tenant recurring sync scheduler', () => {
  it('requires the literal enable flag and performs zero D1 work while disabled', async () => {
    const prepare = vi.fn(() => {
      throw new Error('scheduler must not query D1 while disabled');
    });

    expect(tenantSyncAutomationEnabled({ TENANT_SYNC_AUTOMATION_ENABLED: '1' })).toBe(true);
    expect(tenantSyncAutomationEnabled({ TENANT_SYNC_AUTOMATION_ENABLED: 'true' })).toBe(false);
    expect(tenantSyncAutomationEnabled({ TENANT_SYNC_AUTOMATION_ENABLED: '0' })).toBe(false);

    expect(
      await runDueTenantSyncScheduling({
        CATALOG_DB: { prepare },
        TENANT_SYNC_AUTOMATION_ENABLED: '0'
      })
    ).toMatchObject({
      enabled: false,
      reason: 'tenant_sync_automation_disabled',
      limit: 0,
      discovered: 0,
      selected: 0,
      scheduled: 0
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it('fails closed when the control-plane database binding is absent', async () => {
    expect(await runDueTenantSyncScheduling({ TENANT_SYNC_AUTOMATION_ENABLED: '1' })).toMatchObject({
      enabled: false,
      reason: 'database_unbound',
      limit: 0,
      discovered: 0,
      selected: 0,
      scheduled: 0
    });
  });

  it('performs zero D1 work when the active cohort is absent or invalid', async () => {
    const prepare = vi.fn(() => {
      throw new Error('scheduler must not query D1 without a valid cohort');
    });
    const base = { CATALOG_DB: { prepare }, TENANT_SYNC_AUTOMATION_ENABLED: '1' };

    await expect(runDueTenantSyncScheduling(base)).resolves.toMatchObject({
      enabled: false,
      reason: 'tenant_sync_cohort_unset'
    });
    await expect(
      runDueTenantSyncScheduling({ ...base, TENANT_SYNC_ACTIVE_COHORT: 'Pilot Invalid' })
    ).resolves.toMatchObject({ enabled: false, reason: 'tenant_sync_cohort_invalid' });
    expect(prepare).not.toHaveBeenCalled();
  });

  it('defaults every existing tenant/source to disabled until an enrollment row exists', async () => {
    const { database, d1 } = await createDatabase();
    seedTenant(database);

    const result = await runDueTenantSyncScheduling(enabledEnv(d1));

    expect(result).toMatchObject({
      enabled: true,
      reason: 'tenant_sync_no_matching_enrollment',
      discovered: 0,
      selected: 0,
      scheduled: 0
    });
    expect(database.prepare('SELECT COUNT(*) AS total FROM tenant_sync_enrollments').get().total).toBe(
      0
    );
    expect(database.prepare('SELECT COUNT(*) AS total FROM tenant_sync_schedules').get().total).toBe(
      0
    );
  });

  it('enrols only ready active incremental sources with a successful initial import', async () => {
    const { database, d1 } = await createDatabase();
    seedTenant(database);
    seedTenant(database, {
      tenantId: 't_1123456789abcdefabcd',
      profileStatus: 'suspended'
    });
    seedTenant(database, {
      tenantId: 't_2123456789abcdefabcd',
      sourceStatus: 'paused'
    });
    seedTenant(database, {
      tenantId: 't_3123456789abcdefabcd',
      initialStatus: null
    });
    seedTenant(database, {
      tenantId: 't_4123456789abcdefabcd',
      instanceStatus: 'migrating'
    });
    for (const tenantId of [
      't_0123456789abcdefabcd',
      't_1123456789abcdefabcd',
      't_2123456789abcdefabcd',
      't_3123456789abcdefabcd',
      't_4123456789abcdefabcd'
    ]) {
      seedEnrollment(database, { tenantId });
    }

    const result = await runDueTenantSyncScheduling(enabledEnv(d1));

    expect(result).toMatchObject({ enabled: true, discovered: 1, selected: 0, scheduled: 0 });
    const schedules = database
      .prepare('SELECT tenant_id, source_key, incremental_interval_minutes, next_sync_at FROM tenant_sync_schedules')
      .all();
    expect(schedules).toHaveLength(1);
    expect(schedules[0].tenant_id).toBe('t_0123456789abcdefabcd');
    expect(schedules[0].source_key).toBe('primary');
    expect(Number(schedules[0].incremental_interval_minutes)).toBe(360);
    expect(
      database
        .prepare('SELECT next_sync_at > CURRENT_TIMESTAMP AS in_future FROM tenant_sync_schedules')
        .get().in_future
    ).toBe(1);
  });

  it('creates one deterministic pending incremental job only when the schedule becomes due', async () => {
    const { database, d1 } = await createDatabase();
    seedTenant(database);
    seedEnrollment(database);
    const env = enabledEnv(d1);

    await runDueTenantSyncScheduling(env);
    database
      .prepare("UPDATE tenant_sync_schedules SET next_sync_at=datetime(CURRENT_TIMESTAMP,'-10 minutes')")
      .run();
    const dueSlot = database.prepare('SELECT next_sync_at FROM tenant_sync_schedules').get().next_sync_at;

    const result = await runDueTenantSyncScheduling(env);
    expect(result).toMatchObject({ selected: 1, scheduled: 1, succeeded: 1, busy: 0 });

    const job = database
      .prepare(
        "SELECT import_id, mode, status, phase, sync_scheduled_for FROM tenant_import_jobs WHERE mode='incremental'"
      )
      .get();
    expect(job).toMatchObject({ mode: 'incremental', status: 'pending', phase: 'scan' });
    expect(job.import_id).toBe(
      await incrementalTenantImportId({
        tenantId: 't_0123456789abcdefabcd',
        sourceKey: 'primary',
        scheduledFor: dueSlot
      })
    );

    const schedule = database
      .prepare('SELECT last_import_id, last_scheduled_at, next_sync_at FROM tenant_sync_schedules')
      .get();
    expect(job.sync_scheduled_for).toBe(dueSlot);
    expect(schedule.last_import_id).toBeNull();
    expect(schedule.last_scheduled_at).toBeNull();
    expect(schedule.next_sync_at).toBe(dueSlot);
  });

  it('does not create a duplicate while any import job for the source is active', async () => {
    const { database, d1 } = await createDatabase();
    seedTenant(database);
    seedEnrollment(database);
    const env = enabledEnv(d1);

    await runDueTenantSyncScheduling(env);
    database
      .prepare("UPDATE tenant_sync_schedules SET next_sync_at=datetime(CURRENT_TIMESTAMP,'-10 minutes')")
      .run();
    await runDueTenantSyncScheduling(env);
    const firstCount = database
      .prepare("SELECT COUNT(*) AS count FROM tenant_import_jobs WHERE mode='incremental'")
      .get().count;

    database
      .prepare("UPDATE tenant_sync_schedules SET next_sync_at=datetime(CURRENT_TIMESTAMP,'-5 minutes')")
      .run();
    const repeated = await runDueTenantSyncScheduling(env);
    const secondCount = database
      .prepare("SELECT COUNT(*) AS count FROM tenant_import_jobs WHERE mode='incremental'")
      .get().count;

    expect(Number(firstCount)).toBe(1);
    expect(Number(secondCount)).toBe(1);
    expect(repeated).toMatchObject({ selected: 0, scheduled: 0 });
  });

  it('creates a distinct job for a later due slot after the prior job becomes terminal', async () => {
    const { database, d1 } = await createDatabase();
    seedTenant(database);
    seedEnrollment(database);
    const env = enabledEnv(d1);

    await runDueTenantSyncScheduling(env);
    database
      .prepare("UPDATE tenant_sync_schedules SET next_sync_at=datetime(CURRENT_TIMESTAMP,'-10 minutes')")
      .run();
    await runDueTenantSyncScheduling(env);
    const firstId = database
      .prepare("SELECT import_id FROM tenant_import_jobs WHERE mode='incremental'")
      .get().import_id;

    database.prepare("UPDATE tenant_import_jobs SET status='success' WHERE import_id=?").run(firstId);
    database
      .prepare("UPDATE tenant_sync_schedules SET next_sync_at=datetime(CURRENT_TIMESTAMP,'-5 minutes')")
      .run();
    const secondRun = await runDueTenantSyncScheduling(env);
    const ids = database
      .prepare("SELECT import_id FROM tenant_import_jobs WHERE mode='incremental' ORDER BY created_at, import_id")
      .all()
      .map((row) => row.import_id);

    expect(secondRun).toMatchObject({ selected: 1, scheduled: 1 });
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain(firstId);
  });

  it('selects only the exact enrolled cohort and reports safe aggregate reasons', async () => {
    const { database, d1 } = await createDatabase();
    const pilotTenant = 't_0123456789abcdefabcd';
    const otherTenant = 't_1123456789abcdefabcd';
    const disabledTenant = 't_2123456789abcdefabcd';
    seedTenant(database, { tenantId: pilotTenant });
    seedTenant(database, { tenantId: otherTenant });
    seedTenant(database, { tenantId: disabledTenant });
    seedEnrollment(database, { tenantId: pilotTenant });
    seedEnrollment(database, { tenantId: otherTenant, cohortKey: 'later' });
    seedEnrollment(database, {
      tenantId: disabledTenant,
      status: 'disabled',
      cohortKey: null
    });

    const result = await runDueTenantSyncScheduling(enabledEnv(d1));
    const schedules = database.prepare('SELECT tenant_id FROM tenant_sync_schedules').all();

    expect(schedules.map((row) => row.tenant_id)).toEqual([pilotTenant]);
    expect(result.decisionCounts).toMatchObject({
      tenant_sync_enrollment_disabled: 1,
      tenant_sync_cohort_mismatch: 1,
      tenant_sync_not_due: 1
    });
    expect(JSON.stringify(result)).not.toContain(otherTenant);
    expect(JSON.stringify(result)).not.toContain(disabledTenant);
  });

  it('caps work per tick even when more enrolled schedules are due', async () => {
    const { database, d1 } = await createDatabase();
    for (const tenantId of [
      't_0123456789abcdefabcd',
      't_1123456789abcdefabcd',
      't_2123456789abcdefabcd'
    ]) {
      seedTenant(database, { tenantId });
      seedEnrollment(database, { tenantId });
    }

    await runDueTenantSyncScheduling(enabledEnv(d1), { limit: 10 });
    database
      .prepare("UPDATE tenant_sync_schedules SET next_sync_at=datetime(CURRENT_TIMESTAMP,'-5 minutes')")
      .run();
    const result = await runDueTenantSyncScheduling(
      enabledEnv(d1, { TENANT_SYNC_MAX_JOBS_PER_TICK: '2' })
    );

    expect(result).toMatchObject({ limit: 2, selected: 2, scheduled: 2 });
    expect(
      database.prepare("SELECT COUNT(*) AS total FROM tenant_import_jobs WHERE mode='incremental'").get()
        .total
    ).toBe(2);
  });

  it.each(['pending', 'running', 'failed'])(
    'blocks scheduling while a tenant data-plane migration is %s',
    async (migrationStatus) => {
      const { database, d1 } = await createDatabase();
      seedTenant(database);
      seedEnrollment(database);
      await runDueTenantSyncScheduling(enabledEnv(d1));
      database
        .prepare("UPDATE tenant_sync_schedules SET next_sync_at=datetime(CURRENT_TIMESTAMP,'-5 minutes')")
        .run();
      database
        .prepare(
          'INSERT INTO tenant_data_plane_migration_jobs (job_id, tenant_id, status) VALUES (?, ?, ?)'
        )
        .run('dpmig_0123456789abcdefabcd', 't_0123456789abcdefabcd', migrationStatus);

      const result = await runDueTenantSyncScheduling(enabledEnv(d1));

      expect(result).toMatchObject({ selected: 0, scheduled: 0 });
      expect(result.decisionCounts.tenant_sync_migration_conflict).toBe(1);
      expect(
        database.prepare("SELECT COUNT(*) AS total FROM tenant_import_jobs WHERE mode='incremental'").get()
          .total
      ).toBe(0);
    }
  );

  it('blocks unresolved failures and active imports with deterministic reason codes', async () => {
    const { database, d1 } = await createDatabase();
    seedTenant(database);
    seedEnrollment(database);
    await runDueTenantSyncScheduling(enabledEnv(d1));
    database
      .prepare("UPDATE tenant_sync_schedules SET next_sync_at=datetime(CURRENT_TIMESTAMP,'-5 minutes')")
      .run();
    database
      .prepare(
        `INSERT INTO tenant_import_jobs
          (import_id, tenant_id, source_key, mode, status, phase)
         VALUES ('imp_failed_recovery01', 't_0123456789abcdefabcd', 'primary',
                 'recovery', 'failed', 'scan')`
      )
      .run();

    const failed = await runDueTenantSyncScheduling(enabledEnv(d1));
    expect(failed.decisionCounts.tenant_sync_unresolved_failure).toBe(1);
    expect(failed).toMatchObject({ selected: 0, scheduled: 0 });

    database.prepare("UPDATE tenant_import_jobs SET status='success' WHERE mode='recovery'").run();
    database
      .prepare(
        `INSERT INTO tenant_import_jobs
          (import_id, tenant_id, source_key, mode, status, phase)
         VALUES ('imp_active_initial001', 't_0123456789abcdefabcd', 'primary',
                 'initial', 'pending', 'scan')`
      )
      .run();

    const active = await runDueTenantSyncScheduling(enabledEnv(d1));
    expect(active.decisionCounts.tenant_sync_job_conflict).toBe(1);
    expect(active).toMatchObject({ selected: 0, scheduled: 0 });
  });

  it('stops new claims through either kill switch without deleting durable state', async () => {
    const { database, d1 } = await createDatabase();
    seedTenant(database);
    seedEnrollment(database);
    await runDueTenantSyncScheduling(enabledEnv(d1));
    database
      .prepare("UPDATE tenant_sync_schedules SET next_sync_at=datetime(CURRENT_TIMESTAMP,'-5 minutes')")
      .run();

    const globalOff = await runDueTenantSyncScheduling(
      enabledEnv(d1, { TENANT_SYNC_AUTOMATION_ENABLED: '0' })
    );
    database
      .prepare("UPDATE tenant_sync_enrollments SET status='disabled', cohort_key=NULL")
      .run();
    const cohortOff = await runDueTenantSyncScheduling(enabledEnv(d1));

    expect(globalOff.reason).toBe('tenant_sync_automation_disabled');
    expect(cohortOff).toMatchObject({ scheduled: 0, selected: 0 });
    expect(cohortOff.decisionCounts.tenant_sync_enrollment_disabled).toBe(1);
    expect(database.prepare('SELECT COUNT(*) AS total FROM tenant_sync_schedules').get().total).toBe(
      1
    );
    expect(database.prepare("SELECT COUNT(*) AS total FROM tenant_import_jobs WHERE mode='initial'").get().total).toBe(
      1
    );
  });

  it('rejects invalid enrollment state at the control-plane schema boundary', async () => {
    const { database } = await createDatabase();
    seedTenant(database);

    expect(() => seedEnrollment(database, { cohortKey: null })).toThrow();
    expect(() => seedEnrollment(database, { cohortKey: 'Pilot' })).toThrow();
    seedEnrollment(database, { status: 'disabled', cohortKey: null });
    expect(
      database.prepare('SELECT status, cohort_key FROM tenant_sync_enrollments').get()
    ).toEqual({ status: 'disabled', cohort_key: null });
  });

  it('uses a stable opaque identity per tenant/source/scheduled slot', async () => {
    const input = {
      tenantId: 't_0123456789abcdefabcd',
      sourceKey: 'primary',
      scheduledFor: '2026-08-21 18:00:00'
    };
    const first = await incrementalTenantImportId(input);
    const retry = await incrementalTenantImportId(input);
    const later = await incrementalTenantImportId({
      ...input,
      scheduledFor: '2026-08-21 19:00:00'
    });

    expect(retry).toBe(first);
    expect(later).not.toBe(first);
    expect(first).toMatch(/^imp_[a-f0-9]{20}$/);
    expect(first).not.toContain(input.tenantId);
    expect(first).not.toContain(input.sourceKey);
    await expect(
      incrementalTenantImportId({ ...input, scheduledFor: '21/08/2026 18:00' })
    ).rejects.toThrow();
  });

  it('keeps interval policy bounded and migration/provider-neutral', async () => {
    const { database, d1 } = await createDatabase();
    seedTenant(database);
    seedEnrollment(database);
    await runDueTenantSyncScheduling(
      enabledEnv(d1),
      { defaultIntervalMinutes: 1 }
    );
    const schedule = database
      .prepare('SELECT incremental_interval_minutes FROM tenant_sync_schedules')
      .get();
    expect(Number(schedule.incremental_interval_minutes)).toBe(15);

    const [scheduleMigration, enrollmentMigration] = await Promise.all([
      readFile(scheduleMigrationPath, 'utf8'),
      readFile(enrollmentMigrationPath, 'utf8')
    ]);
    expect(scheduleMigration).toContain('BETWEEN 15 AND 10080');
    expect(scheduleMigration).toContain('idx_tenant_sync_schedules_due');
    expect(enrollmentMigration).toContain("DEFAULT 'disabled'");
    expect(enrollmentMigration).toContain('idx_tenant_sync_enrollments_cohort');
    expect(`${scheduleMigration}\n${enrollmentMigration}`).not.toMatch(
      /https?:\/\/|yupoo|shopify|woo ?commerce/i
    );
  });
});
