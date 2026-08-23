import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DATA_PLANE_MIGRATION_DUE_SQL,
  MAINTENANCE_MIGRATION_DISCOVERY_SQL,
  normalizeMigrationKind,
  processTenantDataPlaneMigration
} from '../worker/data-plane-migration-runner.js';
import { tenantDataPlaneCurrentBatch as tenantDataPlaneV4Batch } from '../worker/tenant-data-plane-schema-v4.js';
import {
  TENANT_DATA_PLANE_V5_STATEMENTS,
  tenantDataPlaneMigrationBatches
} from '../worker/tenant-data-plane-schema-v5.js';

const databases = [];
const migrationRunnerSource = fs.readFileSync('worker/data-plane-migration-runner.js', 'utf8');
const migration0011 = fs.readFileSync(
  'migrations/0011_tenant_data_plane_migration_jobs.sql',
  'utf8'
);
const migration0018 = fs.readFileSync(
  'migrations/0018_tenant_data_plane_fleet_migrations.sql',
  'utf8'
);
const saasWorkflow = fs.readFileSync('.github/workflows/validate-saas-control-plane.yml', 'utf8');
const ingestionWorkflow = fs.readFileSync(
  '.github/workflows/validate-tenant-ingestion.yml',
  'utf8'
);

const TENANT_ID = 't_0123456789abcdefabcd';
const DATABASE_ID = '11111111-1111-4111-8111-111111111111';

function openControlDatabase() {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(`
    CREATE TABLE catalog_tenants (
      tenant_id TEXT PRIMARY KEY
    );
    INSERT INTO catalog_tenants (tenant_id) VALUES ('${TENANT_ID}');
  `);
  database.exec(migration0011);
  return database;
}

function openMaintenanceDiscoveryDatabase() {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(`
    CREATE TABLE catalog_tenants (
      tenant_id TEXT PRIMARY KEY,
      status TEXT NOT NULL
    );
    CREATE TABLE tenant_catalog_instances (
      tenant_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      last_migration_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE tenant_data_plane_provider_state (
      tenant_id TEXT PRIMARY KEY,
      database_status TEXT NOT NULL,
      worker_status TEXT NOT NULL,
      d1_database_id TEXT
    );
    CREATE TABLE supplier_sources (
      tenant_id TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE tenant_import_jobs (
      tenant_id TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE tenant_provisioning_runs (
      provisioning_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  database.exec(migration0011);
  database.exec(migration0018);
  return database;
}

function insertReadyMaintenanceTenant(database, tenantId, createdAt) {
  database
    .prepare("INSERT INTO catalog_tenants (tenant_id,status) VALUES (?1,'active')")
    .run(tenantId);
  database
    .prepare(
      `INSERT INTO tenant_catalog_instances
        (tenant_id,status,schema_version,last_migration_at,created_at)
       VALUES (?1,'ready',4,NULL,?2)`
    )
    .run(tenantId, createdAt);
  database
    .prepare(
      `INSERT INTO tenant_data_plane_provider_state
        (tenant_id,database_status,worker_status,d1_database_id)
       VALUES (?1,'active','active','11111111-1111-4111-8111-111111111111')`
    )
    .run(tenantId);
  database
    .prepare("INSERT INTO supplier_sources (tenant_id,status) VALUES (?1,'active')")
    .run(tenantId);
}

function maintenanceContext(dispatchNamespace = 'catalog-engine-production') {
  return {
    d1_database_id: DATABASE_ID,
    dispatch_namespace: dispatchNamespace,
    worker_script_name: `ce-${TENANT_ID.slice(2)}`,
    catalog_status: 'ready',
    current_schema_version: 4,
    source_key: 'primary',
    source_provider: 'yupoo',
    source_url: 'https://private-supplier.x.yupoo.com/albums/',
    sync_strategy: 'incremental',
    removal_miss_threshold: 3,
    provisioning_id: 'p_historical',
    resume_step: 'publish'
  };
}

function fakeControlDb(context) {
  const batches = [];
  return {
    batches,
    db: {
      prepare(sql) {
        return {
          bind(...params) {
            return {
              sql,
              params,
              async first() {
                if (sql.includes('SELECT p.d1_database_id')) return context;
                return null;
              },
              async run() {
                if (
                  sql.includes('UPDATE tenant_data_plane_migration_jobs') &&
                  sql.includes("SET status='running'")
                ) {
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 1 } };
              }
            };
          }
        };
      },
      async batch(statements) {
        batches.push(statements);
        return [];
      }
    }
  };
}

function platformEnv() {
  return {
    CLOUDFLARE_PLATFORM_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
    CLOUDFLARE_PLATFORM_API_TOKEN: 'platform-token-that-is-long-enough-for-tests',
    CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE: 'catalog-engine-production'
  };
}

function maintenanceJob() {
  return {
    job_id: 'dpmig_maintenance',
    tenant_id: TENANT_ID,
    target_schema_version: 5,
    migration_kind: 'maintenance'
  };
}

function tenantSource() {
  return {
    sourceKey: 'primary',
    provider: 'yupoo',
    sourceUrl: 'https://private-supplier.x.yupoo.com/albums/',
    syncStrategy: 'incremental',
    removalMissThreshold: 3
  };
}

function applySqliteBatch(database, batch) {
  database.exec('BEGIN');
  try {
    for (const query of batch) database.prepare(query.sql).run(...(query.params || []));
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

afterEach(() => {
  while (databases.length) databases.pop().close();
});

describe('tenant data-plane fleet migration activation', () => {
  it('migrates the existing job table with provisioning as the backward-compatible default', () => {
    const database = openControlDatabase();
    database.exec(`
      INSERT INTO tenant_data_plane_migration_jobs
        (job_id, tenant_id, target_schema_version, status)
      VALUES ('dpmig_legacy', '${TENANT_ID}', 4, 'success');
    `);

    database.exec(migration0018);

    const legacy = database
      .prepare(
        `SELECT migration_kind FROM tenant_data_plane_migration_jobs WHERE job_id='dpmig_legacy'`
      )
      .get();
    expect(legacy.migration_kind).toBe('provisioning');

    database.exec(`
      INSERT INTO tenant_data_plane_migration_jobs
        (job_id, tenant_id, target_schema_version, migration_kind, status)
      VALUES ('dpmig_maintenance', '${TENANT_ID}', 5, 'maintenance', 'pending');
    `);
    expect(
      database
        .prepare(
          `SELECT migration_kind FROM tenant_data_plane_migration_jobs WHERE job_id='dpmig_maintenance'`
        )
        .get().migration_kind
    ).toBe('maintenance');

    expect(() =>
      database.exec(`
        INSERT INTO tenant_data_plane_migration_jobs
          (job_id, tenant_id, target_schema_version, migration_kind, status)
        VALUES ('dpmig_invalid', '${TENANT_ID}', 6, 'unsafe', 'pending');
      `)
    ).toThrow();
  });

  it('targets schema v5 and only discovers maintenance work for ready idle tenants', () => {
    expect(migrationRunnerSource).toContain("from './tenant-data-plane-schema-v5.js'");
    expect(migrationRunnerSource).toContain("i.status='ready'");
    expect(migrationRunnerSource).toContain("migrationKind: 'maintenance'");
    expect(migrationRunnerSource).toContain('tenant_import_jobs');
    for (const status of ['pending', 'queued', 'scanning', 'details', 'finalizing']) {
      expect(migrationRunnerSource).toContain(`'${status}'`);
    }
    expect(migrationRunnerSource).toContain('j.target_schema_version=?2');
  });

  it('keeps tenant schema CI aligned with the v5 fleet target and migration ownership', () => {
    for (const workflow of [saasWorkflow, ingestionWorkflow]) {
      expect(workflow).toContain('schema_version FROM data_plane_identity');
      expect(workflow).toContain("= '5'");
      expect(workflow).toContain("= '1,2,3,4,5'");
      expect(workflow).toContain('catalog_product_intelligence_state');
      expect(workflow).toContain('supplier_sync_stage_runs');
      expect(workflow).toContain('supplier_sync_stage_observations');
      expect(workflow).toContain('supplier_sync_stage_events');
      expect(workflow).toContain('supplier_sync_stage_categories');
    }
    expect(ingestionWorkflow).toContain("'migrations/0018_tenant_data_plane_fleet_migrations.sql'");
    expect(ingestionWorkflow).toContain('name: Verify current tenant data-plane schema');
    expect(ingestionWorkflow).not.toContain('Verify tenant data-plane v3 classification tables');
  });

  it('does not let discovery erase a failed migration retry backoff', () => {
    expect(migrationRunnerSource).toContain('ON CONFLICT(job_id) DO NOTHING');
    expect(migrationRunnerSource).toContain(
      "next_attempt_at=datetime(CURRENT_TIMESTAMP,'+10 minutes')"
    );
  });

  it('does not let older failed jobs monopolize bounded maintenance discovery', () => {
    const database = openMaintenanceDiscoveryDatabase();
    const failedTenant = 't_aaaaaaaaaaaaaaaaaaaa';
    const eligibleTenant = 't_bbbbbbbbbbbbbbbbbbbb';
    const activeImportTenant = 't_cccccccccccccccccccc';
    insertReadyMaintenanceTenant(database, failedTenant, '2000-01-01T00:00:00Z');
    insertReadyMaintenanceTenant(database, eligibleTenant, '2001-01-01T00:00:00Z');
    insertReadyMaintenanceTenant(database, activeImportTenant, '2002-01-01T00:00:00Z');
    database
      .prepare(
        `INSERT INTO tenant_data_plane_migration_jobs
          (job_id,tenant_id,target_schema_version,migration_kind,status,attempt_count,created_at,updated_at)
         VALUES ('dpmig_failed',?1,5,'maintenance','failed',1,
                 '2000-01-01T00:00:00Z','2000-01-01T00:00:00Z')`
      )
      .run(failedTenant);
    database
      .prepare("INSERT INTO tenant_import_jobs (tenant_id,status) VALUES (?1,'scanning')")
      .run(activeImportTenant);

    const candidates = database.prepare(MAINTENANCE_MIGRATION_DISCOVERY_SQL).all(5, 2);

    expect(candidates).toEqual([{ tenant_id: eligibleTenant }]);
  });

  it('gives newly pending maintenance work capacity ahead of older failed retries', () => {
    const database = openMaintenanceDiscoveryDatabase();
    const failedTenantA = 't_dddddddddddddddddddd';
    const failedTenantB = 't_eeeeeeeeeeeeeeeeeeee';
    const pendingTenant = 't_ffffffffffffffffffff';
    for (const [tenantId, createdAt] of [
      [failedTenantA, '2000-01-01T00:00:00Z'],
      [failedTenantB, '2001-01-01T00:00:00Z'],
      [pendingTenant, '2002-01-01T00:00:00Z']
    ]) {
      insertReadyMaintenanceTenant(database, tenantId, createdAt);
    }
    const insertJob = database.prepare(
      `INSERT INTO tenant_data_plane_migration_jobs
        (job_id,tenant_id,target_schema_version,migration_kind,status,attempt_count,
         next_attempt_at,created_at,updated_at)
       VALUES (?1,?2,5,'maintenance',?3,1,NULL,?4,?4)`
    );
    insertJob.run('dpmig_failed_a', failedTenantA, 'failed', '2000-01-01T00:00:00Z');
    insertJob.run('dpmig_failed_b', failedTenantB, 'failed', '2001-01-01T00:00:00Z');
    insertJob.run('dpmig_pending', pendingTenant, 'pending', '2002-01-01T00:00:00Z');

    const due = database.prepare(DATA_PLANE_MIGRATION_DUE_SQL).all(6, 5, 2);

    expect(due.map((job) => job.job_id)).toEqual(['dpmig_pending', 'dpmig_failed_a']);
  });

  it('keeps migration kind validation fail-closed', () => {
    expect(normalizeMigrationKind()).toBe('provisioning');
    expect(normalizeMigrationKind('provisioning')).toBe('provisioning');
    expect(normalizeMigrationKind('maintenance')).toBe('maintenance');
    expect(() => normalizeMigrationKind('unsafe')).toThrow(
      'tenant_data_plane_migration_kind_invalid'
    );
  });

  it('records a maintenance failure without changing the catalog to provisioning or touching onboarding', async () => {
    const { db, batches } = fakeControlDb(maintenanceContext('unexpected-namespace'));

    const result = await processTenantDataPlaneMigration(db, {
      job: maintenanceJob(),
      env: platformEnv()
    });

    expect(result).toMatchObject({
      outcome: 'failed',
      migrationKind: 'maintenance',
      error: 'tenant_dispatch_namespace_mismatch'
    });
    expect(batches).toHaveLength(1);
    const failureSql = batches[0].map((statement) => statement.sql).join('\n');
    expect(failureSql).toContain('UPDATE tenant_catalog_instances');
    expect(failureSql).not.toContain("SET status='provisioning'");
    expect(failureSql).not.toContain('tenant_provisioning_runs');
    expect(failureSql).not.toContain('tenant_provisioning_steps');
  });

  it('finishes maintenance on v5 without resuming historical onboarding or changing serving status', async () => {
    const { db, batches } = fakeControlDb(maintenanceContext());
    let queryCall = 0;
    let migrationCall = 0;
    const get = vi.fn(() => ({
      async fetch(request) {
        if (new URL(request.url).pathname.endsWith('/schema-migrate')) {
          migrationCall += 1;
          const payload = await request.json();
          expect(payload).toEqual({
            version: 1,
            tenantId: TENANT_ID,
            targetSchemaVersion: 5
          });
          expect(JSON.stringify(payload)).not.toContain('CREATE TABLE');
          return Response.json({ ok: true, version: 1, schemaVersion: 5, applied: true });
        }
        queryCall += 1;
        const results =
          queryCall === 1
            ? [
                { success: true, results: [{ tenant_id: TENANT_ID, schema_version: 4 }] },
                {
                  success: true,
                  results: [{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }]
                }
              ]
            : [
                { success: true, results: [{ tenant_id: TENANT_ID, schema_version: 5 }] },
                { success: true, results: [{ total: 1 }] }
              ];
        return Response.json({ ok: true, version: 1, results });
      }
    }));
    const fetchImpl = vi.fn(async (url, options) => {
      expect(String(url)).toContain(
        '/workers/dispatch/namespaces/catalog-engine-production/scripts/'
      );
      expect(options.method).toBe('PUT');
      expect(options.body).toBeInstanceOf(FormData);
      return Response.json({ success: true, result: { version_id: 'worker-command-v1' } });
    });

    const result = await processTenantDataPlaneMigration(
      db,
      {
        job: maintenanceJob(),
        env: { ...platformEnv(), TENANT_DISPATCH: { get } }
      },
      { fetchImpl }
    );

    expect(result).toMatchObject({
      outcome: 'success',
      migrationKind: 'maintenance',
      schemaVersion: 5,
      resumedAt: null
    });
    expect(queryCall).toBe(2);
    expect(migrationCall).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(batches).toHaveLength(1);
    const successSql = batches[0].map((statement) => statement.sql).join('\n');
    expect(successSql).toContain('SET schema_version=?2, last_migration_at=CURRENT_TIMESTAMP');
    expect(successSql).toContain('SET worker_version=?2');
    expect(successSql).not.toContain("SET schema_version=?2, status='provisioning'");
    expect(successSql).not.toContain('tenant_provisioning_runs');
    expect(successSql).not.toContain('tenant_provisioning_steps');
  });

  it('retries binding reads and keeps DDL on the tenant binding path', async () => {
    const { db, batches } = fakeControlDb(maintenanceContext());
    let dispatchCall = 0;
    const delays = [];
    const get = vi.fn(() => ({
      async fetch(request) {
        dispatchCall += 1;
        const payload = await request.json();
        if (new URL(request.url).pathname.endsWith('/schema-migrate')) {
          expect(payload).toEqual({ version: 1, tenantId: TENANT_ID, targetSchemaVersion: 5 });
          return Response.json({ ok: true, version: 1, schemaVersion: 5, applied: true });
        }
        expect(payload.batch).toHaveLength(2);
        if (dispatchCall < 3) {
          return Response.json(
            { ok: false, error: 'tenant_data_plane_query_failed' },
            { status: 502 }
          );
        }
        const results =
          dispatchCall === 3
            ? [
                { success: true, results: [{ tenant_id: TENANT_ID, schema_version: 4 }] },
                {
                  success: true,
                  results: [{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }]
                }
              ]
            : [
                { success: true, results: [{ tenant_id: TENANT_ID, schema_version: 5 }] },
                { success: true, results: [{ total: 1 }] }
              ];
        return Response.json({ ok: true, version: 1, results });
      }
    }));
    const fetchImpl = vi.fn(async (_url, options) => {
      expect(options.method).toBe('PUT');
      expect(options.body).toBeInstanceOf(FormData);
      return Response.json({ success: true, result: { version_id: 'worker-command-v1' } });
    });

    const result = await processTenantDataPlaneMigration(
      db,
      {
        job: maintenanceJob(),
        env: { ...platformEnv(), TENANT_DISPATCH: { get } }
      },
      {
        fetchImpl,
        sleepImpl: async (delay) => delays.push(delay),
        randomImpl: () => 0
      }
    );

    expect(result).toMatchObject({ outcome: 'success', schemaVersion: 5 });
    expect(get).toHaveBeenCalledTimes(5);
    expect(get).toHaveBeenCalledWith(`ce-${TENANT_ID.slice(2)}`);
    expect(dispatchCall).toBe(5);
    expect(delays).toEqual([100, 200]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(batches).toHaveLength(1);
  });

  it('retries a bounded unreachable runtime preparation before binding migration', async () => {
    const { db } = fakeControlDb(maintenanceContext());
    let uploadCall = 0;
    const delays = [];
    let queryCall = 0;
    const get = vi.fn(() => ({
      async fetch(request) {
        if (new URL(request.url).pathname.endsWith('/schema-migrate')) {
          return Response.json({ ok: true, version: 1, schemaVersion: 5, applied: true });
        }
        queryCall += 1;
        const results =
          queryCall === 1
            ? [
                { success: true, results: [{ tenant_id: TENANT_ID, schema_version: 4 }] },
                {
                  success: true,
                  results: [{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }]
                }
              ]
            : [
                { success: true, results: [{ tenant_id: TENANT_ID, schema_version: 5 }] },
                { success: true, results: [{ total: 1 }] }
              ];
        return Response.json({ ok: true, version: 1, results });
      }
    }));
    const fetchImpl = async () => {
      uploadCall += 1;
      if (uploadCall < 3) throw new Error('private transient detail');
      return Response.json({ success: true, result: { version_id: 'worker-command-v1' } });
    };

    const result = await processTenantDataPlaneMigration(
      db,
      { job: maintenanceJob(), env: { ...platformEnv(), TENANT_DISPATCH: { get } } },
      {
        fetchImpl,
        sleepImpl: async (delay) => delays.push(delay),
        randomImpl: () => 0
      }
    );

    expect(result).toMatchObject({ outcome: 'success', schemaVersion: 5 });
    expect(uploadCall).toBe(3);
    expect(delays).toEqual([100, 200]);
  });

  it('reconciles control state after D1 already completed v5 without replaying schema DDL', async () => {
    const { db, batches } = fakeControlDb(maintenanceContext());
    let d1Call = 0;
    const fetchImpl = async (_url, options) => {
      d1Call += 1;
      const queries = JSON.parse(options.body).batch;
      expect(queries).toHaveLength(2);
      expect(queries.every((query) => query.sql.startsWith('SELECT'))).toBe(true);
      const result =
        d1Call === 1
          ? [
              { success: true, results: [{ tenant_id: TENANT_ID, schema_version: '5' }] },
              {
                success: true,
                results: [
                  { version: 1 },
                  { version: 2 },
                  { version: 3 },
                  { version: 4 },
                  { version: 5 }
                ]
              }
            ]
          : [
              { success: true, results: [{ tenant_id: TENANT_ID, schema_version: '5' }] },
              { success: true, results: [{ total: '1' }] }
            ];
      return new Response(JSON.stringify({ success: true, result }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    };

    const result = await processTenantDataPlaneMigration(
      db,
      { job: maintenanceJob(), env: platformEnv() },
      { fetchImpl, sleepImpl: async () => {}, randomImpl: () => 0 }
    );

    expect(result).toMatchObject({ outcome: 'success', schemaVersion: 5 });
    expect(d1Call).toBe(2);
    expect(batches).toHaveLength(1);
  });

  it('fails closed when the tenant D1 schema ledger is not contiguous', async () => {
    const { db, batches } = fakeControlDb(maintenanceContext());
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          success: true,
          result: [
            { success: true, results: [{ tenant_id: TENANT_ID, schema_version: '4' }] },
            { success: true, results: [{ version: 1 }, { version: 2 }, { version: 4 }] }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );

    const result = await processTenantDataPlaneMigration(
      db,
      { job: maintenanceJob(), env: platformEnv() },
      { fetchImpl }
    );

    expect(result).toMatchObject({
      outcome: 'failed',
      error: 'tenant_d1_schema_state_invalid'
    });
    expect(batches).toHaveLength(1);
    expect(batches[0].map((statement) => statement.sql).join('\n')).not.toContain(
      'SET schema_version=?2, last_migration_at=CURRENT_TIMESTAMP'
    );
  });

  it('persists a bounded inspect-phase code when the first D1 transport call is unreachable', async () => {
    const { db, batches } = fakeControlDb(maintenanceContext());
    const fetchImpl = async () => {
      throw new Error('private network detail');
    };

    const result = await processTenantDataPlaneMigration(
      db,
      { job: maintenanceJob(), env: platformEnv() },
      { fetchImpl }
    );

    expect(result).toMatchObject({
      outcome: 'failed',
      error: 'tenant_d1_migration_inspect_unreachable'
    });
    expect(batches).toHaveLength(1);
  });

  it('persists a bounded apply-phase code after the prepared runtime rejects migration', async () => {
    const { db, batches } = fakeControlDb(maintenanceContext());
    let migrationCalls = 0;
    const get = vi.fn(() => ({
      async fetch(request) {
        if (new URL(request.url).pathname.endsWith('/schema-migrate')) {
          migrationCalls += 1;
          return Response.json(
            { ok: false, error: 'tenant_data_plane_migration_failed' },
            { status: 502 }
          );
        }
        return Response.json({
          ok: true,
          version: 1,
          results: [
            { success: true, results: [{ tenant_id: TENANT_ID, schema_version: 4 }] },
            {
              success: true,
              results: [{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }]
            }
          ]
        });
      }
    }));
    const fetchImpl = vi.fn(async () =>
      Response.json({ success: true, result: { version_id: 'worker-command-v1' } })
    );

    const result = await processTenantDataPlaneMigration(
      db,
      { job: maintenanceJob(), env: { ...platformEnv(), TENANT_DISPATCH: { get } } },
      { fetchImpl, sleepImpl: async () => {}, randomImpl: () => 0 }
    );

    expect(result).toMatchObject({
      outcome: 'failed',
      error: 'tenant_d1_migration_apply_migration_failed'
    });
    expect(migrationCalls).toBe(3);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(batches).toHaveLength(1);
  });

  it('persists a bounded verify-phase code after the v5 delta was accepted', async () => {
    const { db, batches } = fakeControlDb(maintenanceContext());
    let queryCalls = 0;
    const get = vi.fn(() => ({
      async fetch(request) {
        if (new URL(request.url).pathname.endsWith('/schema-migrate')) {
          return Response.json({ ok: true, version: 1, schemaVersion: 5, applied: true });
        }
        queryCalls += 1;
        if (queryCalls > 1) {
          return Response.json(
            { ok: false, error: 'tenant_data_plane_query_failed' },
            { status: 502 }
          );
        }
        return Response.json({
          ok: true,
          version: 1,
          results: [
            { success: true, results: [{ tenant_id: TENANT_ID, schema_version: 4 }] },
            {
              success: true,
              results: [{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }]
            }
          ]
        });
      }
    }));
    const fetchImpl = vi.fn(async () =>
      Response.json({ success: true, result: { version_id: 'worker-command-v1' } })
    );

    const result = await processTenantDataPlaneMigration(
      db,
      { job: maintenanceJob(), env: { ...platformEnv(), TENANT_DISPATCH: { get } } },
      { fetchImpl, sleepImpl: async () => {}, randomImpl: () => 0 }
    );

    expect(result).toMatchObject({
      outcome: 'failed',
      error: 'tenant_d1_migration_verify_query_failed'
    });
    expect(queryCalls).toBe(4);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(batches).toHaveLength(1);
  });

  it('upgrades a real v4 tenant through only the idempotent v5 delta while preserving LKG', () => {
    const database = new DatabaseSync(':memory:');
    databases.push(database);
    database.exec('PRAGMA foreign_keys = ON');
    applySqliteBatch(
      database,
      tenantDataPlaneV4Batch({ tenantId: TENANT_ID, source: tenantSource() })
    );
    database.exec(`
      INSERT INTO catalog_categories
        (category_id,name,depth,sort_order,product_count)
      VALUES ('cat_lkg','Verified LKG',0,0,1);
      INSERT INTO catalog_products
        (product_id,name,search_text,category_id,category_name,classification_status)
      VALUES ('prd_lkg','Verified LKG Product','verified lkg product','cat_lkg','Verified LKG','known');
      INSERT INTO supplier_album_index
        (tenant_id,source_key,album_source_id,public_product_id,source_url,
         listing_fingerprint,status,miss_count)
      VALUES ('${TENANT_ID}','primary','alb_lkg','prd_lkg',
              'https://private-supplier.x.yupoo.com/albums/lkg','fingerprint-lkg','active',0);
      INSERT INTO catalog_product_classification_overrides
        (product_id,override_json,override_version)
      VALUES ('prd_lkg','{"displayName":"Merchant LKG"}',1);
    `);

    const batches = tenantDataPlaneMigrationBatches({
      tenantId: TENANT_ID,
      source: tenantSource(),
      currentVersion: 4,
      targetVersion: 5
    });
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(TENANT_DATA_PLANE_V5_STATEMENTS.length + 2);
    applySqliteBatch(database, batches[0]);
    applySqliteBatch(database, batches[0]);

    expect(
      database
        .prepare('SELECT schema_version FROM data_plane_identity WHERE tenant_id=?1')
        .get(TENANT_ID).schema_version
    ).toBe(5);
    expect(
      database
        .prepare('SELECT group_concat(version) AS versions FROM data_plane_schema_migrations')
        .get().versions
    ).toBe('1,2,3,4,5');
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS total FROM sqlite_master WHERE type='table' AND name LIKE 'supplier_sync_stage_%'"
        )
        .get().total
    ).toBe(4);
    expect(
      database
        .prepare("SELECT COUNT(*) AS total FROM catalog_products WHERE product_id='prd_lkg'")
        .get().total
    ).toBe(1);
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS total FROM supplier_album_index WHERE album_source_id='alb_lkg' AND status='active'"
        )
        .get().total
    ).toBe(1);
    expect(
      database
        .prepare(
          "SELECT override_json FROM catalog_product_classification_overrides WHERE product_id='prd_lkg'"
        )
        .get().override_json
    ).toBe('{"displayName":"Merchant LKG"}');
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});
