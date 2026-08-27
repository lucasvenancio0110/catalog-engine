import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { buildIncrementalStageWritePlan } from '../worker/ingestion/incremental-stage.js';
import { tenantDataPlaneCurrentBatch as tenantDataPlaneV6Batch } from '../worker/tenant-data-plane-schema-v6.js';
import {
  TENANT_DATA_PLANE_SCHEMA_VERSION,
  TENANT_DATA_PLANE_V7_STATEMENTS,
  TENANT_SYNC_AUTHORITY_CONTRACT_VERSION,
  tenantDataPlaneCurrentBatch,
  tenantDataPlaneMigrationBatches
} from '../worker/tenant-data-plane-schema-v7.js';

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

function database() {
  const instance = new DatabaseSync(':memory:');
  instance.exec('PRAGMA foreign_keys = ON');
  databases.push(instance);
  return instance;
}

function applyBatch(instance, batch) {
  instance.exec('BEGIN');
  try {
    for (const query of batch) instance.prepare(query.sql).run(...(query.params || []));
    instance.exec('COMMIT');
  } catch (error) {
    instance.exec('ROLLBACK');
    throw error;
  }
}

function installV6(instance) {
  applyBatch(instance, tenantDataPlaneV6Batch({ tenantId, source: source() }));
}

function installV7(instance) {
  applyBatch(instance, tenantDataPlaneCurrentBatch({ tenantId, source: source() }));
}

function seedV6BusinessTruth(instance) {
  instance
    .prepare(`INSERT INTO catalog_products
      (product_id,name,search_text,category_id,category_name,description)
      VALUES ('p_0123456789abcdefabcd','LKG','lkg','legacy','Legacy','healthy')`)
    .run();
  instance
    .prepare(`INSERT INTO catalog_product_classification_overrides
      (product_id,override_json,override_version)
      VALUES ('p_0123456789abcdefabcd','{"displayName":"Merchant Truth"}',7)`)
    .run();
  instance
    .prepare(`INSERT INTO supplier_sync_stage_runs
      (run_id,tenant_id,source_key,scope_id,scope_kind,state,safety_outcome,
       safety_policy_version,scan_complete,previous_known_good_count,observed_count,
       expected_event_count,expected_detail_count,staged_observation_count,
       staged_event_count,staged_category_count,verification_code)
      VALUES ('sync_v6_history',?1,'primary','catalog','catalog','verified','proceed',1,1,1,1,0,0,1,0,0,'sync_candidate_verified_v1')`)
    .run(tenantId);
}

function stagePlan(importId = 'sync_v7_snapshot') {
  const context = {
    mode: 'incremental',
    importId,
    tenantId,
    sourceKey: 'primary'
  };
  const scan = { complete: true, items: [], taxonomy: [], disqualifyingFailureCount: 0 };
  const plan = {
    decision: { outcome: 'proceed', policyVersion: 1, scope: { id: 'catalog', kind: 'catalog' } },
    events: [],
    detailQueue: [],
    previousKnownGoodCount: 0,
    observedCount: 0,
    counts: {}
  };
  return buildIncrementalStageWritePlan({ context, scan, plan });
}

afterEach(() => {
  while (databases.length) databases.pop().close();
});

describe('tenant data-plane schema v7 serving authority', () => {
  it('installs a tenant-wide revision authority and run-scoped base snapshot tables', () => {
    const instance = database();
    installV7(instance);

    expect(TENANT_DATA_PLANE_SCHEMA_VERSION).toBe(7);
    expect(TENANT_SYNC_AUTHORITY_CONTRACT_VERSION).toBe(1);
    expect(TENANT_DATA_PLANE_V7_STATEMENTS.join('\n').toLowerCase()).not.toContain('alter table');
    expect(instance.prepare('SELECT schema_version FROM data_plane_identity').get()).toEqual({
      schema_version: 7
    });
    expect(
      instance.prepare('SELECT version FROM data_plane_schema_migrations ORDER BY version').all()
    ).toEqual([1, 2, 3, 4, 5, 6, 7].map((version) => ({ version })));
    expect(
      instance
        .prepare(`SELECT contract_version,revision,last_promoted_run_id,last_promoted_source_key
                    FROM catalog_serving_authority WHERE tenant_id=?1`)
        .get(tenantId)
    ).toEqual({
      contract_version: 1,
      revision: 0,
      last_promoted_run_id: null,
      last_promoted_source_key: null
    });
    expect(instance.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('upgrades v6 to v7 idempotently without touching LKG, overrides or verified candidate state', () => {
    const instance = database();
    installV6(instance);
    seedV6BusinessTruth(instance);
    const [batch] = tenantDataPlaneMigrationBatches({
      tenantId,
      source: source(),
      currentVersion: 6,
      targetVersion: 7
    });

    expect(batch).toHaveLength(TENANT_DATA_PLANE_V7_STATEMENTS.length + 2);
    applyBatch(instance, batch);
    applyBatch(instance, batch);

    expect(instance.prepare('SELECT schema_version FROM data_plane_identity').get()).toEqual({
      schema_version: 7
    });
    expect(instance.prepare('SELECT name,description FROM catalog_products').get()).toEqual({
      name: 'LKG',
      description: 'healthy'
    });
    expect(
      instance.prepare('SELECT override_json,override_version FROM catalog_product_classification_overrides').get()
    ).toEqual({ override_json: '{"displayName":"Merchant Truth"}', override_version: 7 });
    expect(
      instance.prepare("SELECT state,verification_code FROM supplier_sync_stage_runs WHERE run_id='sync_v6_history'").get()
    ).toEqual({ state: 'verified', verification_code: 'sync_candidate_verified_v1' });
    expect(instance.prepare('SELECT revision FROM catalog_serving_authority').get()).toEqual({ revision: 0 });
    expect(instance.prepare('SELECT COUNT(*) AS total FROM supplier_sync_stage_authority').get()).toEqual({
      total: 0
    });
    expect(instance.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('snapshots authority once when staging starts and preserves that stale-base token on retry', () => {
    const instance = database();
    installV7(instance);
    const writePlan = stagePlan();

    applyBatch(instance, writePlan.beginBatch);
    expect(
      instance.prepare('SELECT base_authority_revision FROM supplier_sync_stage_authority').get()
    ).toEqual({ base_authority_revision: 0 });

    instance.prepare('UPDATE catalog_serving_authority SET revision=1 WHERE tenant_id=?1').run(tenantId);
    applyBatch(instance, writePlan.beginBatch);

    expect(
      instance.prepare('SELECT base_authority_revision FROM supplier_sync_stage_authority').get()
    ).toEqual({ base_authority_revision: 0 });
    expect(instance.prepare('SELECT revision FROM catalog_serving_authority').get()).toEqual({ revision: 1 });
    expect(instance.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});
