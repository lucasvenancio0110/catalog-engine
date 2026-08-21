import { describe, expect, it } from 'vitest';
import {
  TENANT_DATA_PLANE_CURRENT_STATEMENTS,
  TENANT_DATA_PLANE_SCHEMA_VERSION,
  TENANT_DATA_PLANE_V4_STATEMENTS,
  tenantDataPlaneCurrentBatch
} from '../worker/tenant-data-plane-schema-v4.js';

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

describe('tenant data-plane schema v4 CEI persistence', () => {
  it('advances the current schema to v4 with one generic intelligence state table', () => {
    const sql = TENANT_DATA_PLANE_CURRENT_STATEMENTS.join('\n').toLowerCase();
    expect(TENANT_DATA_PLANE_SCHEMA_VERSION).toBe(4);
    expect(sql).toContain('catalog_product_intelligence_state');
    expect(sql).toContain('state_json');
    expect(sql).toContain('domain_id');
    expect(sql).toContain('knowledge_state');
    expect(sql).toContain('review_required');
    expect(sql).toContain('research_required');
    expect(sql).toContain('conflict_count');
  });

  it('keeps CEI Core persistence domain-neutral instead of hardcoding Sports fields', () => {
    const v4 = TENANT_DATA_PLANE_V4_STATEMENTS.join('\n').toLowerCase();
    for (const forbidden of [
      'team_confidence',
      'league_confidence',
      'season_confidence',
      'bolt_pattern',
      'vehicle_make',
      'dental_platform'
    ]) {
      expect(v4).not.toContain(forbidden);
    }
    expect(v4).toContain('state_json');
    expect(v4).toContain('knowledge_pack_key');
    expect(v4).toContain('domain_id');
  });

  it('allows explicit CEI epistemic states and validates JSON at the database boundary', () => {
    const v4 = TENANT_DATA_PLANE_V4_STATEMENTS.join('\n');
    for (const state of ['VERIFIED', 'KNOWN', 'UNCERTAIN', 'UNKNOWN', 'CONFLICT', 'STALE']) {
      expect(v4).toContain(`'${state}'`);
    }
    expect(v4).toContain('json_valid(state_json)');
  });

  it('extends v3 idempotently and records schema migration 4', () => {
    const migrationBatch = batch();
    const identityUpdates = migrationBatch.filter((query) =>
      query.sql.includes('UPDATE data_plane_identity')
    );
    const ledgers = migrationBatch.filter((query) =>
      query.sql.includes('INSERT OR IGNORE INTO data_plane_schema_migrations')
    );

    expect(identityUpdates.at(-1).params).toEqual([tenantId, 4]);
    expect(ledgers.at(-1).params).toEqual([4]);
    expect(migrationBatch.map((query) => query.sql).join('\n').toLowerCase()).toContain(
      'create table if not exists catalog_product_intelligence_state'
    );
  });

  it('does not embed the private source URL in static CEI schema SQL', () => {
    expect(TENANT_DATA_PLANE_V4_STATEMENTS.join('\n')).not.toContain(sourceUrl);
  });
});
