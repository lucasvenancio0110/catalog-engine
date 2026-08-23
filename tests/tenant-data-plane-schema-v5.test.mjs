import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  TENANT_DATA_PLANE_CURRENT_STATEMENTS,
  TENANT_DATA_PLANE_SCHEMA_VERSION,
  TENANT_DATA_PLANE_V5_STATEMENTS,
  TENANT_SYNC_STAGE_CONTRACT_VERSION,
  tenantDataPlaneCurrentBatch,
  tenantDataPlaneMigrationBatches
} from '../worker/tenant-data-plane-schema-v5.js';

const databases = [];
const tenantId = 't_0123456789abcdefabcd';
const sourceUrl = 'https://private-supplier.x.yupoo.com/albums/';

function source() {
  return {
    sourceKey: 'primary',
    provider: 'yupoo',
    sourceUrl,
    syncStrategy: 'incremental',
    removalMissThreshold: 3
  };
}

afterEach(() => {
  while (databases.length) databases.pop().close();
});

describe('tenant data-plane schema v5 staged sync state', () => {
  it('extends v4 with private staging tables and advances identity/ledger to v5', () => {
    const sql = TENANT_DATA_PLANE_V5_STATEMENTS.join('\n').toLowerCase();
    expect(TENANT_DATA_PLANE_SCHEMA_VERSION).toBe(5);
    expect(TENANT_SYNC_STAGE_CONTRACT_VERSION).toBe(1);
    for (const table of [
      'supplier_sync_stage_runs',
      'supplier_sync_stage_observations',
      'supplier_sync_stage_events',
      'supplier_sync_stage_categories'
    ]) {
      expect(sql).toContain(table);
    }

    const batch = tenantDataPlaneCurrentBatch({ tenantId, source: source() });
    const identityUpdates = batch.filter((query) =>
      query.sql.includes('UPDATE data_plane_identity')
    );
    const ledgers = batch.filter((query) =>
      query.sql.includes('INSERT OR IGNORE INTO data_plane_schema_migrations')
    );
    expect(identityUpdates.at(-1).params).toEqual([tenantId, 5]);
    expect(ledgers.at(-1).params).toEqual([5]);
  });

  it('keeps staging private/source-oriented and does not add a competing public catalog', () => {
    const sql = TENANT_DATA_PLANE_V5_STATEMENTS.join('\n').toLowerCase();
    expect(sql).toContain('source_url text not null');
    expect(sql).toContain('album_source_id text not null');
    expect(sql).toContain("'preserved'");
    expect(sql).toContain("'quarantined'");
    expect(sql).toContain("'verified'");
    expect(sql).toContain("'promoting'");
    expect(sql).toContain("'promoted'");
    expect(sql).not.toContain('create table if not exists catalog_products');
    expect(sql).not.toContain('tenant_memberships');
    expect(sql).not.toContain('tenant_domains');
  });

  it('installs the complete v5 schema in real SQLite with foreign keys enabled', () => {
    const database = new DatabaseSync(':memory:');
    databases.push(database);
    database.exec('PRAGMA foreign_keys = ON');
    for (const statement of TENANT_DATA_PLANE_CURRENT_STATEMENTS) database.exec(statement);

    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((row) => row.name);
    expect(tables).toContain('supplier_album_index');
    expect(tables).toContain('catalog_product_intelligence_state');
    expect(tables).toContain('supplier_sync_stage_runs');
    expect(tables).toContain('supplier_sync_stage_observations');
    expect(tables).toContain('supplier_sync_stage_events');
    expect(tables).toContain('supplier_sync_stage_categories');
  });

  it('does not embed the private source URL into static v5 schema SQL', () => {
    expect(TENANT_DATA_PLANE_V5_STATEMENTS.join('\n')).not.toContain(sourceUrl);
  });

  it('plans fresh provisioning as one bounded transactional batch per schema version', () => {
    const batches = tenantDataPlaneMigrationBatches({
      tenantId,
      source: source(),
      currentVersion: 0,
      targetVersion: 5
    });

    expect(batches).toHaveLength(5);
    expect(batches.every((batch) => batch.length > 0 && batch.length < 100)).toBe(true);
    expect(
      batches.map((batch) =>
        Number(
          batch
            .filter((query) =>
              query.sql.includes('INSERT OR IGNORE INTO data_plane_schema_migrations')
            )
            .at(-1)?.params?.[0]
        )
      )
    ).toEqual([1, 2, 3, 4, 5]);
  });

  it('plans a v4 maintenance retry as only the idempotent v5 delta', () => {
    const [batch] = tenantDataPlaneMigrationBatches({
      tenantId,
      source: source(),
      currentVersion: 4,
      targetVersion: 5
    });
    const sql = batch.map((query) => query.sql).join('\n');

    expect(batch).toHaveLength(TENANT_DATA_PLANE_V5_STATEMENTS.length + 2);
    expect(sql).toContain('supplier_sync_stage_runs');
    expect(sql).not.toContain('CREATE TABLE IF NOT EXISTS catalog_products');
    expect(batch.at(-2).params).toEqual([tenantId, 5]);
    expect(batch.at(-1).params).toEqual([5]);
  });

  it('rejects impossible migration ranges before producing D1 work', () => {
    expect(() =>
      tenantDataPlaneMigrationBatches({
        tenantId,
        source: source(),
        currentVersion: 5,
        targetVersion: 4
      })
    ).toThrow('tenant_data_plane_migration_range_invalid');
  });
});
