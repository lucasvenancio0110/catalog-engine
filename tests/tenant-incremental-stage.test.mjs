import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { planTenantIncrementalScan } from '../worker/ingestion/incremental-plan.js';
import {
  TENANT_SYNC_STAGE_JSON_MAX_BYTES,
  TENANT_SYNC_STAGE_MAX_RECORDS_PER_CHUNK,
  buildIncrementalStagePromotionBatch,
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
    cover_source_url: null,
    image_count_hint: null,
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

function plan(previousRows, scan) {
  return planTenantIncrementalScan({
    previousRows,
    scan,
    scope,
    removalMissThreshold: 3
  });
}

afterEach(() => {
  while (databases.length) databases.pop().close();
});

describe('tenant incremental staged sync', () => {
  it('keeps the canonical LKG unchanged until a no-detail run is explicitly verified', () => {
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
      taxonomy: [{ id: '20', name: 'Moved Team', parentId: null, depth: 0 }],
      items: [item('100', { sourceCategoryId: '20', sourceCategoryPath: ['2', '20'] })]
    };
    const delta = plan([prior], scan);
    expect(delta.summary).toEqual({ MOVED: 1 });
    expect(delta.detailQueue).toEqual([]);

    executeWritePlan(database, buildIncrementalStageWritePlan({ context, scan, plan: delta }));

    expect(
      database.prepare('SELECT source_category_id FROM supplier_album_index WHERE album_source_id=?1').get('100')
        .source_category_id
    ).toBe('10');
    expect(
      database.prepare('SELECT state FROM supplier_sync_stage_runs WHERE run_id=?1').get(context.importId).state
    ).toBe('planned');

    executeBatch(database, buildIncrementalStagePromotionBatch({ context }));
    expect(
      database.prepare('SELECT source_category_id FROM supplier_album_index WHERE album_source_id=?1').get('100')
        .source_category_id
    ).toBe('10');
    expect(
      database.prepare('SELECT state FROM supplier_sync_stage_runs WHERE run_id=?1').get(context.importId).state
    ).toBe('planned');

    const verification = executeBatch(
      database,
      buildIncrementalStageVerificationBatch({ context, verificationCode: 'sync_fixture_verified' })
    );
    expect(verification.at(-1).results[0].state).toBe('verified');

    const promotion = executeBatch(database, buildIncrementalStagePromotionBatch({ context }));
    expect(promotion.at(-1).results[0].state).toBe('promoted');
    expect(
      database.prepare('SELECT source_category_id FROM supplier_album_index WHERE album_source_id=?1').get('100')
        .source_category_id
    ).toBe('20');
    expect(
      database.prepare('SELECT event_type FROM supplier_sync_events WHERE run_id=?1').get(context.importId)
        .event_type
    ).toBe('MOVED');
    expect(
      database.prepare('SELECT COUNT(*) AS total FROM catalog_products').get().total
    ).toBe(0);
  });

  it('records quarantine metadata without staging raw supplier observations or touching LKG', () => {
    const database = createDatabase();
    const previousRows = Array.from({ length: 220 }, (_, index) => previous(String(1000 + index)));
    for (const row of previousRows) {
      database
        .prepare(`INSERT INTO supplier_album_index
          (tenant_id, source_key, album_source_id, public_product_id, source_url, source_title,
           source_category_id, source_category_path_json, listing_fingerprint, detail_fingerprint,
           status, miss_count)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'active', 0)`)
        .run(
          context.tenantId,
          context.sourceKey,
          row.album_source_id,
          row.public_product_id,
          row.source_url,
          row.source_title,
          row.source_category_id,
          row.source_category_path_json,
          row.listing_fingerprint,
          row.detail_fingerprint
        );
    }
    const scan = {
      complete: true,
      taxonomy: [],
      items: Array.from({ length: 20 }, (_, index) => item(String(1000 + index)))
    };
    const delta = plan(previousRows, scan);
    expect(delta.decision.outcome).toBe('quarantine');

    const writePlan = buildIncrementalStageWritePlan({ context, scan, plan: delta });
    expect(writePlan.observationBatches).toHaveLength(0);
    expect(writePlan.eventBatches).toHaveLength(0);
    executeWritePlan(database, writePlan);

    const stage = database
      .prepare(`SELECT state, safety_outcome, observed_count, staged_observation_count
                  FROM supplier_sync_stage_runs WHERE run_id=?1`)
      .get(context.importId);
    expect(stage).toMatchObject({
      state: 'quarantined',
      safety_outcome: 'quarantine',
      observed_count: 20,
      staged_observation_count: 0
    });
    expect(
      database.prepare('SELECT COUNT(*) AS total FROM supplier_album_index').get().total
    ).toBe(220);
  });

  it('chunks large healthy observations instead of building one D1 statement per product', () => {
    const scan = {
      complete: true,
      taxonomy: [],
      items: Array.from({ length: 501 }, (_, index) => item(String(index + 1)))
    };
    const delta = plan([], scan);
    expect(delta.decision.outcome).toBe('proceed');
    expect(delta.detailQueue).toHaveLength(501);

    const writePlan = buildIncrementalStageWritePlan({ context, scan, plan: delta });
    expect(writePlan.observationBatches).toHaveLength(3);
    expect(writePlan.observationBatches.every((batch) => batch.length === 1)).toBe(true);
    for (const batch of writePlan.observationBatches) {
      const payload = batch[0].params[1];
      expect(JSON.parse(payload).length).toBeLessThanOrEqual(TENANT_SYNC_STAGE_MAX_RECORDS_PER_CHUNK);
      expect(new TextEncoder().encode(payload).byteLength).toBeLessThanOrEqual(
        TENANT_SYNC_STAGE_JSON_MAX_BYTES
      );
    }
  });

  it('does not verify a run that still requires detail processing', () => {
    const database = createDatabase();
    const scan = { complete: true, taxonomy: [], items: [item('100')] };
    const delta = plan([], scan);
    expect(delta.detailQueue).toEqual(['100']);
    executeWritePlan(database, buildIncrementalStageWritePlan({ context, scan, plan: delta }));
    expect(
      database.prepare('SELECT state FROM supplier_sync_stage_runs WHERE run_id=?1').get(context.importId).state
    ).toBe('details_pending');

    const verification = executeBatch(database, buildIncrementalStageVerificationBatch({ context }));
    expect(verification.at(-1).results[0].state).toBe('details_pending');
    executeBatch(database, buildIncrementalStagePromotionBatch({ context }));
    expect(
      database.prepare('SELECT COUNT(*) AS total FROM supplier_album_index').get().total
    ).toBe(0);
  });
});
