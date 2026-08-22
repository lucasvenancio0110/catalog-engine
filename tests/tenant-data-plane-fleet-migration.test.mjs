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

function openControlDatabase() {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(`
    CREATE TABLE catalog_tenants (
      tenant_id TEXT PRIMARY KEY
    );
    INSERT INTO catalog_tenants (tenant_id) VALUES ('t_0123456789abcdefabcd');
  `);
  database.exec(migration0011);
  return database;
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
      VALUES ('dpmig_legacy', 't_0123456789abcdefabcd', 4, 'success');
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
      VALUES ('dpmig_maintenance', 't_0123456789abcdefabcd', 5, 'maintenance', 'pending');
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
        VALUES ('dpmig_invalid', 't_0123456789abcdefabcd', 6, 'unsafe', 'pending');
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

  it('keeps migration kind validation fail-closed', () => {
    expect(normalizeMigrationKind()).toBe('provisioning');
    expect(normalizeMigrationKind('provisioning')).toBe('provisioning');
    expect(normalizeMigrationKind('maintenance')).toBe('maintenance');
    expect(() => normalizeMigrationKind('unsafe')).toThrow(
      'tenant_data_plane_migration_kind_invalid'
    );
  });

  it('records a maintenance failure without changing the catalog to provisioning or touching onboarding', async () => {
    const batches = [];
    const context = {
      d1_database_id: '11111111-1111-4111-8111-111111111111',
      dispatch_namespace: 'unexpected-namespace',
      catalog_status: 'ready',
      source_key: 'primary',
      source_provider: 'yupoo',
      source_url: 'https://private-supplier.x.yupoo.com/albums/',
      sync_strategy: 'incremental',
      removal_miss_threshold: 3,
      provisioning_id: 'p_historical',
      resume_step: 'publish'
    };

    const db = {
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
    };

    const result = await processTenantDataPlaneMigration(db, {
      job: {
        job_id: 'dpmig_maintenance',
        tenant_id: 't_0123456789abcdefabcd',
        target_schema_version: 5,
        migration_kind: 'maintenance'
      },
      env: {
        CLOUDFLARE_PLATFORM_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
        CLOUDFLARE_PLATFORM_API_TOKEN: 'platform-token-that-is-long-enough-for-tests',
        CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE: 'catalog-engine-production'
      }
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
});
