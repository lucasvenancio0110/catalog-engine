import { describe, expect, it } from 'vitest';
import {
  TENANT_DATA_PLANE_SCHEMA_VERSION,
  TENANT_DATA_PLANE_V1_STATEMENTS,
  tenantDataPlaneV1Batch
} from '../worker/tenant-data-plane-schema.js';

const tenantId = 't_0123456789abcdefabcd';
const sourceUrl = 'https://private-supplier.x.yupoo.com/albums/';

function batch() {
  return tenantDataPlaneV1Batch({
    tenantId,
    source: {
      sourceKey: 'primary',
      provider: 'yupoo',
      sourceUrl,
      syncStrategy: 'incremental',
      removalMissThreshold: 3
    }
  });
}

describe('tenant data-plane schema', () => {
  it('contains catalog/sync/media structures but no SaaS control-plane tables', () => {
    const sql = TENANT_DATA_PLANE_V1_STATEMENTS.join('\n').toLowerCase();
    expect(TENANT_DATA_PLANE_SCHEMA_VERSION).toBe(1);
    for (const required of [
      'media_sources',
      'product_media',
      'catalog_products',
      'catalog_categories',
      'catalog_leagues',
      'catalog_teams',
      'catalog_facets',
      'supplier_sources',
      'supplier_album_index',
      'supplier_sync_runs',
      'supplier_sync_events'
    ]) {
      expect(sql).toContain(required);
    }
    for (const forbidden of [
      'tenant_memberships',
      'tenant_domains',
      'tenant_store_profiles',
      'tenant_audit_log',
      'tenant_provisioning_runs',
      'catalog_theme_presets'
    ]) {
      expect(sql).not.toContain(forbidden);
    }
  });

  it('never embeds the private supplier URL into static migration SQL', () => {
    expect(TENANT_DATA_PLANE_V1_STATEMENTS.join('\n')).not.toContain(sourceUrl);
    const migrationBatch = batch();
    const sql = migrationBatch.map((query) => query.sql).join('\n');
    expect(sql).not.toContain(sourceUrl);
    const sourceInsert = migrationBatch.find((query) => query.sql.includes('INSERT INTO supplier_sources'));
    expect(sourceInsert.params).toContain(sourceUrl);
  });

  it('initializes exactly one tenant identity and one source using bound values', () => {
    const migrationBatch = batch();
    const identity = migrationBatch.find((query) => query.sql.includes('INSERT INTO data_plane_identity'));
    const source = migrationBatch.find((query) => query.sql.includes('INSERT INTO supplier_sources'));
    const ledger = migrationBatch.find((query) =>
      query.sql.includes('INSERT OR IGNORE INTO data_plane_schema_migrations')
    );

    expect(identity.params).toEqual([tenantId, 1]);
    expect(source.params).toEqual([
      tenantId,
      'primary',
      'yupoo',
      sourceUrl,
      'incremental',
      3
    ]);
    expect(ledger.params).toEqual([1]);
  });

  it('is idempotent by construction for schema, identity, source and migration ledger writes', () => {
    const sql = batch().map((query) => query.sql).join('\n').toLowerCase();
    expect(sql).toContain('create table if not exists');
    expect(sql).toContain('create index if not exists');
    expect(sql).toContain('on conflict(tenant_id) do update');
    expect(sql).toContain('on conflict(tenant_id, source_key) do update');
    expect(sql).toContain('insert or ignore into data_plane_schema_migrations');
  });

  it('rejects migration generation without a supported private source', () => {
    expect(() => tenantDataPlaneV1Batch({ tenantId, source: null })).toThrow('tenant_source_required');
    expect(() =>
      tenantDataPlaneV1Batch({
        tenantId,
        source: { sourceKey: 'primary', provider: 'other', sourceUrl: 'https://example.com' }
      })
    ).toThrow('tenant_source_required');
  });
});
