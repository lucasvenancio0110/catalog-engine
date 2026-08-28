import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION } from '../worker/tenant-data-plane-command.js';
import { TENANT_DATA_PLANE_SCHEMA_VERSION } from '../worker/tenant-data-plane-schema-v8.js';
import {
  FLEET_PREPARATION_ELIGIBILITY_SQL,
  FLEET_PREPARATION_PROMOTION_SQL,
  prepareTenantMigrationCommandCapability
} from '../scripts/cloudflare-tenant-data-plane-fleet-prepare.mjs';

const candidate = {
  tenant_id: 't_0123456789abcdefabcd',
  worker_script_name: 'ce-0123456789abcdefabcd',
  d1_database_id: '11111111-1111-4111-8111-111111111111',
  dispatch_namespace: 'catalog-engine-production'
};

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE tenant_data_plane_provider_state (
      tenant_id TEXT PRIMARY KEY,
      worker_script_name TEXT NOT NULL,
      d1_database_id TEXT NOT NULL,
      dispatch_namespace TEXT NOT NULL,
      database_status TEXT NOT NULL,
      worker_status TEXT NOT NULL,
      migration_command_version INTEGER NOT NULL DEFAULT 0,
      migration_command_prepared_at TEXT,
      migration_command_last_error_code TEXT,
      worker_version TEXT,
      last_checked_at TEXT,
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
    );
  `);
  db.prepare(`INSERT INTO tenant_data_plane_provider_state
    (tenant_id,worker_script_name,d1_database_id,dispatch_namespace,database_status,worker_status,migration_command_version,worker_version)
    VALUES (?1,?2,?3,?4,'active','active',0,'v7-worker')`)
    .run(candidate.tenant_id,candidate.worker_script_name,candidate.d1_database_id,candidate.dispatch_namespace);
  db.prepare("INSERT INTO tenant_catalog_instances VALUES (?1,'ready',7)").run(candidate.tenant_id);
  db.prepare("INSERT INTO supplier_sources VALUES (?1,'fleet-canary','active')").run(candidate.tenant_id);
  return db;
}

function controlBatch(db) {
  return async (batch) => batch.map(({ sql, params = [] }) => {
    if (sql === FLEET_PREPARATION_ELIGIBILITY_SQL) {
      return { results: [db.prepare(sql).get(...params)] };
    }
    if (sql === FLEET_PREPARATION_PROMOTION_SQL) {
      const result = db.prepare(sql).run(...params);
      return { meta: { changes: Number(result.changes || 0) } };
    }
    throw new Error('unexpected_sql');
  });
}

describe('M7D9 trusted fleet preparation regression', () => {
  it('prepares an existing schema-v7 retained canary for schema v8 command v4', async () => {
    expect(TENANT_DATA_PLANE_SCHEMA_VERSION).toBe(8);
    expect(TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION).toBe(4);
    const db = database();
    const uploadWorker = vi.fn(async () => ({ versionId: 'worker-v8-command-v4' }));

    const result = await prepareTenantMigrationCommandCapability(candidate, {
      platform: {
        accountId: '0123456789abcdef0123456789abcdef',
        apiToken: 'platform-token-that-is-long-enough-for-tests',
        dispatchNamespace: candidate.dispatch_namespace
      },
      controlBatch: controlBatch(db),
      uploadWorker,
      allowFleetCanary: true
    });

    expect(result).toEqual({
      tenantId: candidate.tenant_id,
      outcome: 'prepared',
      migrationCommandVersion: 4
    });
    expect(uploadWorker).toHaveBeenCalledTimes(1);
    expect(db.prepare('SELECT migration_command_version, worker_version FROM tenant_data_plane_provider_state').get()).toEqual({
      migration_command_version: 4,
      worker_version: 'worker-v8-command-v4'
    });
    db.close();
  });
});
