import { describe, expect, it } from 'vitest';
import {
  TENANT_DATA_PLANE_CURRENT_STATEMENTS,
  TENANT_DATA_PLANE_SCHEMA_VERSION,
  TENANT_DATA_PLANE_V3_STATEMENTS,
  tenantDataPlaneCurrentBatch
} from '../worker/tenant-data-plane-schema-v3.js';

const tenantId = 't_0123456789abcdefabcd';
const sourceUrl = 'https://private-supplier.x.yupoo.com/albums/';

function batch() {
  return tenantDataPlaneCurrentBatch({
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
  it('contains catalog/import/classification/media structures but no SaaS control-plane tables', () => {
    const sql = TENANT_DATA_PLANE_CURRENT_STATEMENTS.join('\n').toLowerCase();
    expect(TENANT_DATA_PLANE_SCHEMA_VERSION).toBe(3);
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
      'supplier_category_index',
      'supplier_album_detail_state',
      'supplier_sync_runs',
      'supplier_sync_events',
      'catalog_product_classification_state',
      'catalog_product_classification_overrides'
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

  it('adds classifier version state and durable manual overrides in v3', () => {
    const v3 = TENANT_DATA_PLANE_V3_STATEMENTS.join('\n').toLowerCase();
    expect(v3).toContain('catalog_product_classification_state');
    expect(v3).toContain('classifier_version');
    expect(v3).toContain('override_applied');
    expect(v3).toContain('catalog_product_classification_overrides');
    expect(v3).toContain('override_json');
  });

  it('never embeds the private supplier URL into static migration SQL', () => {
    expect(TENANT_DATA_PLANE_CURRENT_STATEMENTS.join('\n')).not.toContain(sourceUrl);
    const migrationBatch = batch();
    const sql = migrationBatch.map((query) => query.sql).join('\n');
    expect(sql).not.toContain(sourceUrl);
    const sourceInsert = migrationBatch.find((query) => query.sql.includes('INSERT INTO supplier_sources'));
    expect(sourceInsert.params).toContain(sourceUrl);
  });

  it('initializes one tenant/source then advances identity and ledger through v3', () => {
    const migrationBatch = batch();
    const identityInsert = migrationBatch.find((query) =>
      query.sql.includes('INSERT INTO data_plane_identity')
    );
    const identityUpdates = migrationBatch.filter((query) =>
      query.sql.includes('UPDATE data_plane_identity')
    );
    const source = migrationBatch.find((query) => query.sql.includes('INSERT INTO supplier_sources'));
    const ledgers = migrationBatch.filter((query) =>
      query.sql.includes('INSERT OR IGNORE INTO data_plane_schema_migrations')
    );

    expect(identityInsert.params).toEqual([tenantId, 1]);
    expect(identityUpdates.map((query) => query.params)).toEqual([
      [tenantId, 2],
      [tenantId, 3]
    ]);
    expect(source.params).toEqual([
      tenantId,
      'primary',
      'yupoo',
      sourceUrl,
      'incremental',
      3
    ]);
    expect(ledgers.map((query) => query.params)).toEqual([[1], [2], [3]]);
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
    expect(() => tenantDataPlaneCurrentBatch({ tenantId, source: null })).toThrow(
      'tenant_source_required'
    );
    expect(() =>
      tenantDataPlaneCurrentBatch({
        tenantId,
        source: { sourceKey: 'primary', provider: 'other', sourceUrl: 'https://example.com' }
      })
    ).toThrow('tenant_source_required');
  });
});
