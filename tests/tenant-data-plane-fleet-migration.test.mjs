import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  normalizeMigrationKind,
  processTenantDataPlaneMigration
} from '../worker/data-plane-migration-runner.js';

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

function maintenanceContext(dispatchNamespace = 'catalog-engine-production') {
  return {
    d1_database_id: DATABASE_ID,
    dispatch_namespace: dispatchNamespace,
    catalog_status: 'ready',
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

  it('does not let discovery erase a failed migration retry backoff', () => {
    expect(migrationRunnerSource).toContain('ON CONFLICT(job_id) DO NOTHING');
    expect(migrationRunnerSource).toContain("next_attempt_at=datetime(CURRENT_TIMESTAMP,'+10 minutes')");
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
    let d1Call = 0;
    const fetchImpl = async (_url, options) => {
      d1Call += 1;
      const body = JSON.parse(options.body);
      const queries = body.batch;
      const result =
        d1Call === 1
          ? queries.map(() => ({ success: true, results: [] }))
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
      { fetchImpl }
    );

    expect(result).toMatchObject({
      outcome: 'success',
      migrationKind: 'maintenance',
      schemaVersion: 5,
      resumedAt: null
    });
    expect(d1Call).toBe(2);
    expect(batches).toHaveLength(1);
    const successSql = batches[0].map((statement) => statement.sql).join('\n');
    expect(successSql).toContain('SET schema_version=?2, last_migration_at=CURRENT_TIMESTAMP');
    expect(successSql).not.toContain("SET schema_version=?2, status='provisioning'");
    expect(successSql).not.toContain('tenant_provisioning_runs');
    expect(successSql).not.toContain('tenant_provisioning_steps');
  });
});
