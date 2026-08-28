import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { CloudflarePlatformError } from '../worker/cloudflare-platform.js';
import {
  FLEET_PREPARATION_DISCOVERY_SQL,
  FLEET_PREPARATION_ELIGIBILITY_SQL,
  FLEET_PREPARATION_FAILURE_SQL,
  FLEET_PREPARATION_PROMOTION_SQL,
  prepareTenantMigrationCommandCapability,
  runTrustedFleetPreparation
} from '../scripts/cloudflare-tenant-data-plane-fleet-prepare.mjs';

const migration = fs.readFileSync(
  'migrations/0019_tenant_data_plane_migration_capability.sql',
  'utf8'
);
const runner = fs.readFileSync('worker/data-plane-migration-runner.js', 'utf8');
const deployWorkflow = fs.readFileSync('.github/workflows/deploy-catalog-api.yml', 'utf8');
const fleetWorkflow = fs.readFileSync(
  '.github/workflows/cloudflare-tenant-data-plane-fleet-canary.yml',
  'utf8'
);
const importCanaryWorkflow = fs.readFileSync(
  '.github/workflows/cloudflare-auto-tenant-import-canary.yml',
  'utf8'
);
const canary = fs.readFileSync('scripts/cloudflare-tenant-data-plane-fleet-canary.mjs', 'utf8');

const candidate = {
  tenant_id: 't_0123456789abcdefabcd',
  worker_script_name: 'ce-0123456789abcdefabcd',
  d1_database_id: '11111111-1111-4111-8111-111111111111',
  dispatch_namespace: 'catalog-engine-production'
};

const platform = {
  accountId: '0123456789abcdef0123456789abcdef',
  apiToken: 'platform-token-that-is-long-enough-for-tests',
  dispatchNamespace: 'catalog-engine-production'
};

function preparationEnv() {
  return {
    CLOUDFLARE_ACCOUNT_ID: platform.accountId,
    CLOUDFLARE_API_TOKEN: platform.apiToken,
    CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE: platform.dispatchNamespace,
    CATALOG_CONTROL_DATABASE_ID: '22222222-2222-4222-8222-222222222222'
  };
}

describe('trusted tenant migration-command preparation', () => {
  it('adds a durable fail-closed capability marker without changing serving state', () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`CREATE TABLE tenant_data_plane_provider_state (
      tenant_id TEXT PRIMARY KEY,
      worker_status TEXT NOT NULL,
      database_status TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    database.exec(migration);
    database
      .prepare(
        `INSERT INTO tenant_data_plane_provider_state
          (tenant_id,worker_status,database_status)
         VALUES (?1,'active','active')`
      )
      .run(candidate.tenant_id);

    expect(
      database
        .prepare(
          `SELECT migration_command_version, migration_command_prepared_at,
                  migration_command_last_error_code
             FROM tenant_data_plane_provider_state`
        )
        .get()
    ).toEqual({
      migration_command_version: 0,
      migration_command_prepared_at: null,
      migration_command_last_error_code: null
    });
    expect(() =>
      database
        .prepare('UPDATE tenant_data_plane_provider_state SET migration_command_version=-1')
        .run()
    ).toThrow();
    database.close();
  });

  it('promotes the marker only after a successful current User Worker upload', async () => {
    const calls = [];
    const controlBatch = vi.fn(async (batch) => {
      calls.push(batch[0]);
      if (batch[0].sql === FLEET_PREPARATION_ELIGIBILITY_SQL) {
        return [{ results: [{ total: 1 }] }];
      }
      if (batch[0].sql === FLEET_PREPARATION_PROMOTION_SQL) {
        return [{ meta: { changes: 1 } }];
      }
      throw new Error('unexpected_control_sql');
    });
    const uploadWorker = vi.fn(async () => ({ versionId: 'worker-command-v1' }));

    await expect(
      prepareTenantMigrationCommandCapability(candidate, {
        platform,
        controlBatch,
        uploadWorker
      })
    ).resolves.toEqual({
      tenantId: candidate.tenant_id,
      outcome: 'prepared',
      migrationCommandVersion: 4
    });
    expect(uploadWorker).toHaveBeenCalledTimes(1);
    expect(calls.map((entry) => entry.sql)).toEqual([
      FLEET_PREPARATION_ELIGIBILITY_SQL,
      FLEET_PREPARATION_PROMOTION_SQL
    ]);
    expect(calls[1].params.at(-1)).toBe('worker-command-v1');
  });

  it('keeps the retained-canary opt-in valid after the D1 boundary stringifies parameters', () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`CREATE TABLE tenant_data_plane_provider_state (
      tenant_id TEXT PRIMARY KEY,
      worker_script_name TEXT NOT NULL,
      d1_database_id TEXT NOT NULL,
      dispatch_namespace TEXT NOT NULL,
      database_status TEXT NOT NULL,
      worker_status TEXT NOT NULL,
      worker_version TEXT,
      last_checked_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE tenant_catalog_instances (
      tenant_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      schema_version INTEGER NOT NULL
    );
    CREATE TABLE supplier_sources (
      tenant_id TEXT NOT NULL,
      source_key TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE tenant_import_jobs (
      tenant_id TEXT NOT NULL,
      status TEXT NOT NULL
    );`);
    database.exec(migration);
    database
      .prepare(
        `INSERT INTO tenant_data_plane_provider_state
        (tenant_id,worker_script_name,d1_database_id,dispatch_namespace,
         database_status,worker_status,worker_version)
        VALUES (?1,?2,?3,?4,'active','active','old-worker')`
      )
      .run(
        candidate.tenant_id,
        candidate.worker_script_name,
        candidate.d1_database_id,
        candidate.dispatch_namespace
      );
    database
      .prepare("INSERT INTO tenant_catalog_instances VALUES (?1,'ready',5)")
      .run(candidate.tenant_id);
    database
      .prepare("INSERT INTO supplier_sources VALUES (?1,'fleet-canary','active')")
      .run(candidate.tenant_id);
    const params = [
      candidate.tenant_id,
      candidate.worker_script_name,
      candidate.d1_database_id,
      candidate.dispatch_namespace,
      '7',
      '3',
      '1'
    ];

    expect(database.prepare(FLEET_PREPARATION_ELIGIBILITY_SQL).get(...params).total).toBe(1);
    expect(
      database.prepare(FLEET_PREPARATION_PROMOTION_SQL).run(...params, 'worker-command-v1').changes
    ).toBe(1);
    expect(
      database
        .prepare(
          'SELECT migration_command_version, worker_version FROM tenant_data_plane_provider_state'
        )
        .get()
    ).toEqual({ migration_command_version: 3, worker_version: 'worker-command-v1' });
    database.close();
  });

  it('persists only a bounded safe code when upload fails and never promotes capability', async () => {
    const calls = [];
    const controlBatch = vi.fn(async (batch) => {
      calls.push(batch[0]);
      if (batch[0].sql === FLEET_PREPARATION_ELIGIBILITY_SQL) {
        return [{ results: [{ total: 1 }] }];
      }
      if (batch[0].sql === FLEET_PREPARATION_FAILURE_SQL) {
        return [{ meta: { changes: 1 } }];
      }
      throw new Error('unexpected_control_sql');
    });
    const uploadWorker = vi.fn(async () => {
      throw new CloudflarePlatformError('cloudflare_platform_unreachable', 503);
    });

    const result = await prepareTenantMigrationCommandCapability(candidate, {
      platform,
      controlBatch,
      uploadWorker
    });
    expect(result).toEqual({
      tenantId: candidate.tenant_id,
      outcome: 'failed',
      safeErrorCode: 'tenant_migration_command_prepare_unreachable'
    });
    expect(calls.map((entry) => entry.sql)).toEqual([
      FLEET_PREPARATION_ELIGIBILITY_SQL,
      FLEET_PREPARATION_FAILURE_SQL
    ]);
    expect(JSON.stringify(calls)).not.toContain('private');
  });

  it('keeps active imports and retained fleet fixtures out of trusted deploy discovery', () => {
    expect(FLEET_PREPARATION_DISCOVERY_SQL).toContain("s.source_key<>'fleet-canary'");
    expect(FLEET_PREPARATION_DISCOVERY_SQL).toContain('tenant_import_jobs');
    for (const status of ['pending', 'queued', 'scanning', 'details', 'finalizing']) {
      expect(FLEET_PREPARATION_DISCOVERY_SQL).toContain(`'${status}'`);
    }
    expect(FLEET_PREPARATION_DISCOVERY_SQL).toContain("i.status='ready'");
    expect(FLEET_PREPARATION_DISCOVERY_SQL).toContain('i.schema_version < ?1');
    expect(FLEET_PREPARATION_DISCOVERY_SQL).not.toContain('source_url');
  });

  it('processes eligible tenants independently and reports bounded outcomes', async () => {
    const controlBatch = vi.fn(async (batch) => {
      const sql = batch[0].sql;
      if (sql === FLEET_PREPARATION_DISCOVERY_SQL) return [{ results: [candidate] }];
      if (sql === FLEET_PREPARATION_ELIGIBILITY_SQL) {
        return [{ results: [{ total: 1 }] }];
      }
      if (sql === FLEET_PREPARATION_PROMOTION_SQL) return [{ meta: { changes: 1 } }];
      throw new Error('unexpected_control_sql');
    });
    const uploadWorker = vi.fn(async () => ({ versionId: 'worker-command-v1' }));

    await expect(
      runTrustedFleetPreparation(preparationEnv(), {
        controlBatch,
        uploadWorker,
        maxTenants: 5
      })
    ).resolves.toMatchObject({
      tenantDataPlaneFleetPreparationCompleted: true,
      trustedCiOwnedUpload: true,
      recurringSyncAutomationEnabled: false,
      selected: 1,
      prepared: 1,
      skipped: 0,
      failed: 0
    });
  });

  it('keeps upload in trusted CI and schema mutation in the cron dispatch runner', () => {
    const deployIndex = deployWorkflow.indexOf(
      'Prepare eligible tenant migration command capabilities from trusted CI'
    );
    const deployStatusIndex = deployWorkflow.indexOf(
      'Publish successful application deploy evidence'
    );
    expect(deployIndex).toBeGreaterThan(-1);
    expect(deployStatusIndex).toBeGreaterThan(deployIndex);
    expect(deployWorkflow).toContain('cloudflare-tenant-data-plane-fleet-prepare.mjs');
    expect(runner).not.toContain('uploadTenantCatalogWorker');
    expect(runner).toContain('migrateTenantDataPlaneSchema');
    expect(runner).toContain("requireDispatch: migrationKind === 'maintenance'");
    expect(runner).toContain('p.migration_command_version >= ?2');
  });

  it('uses the same preparer in the v5 to v6 canary without preparing the blocked fixture', () => {
    expect(canary).toContain('prepareTenantMigrationCommandCapability(successFixture');
    expect(canary).toContain('allowFleetCanary: true');
    expect(canary).toContain("{ includeSchemaMigration: fixture.kind === 'failure' }");
    expect(canary).toContain('trustedCiOwnedWorkerPreparation: true');
    expect(fleetWorkflow).toContain("'scripts/cloudflare-tenant-data-plane-fleet-prepare.mjs'");
    expect(fleetWorkflow).toContain("'migrations/0019_tenant_data_plane_migration_capability.sql'");
    expect(importCanaryWorkflow).toContain(
      "'migrations/0019_tenant_data_plane_migration_capability.sql'"
    );
  });
});
