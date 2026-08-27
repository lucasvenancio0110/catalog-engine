import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { planTenantIncrementalScan } from '../worker/ingestion/incremental-plan.js';
import {
  buildIncrementalStageVerificationBatch,
  buildIncrementalStageWritePlan
} from '../worker/ingestion/incremental-stage.js';
import { TENANT_DATA_PLANE_CURRENT_STATEMENTS } from '../worker/tenant-data-plane-schema-v7.js';

const databases = [];
const context = {
  importId: 'imp_0123456789abcdefabcd',
  tenantId: 't_0123456789abcdefabcd',
  sourceKey: 'primary',
  mode: 'incremental'
};
const scope = { id: 's_0123456789abcdefabcd', kind: 'source' };

function previous(id, overrides = {}) {
  return {
    album_source_id: id,
    public_product_id: `p_${String(id).padStart(20, '0').slice(-20)}`,
    source_url: `https://supplier.x.yupoo.com/albums/${id}`,
    source_title: `Product ${id}`,
    source_category_id: '10',
    source_category_path_json: '["1","10"]',
    listing_fingerprint: `fp-${id}`,
    detail_fingerprint: `detail-${id}`,
    status: 'active',
    miss_count: 0,
    ...overrides
  };
}

function item(id, overrides = {}) {
  return {
    albumSourceId: id,
    publicProductId: `p_${String(id).padStart(20, '0').slice(-20)}`,
    sourceUrl: `https://supplier.x.yupoo.com/albums/${id}`,
    sourceTitle: `Product ${id}`,
    sourceCategoryId: '10',
    sourceCategoryPath: ['1', '10'],
    coverSourceUrl: null,
    imageCountHint: null,
    listingFingerprint: `fp-${id}`,
    ...overrides
  };
}

function createDatabase() {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  database.exec('PRAGMA foreign_keys = ON');
  for (const statement of TENANT_DATA_PLANE_CURRENT_STATEMENTS) database.exec(statement);
  database
    .prepare(`INSERT INTO supplier_sources
      (tenant_id, source_key, provider, source_url, status, sync_strategy, removal_miss_threshold)
      VALUES (?1, ?2, 'yupoo', ?3, 'active', 'incremental', 3)`)
    .run(context.tenantId, context.sourceKey, 'https://supplier.x.yupoo.com/albums/');
  return database;
}

function executeBatch(database, batch) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const results = batch.map((query) => {
      const statement = database.prepare(query.sql);
      if (/^\s*SELECT\b/i.test(query.sql)) return { results: statement.all(...query.params) };
      const result = statement.run(...query.params);
      return { success: true, meta: { changes: Number(result.changes || 0) } };
    });
    database.exec('COMMIT');
    return results;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function executeWritePlan(database, writePlan) {
  executeBatch(database, writePlan.beginBatch);
  for (const batch of writePlan.observationBatches) executeBatch(database, batch);
  for (const batch of writePlan.eventBatches) executeBatch(database, batch);
  for (const batch of writePlan.categoryBatches) executeBatch(database, batch);
  executeBatch(database, writePlan.sealBatch);
}

function delta(previousRows, scan) {
  return planTenantIncrementalScan({ previousRows, scan, scope, removalMissThreshold: 3 });
}

afterEach(() => {
  while (databases.length) databases.pop().close();
});

describe('staged incremental run ledger', () => {
  it('persists opaque scope and leaves canonical run open after stage-only verification', () => {
    const database = createDatabase();
    const prior = previous('100');
    database
      .prepare(`INSERT INTO supplier_album_index
        (tenant_id, source_key, album_source_id, public_product_id, source_url, source_title,
         source_category_id, source_category_path_json, listing_fingerprint, detail_fingerprint,
         status, miss_count)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'active', 0)`)
      .run(
        context.tenantId,
        context.sourceKey,
        prior.album_source_id,
        prior.public_product_id,
        prior.source_url,
        prior.source_title,
        prior.source_category_id,
        prior.source_category_path_json,
        prior.listing_fingerprint,
        prior.detail_fingerprint
      );

    const scan = {
      complete: true,
      taxonomy: [],
      items: [item('100', { sourceCategoryId: '20', sourceCategoryPath: ['2', '20'] })]
    };
    const plan = delta([prior], scan);
    executeWritePlan(database, buildIncrementalStageWritePlan({ context, scan, plan }));

    expect(
      database
        .prepare('SELECT scope_id, scope_kind, state FROM supplier_sync_stage_runs WHERE run_id=?1')
        .get(context.importId)
    ).toMatchObject({ scope_id: scope.id, scope_kind: scope.kind, state: 'planned' });
    expect(
      database.prepare('SELECT status, error_text FROM supplier_sync_runs WHERE run_id=?1').get(context.importId)
    ).toMatchObject({ status: 'running', error_text: null });

    executeBatch(database, buildIncrementalStageVerificationBatch({ context }));

    expect(
      database.prepare('SELECT status, error_text FROM supplier_sync_runs WHERE run_id=?1').get(context.importId)
    ).toMatchObject({ status: 'running', error_text: null });
    expect(
      database.prepare('SELECT state FROM supplier_sync_stage_runs WHERE run_id=?1').get(context.importId).state
    ).toBe('verified');
  });

  it('closes a quarantined canonical run as failed with only a safe reason code', () => {
    const database = createDatabase();
    const previousRows = Array.from({ length: 220 }, (_, index) => previous(String(1000 + index)));
    const scan = {
      complete: true,
      taxonomy: [],
      items: Array.from({ length: 20 }, (_, index) => item(String(1000 + index)))
    };
    const plan = delta(previousRows, scan);
    expect(plan.decision.outcome).toBe('quarantine');

    executeWritePlan(database, buildIncrementalStageWritePlan({ context, scan, plan }));

    expect(
      database.prepare('SELECT state, last_error_code FROM supplier_sync_stage_runs WHERE run_id=?1').get(context.importId)
    ).toMatchObject({
      state: 'quarantined',
      last_error_code: 'sync_catastrophic_volume_drop'
    });
    expect(
      database.prepare('SELECT status, error_text FROM supplier_sync_runs WHERE run_id=?1').get(context.importId)
    ).toMatchObject({
      status: 'failed',
      error_text: 'sync_catastrophic_volume_drop'
    });
  });
});
