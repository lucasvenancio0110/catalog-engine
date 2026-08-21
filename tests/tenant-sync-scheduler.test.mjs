import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { incrementalTenantImportId } from '../worker/tenant-import-queue.js';
import {
  runDueTenantSyncScheduling,
  tenantSyncAutomationEnabled
} from '../worker/tenant-sync-scheduler.js';

const migrationPath = new URL('../migrations/0017_tenant_sync_schedules.sql', import.meta.url);
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
  `);
  database.exec(await readFile(migrationPath, 'utf8'));
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
    ).toEqual({
      enabled: false,
      reason: 'tenant_sync_automation_disabled',
      discovered: 0,
      selected: 0,
      scheduled: 0
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it('fails closed when the control-plane database binding is absent', async () => {
    expect(await runDueTenantSyncScheduling({ TENANT_SYNC_AUTOMATION_ENABLED: '1' })).toEqual({
      enabled: false,
      reason: 'database_unbound',
      discovered: 0,
      selected: 0,
      scheduled: 0
    });
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

    const result = await runDueTenantSyncScheduling({
      CATALOG_DB: d1,
      TENANT_SYNC_AUTOMATION_ENABLED: '1'
    });

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
    const env = { CATALOG_DB: d1, TENANT_SYNC_AUTOMATION_ENABLED: '1' };

    await runDueTenantSyncScheduling(env);
    database
      .prepare("UPDATE tenant_sync_schedules SET next_sync_at=datetime(CURRENT_TIMESTAMP,'-10 minutes')")
      .run();
    const dueSlot = database.prepare('SELECT next_sync_at FROM tenant_sync_schedules').get().next_sync_at;

    const result = await runDueTenantSyncScheduling(env);
    expect(result).toMatchObject({ selected: 1, scheduled: 1, succeeded: 1, busy: 0 });

    const job = database
      .prepare(
        "SELECT import_id, mode, status, phase FROM tenant_import_jobs WHERE mode='incremental'"
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
    expect(schedule.last_import_id).toBe(job.import_id);
    expect(schedule.last_scheduled_at).toBeTruthy();
    expect(
      database
        .prepare('SELECT next_sync_at > CURRENT_TIMESTAMP AS in_future FROM tenant_sync_schedules')
        .get().in_future
    ).toBe(1);
  });

  it('does not create a duplicate while any import job for the source is active', async () => {
    const { database, d1 } = await createDatabase();
    seedTenant(database);
    const env = { CATALOG_DB: d1, TENANT_SYNC_AUTOMATION_ENABLED: '1' };

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
    const env = { CATALOG_DB: d1, TENANT_SYNC_AUTOMATION_ENABLED: '1' };

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
    await runDueTenantSyncScheduling(
      { CATALOG_DB: d1, TENANT_SYNC_AUTOMATION_ENABLED: '1' },
      { defaultIntervalMinutes: 1 }
    );
    const schedule = database
      .prepare('SELECT incremental_interval_minutes FROM tenant_sync_schedules')
      .get();
    expect(Number(schedule.incremental_interval_minutes)).toBe(15);

    const migration = await readFile(migrationPath, 'utf8');
    expect(migration).toContain('BETWEEN 15 AND 10080');
    expect(migration).toContain('idx_tenant_sync_schedules_due');
    expect(migration).not.toMatch(/https?:\/\/|yupoo|shopify|woo ?commerce/i);
  });
});
