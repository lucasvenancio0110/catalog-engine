import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runDueTenantIncrementalFinalizations } from '../worker/ingestion/incremental-finalization-runner.js';

const finalizationMigrationPath = new URL(
  '../migrations/0021_tenant_sync_finalization.sql',
  import.meta.url
);
const TENANT_ID = 't_0123456789abcdefabcd';
const SOURCE_KEY = 'primary';
const IMPORT_ID = 'imp_11111111111111111111';
const DATABASE_ID = '0123456789abcdef0123456789abcdef';
const SCHEDULED_FOR = '2026-08-27 10:00:00';
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
    return { success: true, meta: { changes: Number(result.changes || 0) } };
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

async function createDatabase({ scheduleSlot = SCHEDULED_FOR } = {}) {
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
      provider TEXT NOT NULL,
      source_url TEXT NOT NULL,
      status TEXT NOT NULL,
      sync_strategy TEXT NOT NULL,
      removal_miss_threshold INTEGER NOT NULL DEFAULT 3,
      PRIMARY KEY (tenant_id, source_key)
    );

    CREATE TABLE tenant_catalog_instances (
      tenant_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      schema_version INTEGER NOT NULL
    );

    CREATE TABLE tenant_data_plane_provider_state (
      tenant_id TEXT PRIMARY KEY,
      d1_database_id TEXT,
      database_status TEXT NOT NULL,
      worker_status TEXT NOT NULL,
      dispatch_namespace TEXT NOT NULL
    );

    CREATE TABLE tenant_provisioning_runs (
      provisioning_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      current_step TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE tenant_import_jobs (
      import_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      source_key TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      phase TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      detail_enqueue_cursor INTEGER NOT NULL DEFAULT 0,
      discovered_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      finished_at TEXT,
      last_error_code TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE tenant_sync_schedules (
      tenant_id TEXT NOT NULL,
      source_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      incremental_interval_minutes INTEGER NOT NULL DEFAULT 360,
      next_sync_at TEXT NOT NULL,
      last_scheduled_at TEXT,
      last_import_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, source_key)
    );
  `);
  database.exec(await readFile(finalizationMigrationPath, 'utf8'));
  database.prepare(`INSERT INTO catalog_tenants(tenant_id,status) VALUES (?, 'active')`).run(TENANT_ID);
  database.prepare(`INSERT INTO supplier_sources
    (tenant_id,source_key,provider,source_url,status,sync_strategy,removal_miss_threshold)
    VALUES (?,?,'yupoo','https://private-supplier.x.yupoo.com/albums/','active','incremental',3)`).run(
    TENANT_ID,
    SOURCE_KEY
  );
  database.prepare(`INSERT INTO tenant_catalog_instances(tenant_id,status,schema_version)
    VALUES (?,'ready',7)`).run(TENANT_ID);
  database.prepare(`INSERT INTO tenant_data_plane_provider_state
    (tenant_id,d1_database_id,database_status,worker_status,dispatch_namespace)
    VALUES (?,?,'active','active','catalog-engine-production')`).run(TENANT_ID, DATABASE_ID);
  database.prepare(`INSERT INTO tenant_sync_schedules
    (tenant_id,source_key,status,incremental_interval_minutes,next_sync_at)
    VALUES (?,?,'active',360,?)`).run(TENANT_ID, SOURCE_KEY, scheduleSlot);
  database.prepare(`INSERT INTO tenant_import_jobs
    (import_id,tenant_id,source_key,mode,status,phase,sync_scheduled_for)
    VALUES (?,?,?,'incremental','finalizing','finalize',?)`).run(
    IMPORT_ID,
    TENANT_ID,
    SOURCE_KEY,
    SCHEDULED_FOR
  );
  return { database, d1: new D1SqliteAdapter(database) };
}

function env(d1) {
  return {
    CATALOG_DB: d1,
    TENANT_DISPATCH: { get: vi.fn() },
    CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE: 'catalog-engine-production',
    TENANT_SYNC_AUTOMATION_ENABLED: '0'
  };
}

function successPromotion({ alreadyComplete = false } = {}) {
  return vi.fn(async (_env, context) => {
    expect(context).toMatchObject({
      importId: IMPORT_ID,
      tenantId: TENANT_ID,
      sourceKey: SOURCE_KEY,
      mode: 'incremental',
      importStatus: 'finalizing',
      phase: 'finalize',
      schemaVersion: 7
    });
    return {
      outcome: 'success',
      alreadyComplete,
      authorityRevision: 1,
      stageState: alreadyComplete ? undefined : 'promoted'
    };
  });
}

afterEach(() => {
  while (databases.length) databases.pop().close();
});

describe('M7D8 incremental promotion finalization', () => {
  it('promotes first and only then commits schedule and control state', async () => {
    const { database, d1 } = await createDatabase();
    const promote = successPromotion();

    const result = await runDueTenantIncrementalFinalizations(env(d1), { promote });

    expect(result).toMatchObject({
      enabled: true,
      selected: 1,
      processed: 1,
      succeeded: 1,
      failed: 0,
      promoted: 1,
      resumedAfterPromotion: 0
    });
    expect(promote).toHaveBeenCalledTimes(1);

    const job = database.prepare(`SELECT status,phase,finished_at,finalize_lease_until,last_error_code
      FROM tenant_import_jobs WHERE import_id=?`).get(IMPORT_ID);
    expect(job.status).toBe('success');
    expect(job.phase).toBe('complete');
    expect(job.finished_at).toBeTruthy();
    expect(job.finalize_lease_until).toBeNull();
    expect(job.last_error_code).toBeNull();

    const schedule = database.prepare(`SELECT last_import_id,last_scheduled_at,next_sync_at
      FROM tenant_sync_schedules WHERE tenant_id=? AND source_key=?`).get(TENANT_ID, SOURCE_KEY);
    expect(schedule.last_import_id).toBe(IMPORT_ID);
    expect(schedule.last_scheduled_at).toBeTruthy();
    expect(schedule.next_sync_at > SCHEDULED_FOR).toBe(true);
  });

  it('finishes an already-promoted run without promoting authority a second time', async () => {
    const { database, d1 } = await createDatabase();
    const promote = successPromotion({ alreadyComplete: true });

    const first = await runDueTenantIncrementalFinalizations(env(d1), { promote });
    const afterFirst = database.prepare(`SELECT last_import_id,next_sync_at FROM tenant_sync_schedules`).get();
    const second = await runDueTenantIncrementalFinalizations(env(d1), { promote });
    const afterSecond = database.prepare(`SELECT last_import_id,next_sync_at FROM tenant_sync_schedules`).get();

    expect(first).toMatchObject({ succeeded: 1, promoted: 0, resumedAfterPromotion: 1 });
    expect(second).toMatchObject({ selected: 0, processed: 0, succeeded: 0 });
    expect(promote).toHaveBeenCalledTimes(1);
    expect(afterSecond).toEqual(afterFirst);
    expect(afterFirst.last_import_id).toBe(IMPORT_ID);
  });

  it('does not touch an in-flight job while another finalization lease is active', async () => {
    const { database, d1 } = await createDatabase();
    database.prepare(`UPDATE tenant_import_jobs
      SET finalize_lease_until=datetime(CURRENT_TIMESTAMP,'+5 minutes') WHERE import_id=?`).run(IMPORT_ID);
    const promote = successPromotion();

    const result = await runDueTenantIncrementalFinalizations(env(d1), { promote });

    expect(result).toMatchObject({ selected: 0, processed: 0, succeeded: 0 });
    expect(promote).not.toHaveBeenCalled();
    expect(database.prepare(`SELECT status FROM tenant_import_jobs WHERE import_id=?`).get(IMPORT_ID).status)
      .toBe('finalizing');
  });

  it('fails closed when the schedule no longer matches the job scheduled slot', async () => {
    const { database, d1 } = await createDatabase({ scheduleSlot: '2026-08-27 10:05:00' });
    const promote = successPromotion({ alreadyComplete: true });

    const result = await runDueTenantIncrementalFinalizations(env(d1), { promote });

    expect(result).toMatchObject({ succeeded: 0, failed: 1 });
    const job = database.prepare(`SELECT status,last_error_code FROM tenant_import_jobs WHERE import_id=?`).get(IMPORT_ID);
    expect(job).toMatchObject({ status: 'failed', last_error_code: 'sync_finalization_control_cas_conflict' });
    const schedule = database.prepare(`SELECT last_import_id,next_sync_at FROM tenant_sync_schedules`).get();
    expect(schedule.last_import_id).toBeNull();
    expect(schedule.next_sync_at).toBe('2026-08-27 10:05:00');
  });

  it('keeps schedule authority unchanged when promotion fails', async () => {
    const { database, d1 } = await createDatabase();
    const promote = vi.fn(async () => ({ outcome: 'failed', error: 'sync_promotion_stale_base' }));

    const result = await runDueTenantIncrementalFinalizations(env(d1), { promote });

    expect(result).toMatchObject({ succeeded: 0, failed: 1 });
    expect(database.prepare(`SELECT status,last_error_code FROM tenant_import_jobs WHERE import_id=?`).get(IMPORT_ID))
      .toMatchObject({ status: 'failed', last_error_code: 'sync_promotion_stale_base' });
    const schedule = database.prepare(`SELECT last_import_id,last_scheduled_at,next_sync_at FROM tenant_sync_schedules`).get();
    expect(schedule.last_import_id).toBeNull();
    expect(schedule.last_scheduled_at).toBeNull();
    expect(schedule.next_sync_at).toBe(SCHEDULED_FOR);
  });

  it('fails closed before D1 work when the runtime binding is absent', async () => {
    const prepare = vi.fn(() => {
      throw new Error('must not query control D1 without tenant runtime');
    });
    const result = await runDueTenantIncrementalFinalizations({ CATALOG_DB: { prepare } });
    expect(result).toMatchObject({ enabled: false, reason: 'tenant_ingestion_platform_unconfigured' });
    expect(prepare).not.toHaveBeenCalled();
  });
});
