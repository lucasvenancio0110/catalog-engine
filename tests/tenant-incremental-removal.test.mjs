import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { planTenantIncrementalScan } from '../worker/ingestion/incremental-plan.js';
import { buildIncrementalStageWritePlan } from '../worker/ingestion/incremental-stage.js';
import { processTenantIncrementalPromotion } from '../worker/ingestion/incremental-promotion.js';
import { tenantDataPlaneCurrentBatch } from '../worker/tenant-data-plane-schema-v8.js';

const TENANT_ID = 't_0123456789abcdefabcd';
const SOURCE_KEY = 'primary';
const SCOPE_A = 's_aaaaaaaaaaaaaaaaaaaa';
const SCOPE_B = 's_bbbbbbbbbbbbbbbbbbbb';
const TARGET_ID = 'p_11111111111111111111';
const CONTROL_ID = 'p_22222222222222222222';
const TARGET_ALBUM = 'album-target';
const CONTROL_ALBUM = 'album-control';
const CATEGORY_ID = 'c_33333333333333333333';
const DATABASE_ID = '0123456789abcdef0123456789abcdef';
const databases = [];

function source() {
  return {
    provider: 'yupoo',
    sourceKey: SOURCE_KEY,
    sourceUrl: 'https://private-source.x.yupoo.com/albums/',
    syncStrategy: 'incremental',
    removalMissThreshold: 3
  };
}

function scope() {
  return { id: SCOPE_A, kind: 'source' };
}

function context(runId, schemaVersion = 8) {
  return {
    importId: runId,
    tenantId: TENANT_ID,
    sourceKey: SOURCE_KEY,
    mode: 'incremental',
    schemaVersion,
    dataPlane: {
      databaseId: DATABASE_ID,
      dispatchNamespace: 'catalog-engine-production'
    }
  };
}

function platformEnv() {
  return {
    CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE: 'catalog-engine-production',
    CLOUDFLARE_PLATFORM_ACCOUNT_ID: 'a'.repeat(32),
    CLOUDFLARE_PLATFORM_API_TOKEN: 'token-token-token-token-token'
  };
}

function applyStatements(database, statements) {
  for (const statement of statements) {
    database.prepare(statement.sql).run(...(statement.params || []));
  }
}

function queryEntry(database, statement) {
  const prepared = database.prepare(statement.sql);
  const params = statement.params || [];
  if (/^\s*(SELECT|PRAGMA|WITH)\b/i.test(statement.sql)) {
    return { success: true, results: prepared.all(...params), meta: { changes: 0 } };
  }
  const result = prepared.run(...params);
  return { success: true, results: [], meta: { changes: Number(result.changes || 0) } };
}

function fakeQueryBatch(database) {
  return async ({ batch }) => {
    database.exec('BEGIN IMMEDIATE');
    try {
      const result = batch.map((statement) => queryEntry(database, statement));
      database.exec('COMMIT');
      return result;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  };
}

function openDatabase() {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  database.exec('PRAGMA foreign_keys = ON');
  applyStatements(
    database,
    tenantDataPlaneCurrentBatch({ tenantId: TENANT_ID, source: source() })
  );
  database.exec(`
    INSERT INTO catalog_categories
      (category_id,name,depth,sort_order,product_count)
    VALUES ('${CATEGORY_ID}','Safe Category',0,0,2);

    INSERT INTO catalog_products
      (product_id,name,search_text,category_id,category_name,description,image_count,
       sort_order,source_name,display_name,source_category_name,display_category_name,
       classification_status,classification_confidence)
    VALUES
      ('${TARGET_ID}','Target','target','${CATEGORY_ID}','Safe Category','target product',0,
       0,'Target','Merchant Target','Safe Category','Safe Category','automatic',0.9),
      ('${CONTROL_ID}','Control','control','${CATEGORY_ID}','Safe Category','control product',0,
       1,'Control','Control','Safe Category','Safe Category','automatic',0.9);

    INSERT INTO catalog_product_categories(product_id,category_id)
    VALUES ('${TARGET_ID}','${CATEGORY_ID}'),('${CONTROL_ID}','${CATEGORY_ID}');

    INSERT INTO catalog_product_classification_overrides
      (product_id,override_json,override_version,created_at,updated_at)
    VALUES ('${TARGET_ID}','{"displayName":"Merchant Target"}',7,
            '2026-08-25T10:00:00Z','2026-08-25T10:00:00Z');

    INSERT INTO supplier_album_index
      (tenant_id,source_key,album_source_id,public_product_id,source_url,source_title,
       source_category_id,source_category_path_json,listing_fingerprint,detail_fingerprint,
       status,miss_count)
    VALUES
      ('${TENANT_ID}','${SOURCE_KEY}','${TARGET_ALBUM}','${TARGET_ID}',
       'https://private-source.x.yupoo.com/albums/target','Target','safe','["safe"]',
       'listing-target','detail-target','active',0),
      ('${TENANT_ID}','${SOURCE_KEY}','${CONTROL_ALBUM}','${CONTROL_ID}',
       'https://private-source.x.yupoo.com/albums/control','Control','safe','["safe"]',
       'listing-control','detail-control','active',0);

    INSERT INTO supplier_scope_memberships
      (tenant_id,source_key,scope_id,scope_kind,album_source_id,public_product_id,
       removal_threshold,state,miss_count)
    VALUES
      ('${TENANT_ID}','${SOURCE_KEY}','${SCOPE_A}','source','${TARGET_ALBUM}','${TARGET_ID}',3,'active',0),
      ('${TENANT_ID}','${SOURCE_KEY}','${SCOPE_A}','source','${CONTROL_ALBUM}','${CONTROL_ID}',3,'active',0);
  `);
  return database;
}

function seedAbsenceRun(
  database,
  { runId, eventType, nextMissCount, baseRevision, scopeId = SCOPE_A } = {}
) {
  database.prepare(`INSERT INTO supplier_sync_runs
    (run_id,tenant_id,source_key,mode,status,complete_scan,scanned_albums,
     missing_count,removed_count,detail_fetch_count,started_at)
    VALUES (?1,?2,?3,'incremental','running',1,1,?4,?5,0,CURRENT_TIMESTAMP)`)
    .run(
      runId,
      TENANT_ID,
      SOURCE_KEY,
      eventType === 'MISSING' ? 1 : 0,
      eventType === 'REMOVED' ? 1 : 0
    );
  database.prepare(`INSERT INTO supplier_sync_stage_runs
    (run_id,tenant_id,source_key,scope_id,scope_kind,contract_version,state,safety_outcome,
     safety_policy_version,scan_complete,previous_known_good_count,observed_count,
     disqualifying_failure_count,expected_event_count,expected_detail_count,
     staged_observation_count,staged_event_count,staged_category_count,
     verification_code,verified_at)
    VALUES (?1,?2,?3,?4,'source',1,'verified','proceed',1,1,2,1,0,1,0,1,1,0,
            'sync_candidate_verified_v1','2026-08-28T07:00:00Z')`)
    .run(runId, TENANT_ID, SOURCE_KEY, scopeId);
  database.prepare(`INSERT INTO supplier_sync_stage_authority
    (run_id,tenant_id,source_key,contract_version,base_authority_revision)
    VALUES (?1,?2,?3,1,?4)`)
    .run(runId, TENANT_ID, SOURCE_KEY, baseRevision);
  database.prepare(`INSERT INTO supplier_sync_stage_removal_policy
    (run_id,tenant_id,source_key,scope_id,scope_kind,contract_version,policy_version,removal_threshold)
    VALUES (?1,?2,?3,?4,'source',1,1,3)`)
    .run(runId, TENANT_ID, SOURCE_KEY, scopeId);
  database.prepare(`INSERT INTO supplier_sync_stage_observations
    (run_id,album_source_id,public_product_id,source_url,source_title,
     source_category_id,source_category_path_json,listing_fingerprint,sort_order)
    VALUES (?1,?2,?3,'https://private-source.x.yupoo.com/albums/control','Control',
            'safe','["safe"]','listing-control',1)`)
    .run(runId, CONTROL_ALBUM, CONTROL_ID);
  database.prepare(`INSERT INTO supplier_sync_stage_events
    (run_id,album_source_id,public_product_id,event_type,needs_detail,next_miss_count,reason_code)
    VALUES (?1,?2,?3,?4,0,?5,'sync_not_observed_authoritative')`)
    .run(runId, TARGET_ALBUM, TARGET_ID, eventType, nextMissCount);
  return context(runId);
}

function seedRestoredRun(database, { runId, baseRevision } = {}) {
  database.prepare(`INSERT INTO supplier_sync_runs
    (run_id,tenant_id,source_key,mode,status,complete_scan,scanned_albums,
     restored_count,detail_fetch_count,started_at)
    VALUES (?1,?2,?3,'incremental','running',1,2,1,1,CURRENT_TIMESTAMP)`)
    .run(runId, TENANT_ID, SOURCE_KEY);
  database.prepare(`INSERT INTO supplier_sync_stage_runs
    (run_id,tenant_id,source_key,scope_id,scope_kind,contract_version,state,safety_outcome,
     safety_policy_version,scan_complete,previous_known_good_count,observed_count,
     disqualifying_failure_count,expected_event_count,expected_detail_count,
     staged_observation_count,staged_event_count,staged_category_count,
     verification_code,verified_at)
    VALUES (?1,?2,?3,?4,'source',1,'verified','proceed',1,1,1,2,0,1,1,2,1,1,
            'sync_candidate_verified_v1','2026-08-28T07:10:00Z')`)
    .run(runId, TENANT_ID, SOURCE_KEY, SCOPE_A);
  database.prepare(`INSERT INTO supplier_sync_stage_authority
    (run_id,tenant_id,source_key,contract_version,base_authority_revision)
    VALUES (?1,?2,?3,1,?4)`)
    .run(runId, TENANT_ID, SOURCE_KEY, baseRevision);
  database.prepare(`INSERT INTO supplier_sync_stage_removal_policy
    (run_id,tenant_id,source_key,scope_id,scope_kind,contract_version,policy_version,removal_threshold)
    VALUES (?1,?2,?3,?4,'source',1,1,3)`)
    .run(runId, TENANT_ID, SOURCE_KEY, SCOPE_A);
  database.prepare(`INSERT INTO supplier_sync_stage_observations
    (run_id,album_source_id,public_product_id,source_url,source_title,
     source_category_id,source_category_path_json,listing_fingerprint,sort_order)
    VALUES
      (?1,?2,?3,'https://private-source.x.yupoo.com/albums/target','Target Restored',
       'safe','["safe"]','listing-restored',0),
      (?1,?4,?5,'https://private-source.x.yupoo.com/albums/control','Control',
       'safe','["safe"]','listing-control',1)`)
    .run(runId, TARGET_ALBUM, TARGET_ID, CONTROL_ALBUM, CONTROL_ID);
  database.prepare(`INSERT INTO supplier_sync_stage_events
    (run_id,album_source_id,public_product_id,event_type,needs_detail,reason_code)
    VALUES (?1,?2,?3,'RESTORED',1,'sync_listing_restored')`)
    .run(runId, TARGET_ALBUM, TARGET_ID);
  database.prepare(`INSERT INTO supplier_sync_stage_categories
    (run_id,category_source_id,name,depth,sort_order)
    VALUES (?1,'safe','Safe Category',0,0)`)
    .run(runId);
  database.prepare(`INSERT INTO supplier_sync_stage_catalog_categories
    (run_id,category_id,name,depth,sort_order,product_count)
    VALUES (?1,?2,'Safe Category',0,0,2)`)
    .run(runId, CATEGORY_ID);
  database.prepare(`INSERT INTO supplier_sync_stage_product_details
    (run_id,album_source_id,public_product_id,detail_state,attempt_count,
     provider_contract_version,evidence_schema_version,detail_fingerprint,
     normalized_evidence_json,name,search_text,category_id,category_name,description,
     image_count,primary_media_id,sort_order,source_name,display_name,
     source_category_name,display_category_name,classification_status,
     classification_confidence,processed_at)
    VALUES (?1,?2,?3,'complete',1,1,1,'detail-restored','{"safe":true}',
            'Target Restored','target restored',?4,'Safe Category','restored safely',
            0,NULL,0,'Target Restored','Target Restored','Safe Category','Safe Category',
            'automatic',0.95,CURRENT_TIMESTAMP)`)
    .run(runId, TARGET_ALBUM, TARGET_ID, CATEGORY_ID);
  database.prepare(`INSERT INTO supplier_sync_stage_product_categories
    (run_id,public_product_id,category_id) VALUES (?1,?2,?3)`)
    .run(runId, TARGET_ID, CATEGORY_ID);
  return context(runId);
}

async function promote(database, ctx) {
  return processTenantIncrementalPromotion(platformEnv(), ctx, {
    queryBatch: fakeQueryBatch(database),
    fetchImpl: async () => {
      throw new Error('network_not_expected');
    }
  });
}

function previousRows(targetState = 'active', missCount = 0) {
  return [
    {
      album_source_id: TARGET_ALBUM,
      public_product_id: TARGET_ID,
      source_category_id: 'safe',
      source_category_path_json: '["safe"]',
      listing_fingerprint: 'listing-target',
      detail_fingerprint: 'detail-target',
      status: 'active',
      miss_count: 0,
      scope_membership_state: targetState,
      scope_miss_count: missCount
    },
    {
      album_source_id: CONTROL_ALBUM,
      public_product_id: CONTROL_ID,
      source_category_id: 'safe',
      source_category_path_json: '["safe"]',
      listing_fingerprint: 'listing-control',
      detail_fingerprint: 'detail-control',
      status: 'active',
      miss_count: 0,
      scope_membership_state: 'active',
      scope_miss_count: 0
    }
  ];
}

function controlObservation() {
  return {
    albumSourceId: CONTROL_ALBUM,
    publicProductId: CONTROL_ID,
    sourceCategoryId: 'safe',
    sourceCategoryPath: ['safe'],
    listingFingerprint: 'listing-control'
  };
}

function targetObservation() {
  return {
    albumSourceId: TARGET_ALBUM,
    publicProductId: TARGET_ID,
    sourceCategoryId: 'safe',
    sourceCategoryPath: ['safe'],
    listingFingerprint: 'listing-restored'
  };
}

afterEach(() => {
  while (databases.length) databases.pop().close();
});

describe('M7D9 repeated miss planning', () => {
  it('progresses only authoritative scoped misses and freezes the removal policy in v8 staging', () => {
    const miss1 = planTenantIncrementalScan({
      previousRows: previousRows('active', 0),
      scan: { complete: true, items: [controlObservation()] },
      scope: scope(),
      removalMissThreshold: 3
    });
    expect(miss1.events.find((event) => event.sourceId === TARGET_ALBUM)).toMatchObject({
      type: 'MISSING',
      missCount: 1
    });
    expect(miss1.removalPolicy).toEqual({
      contractVersion: 1,
      policyVersion: 1,
      removalThreshold: 3,
      scopeId: SCOPE_A,
      scopeKind: 'source'
    });

    const miss2 = planTenantIncrementalScan({
      previousRows: previousRows('missing', 1),
      scan: { complete: true, items: [controlObservation()] },
      scope: scope(),
      removalMissThreshold: 3
    });
    expect(miss2.events.find((event) => event.sourceId === TARGET_ALBUM)).toMatchObject({
      type: 'MISSING',
      missCount: 2
    });

    const removed = planTenantIncrementalScan({
      previousRows: previousRows('missing', 2),
      scan: { complete: true, items: [controlObservation()] },
      scope: scope(),
      removalMissThreshold: 3
    });
    expect(removed.events.find((event) => event.sourceId === TARGET_ALBUM)).toMatchObject({
      type: 'REMOVED',
      missCount: 3
    });

    const partial = planTenantIncrementalScan({
      previousRows: previousRows('missing', 2),
      scan: { complete: false, items: [controlObservation()] },
      scope: scope(),
      removalMissThreshold: 3
    });
    expect(partial.decision.outcome).toBe('preserve_last_known_good');
    expect(partial.events.some((event) => ['MISSING', 'REMOVED'].includes(event.type))).toBe(false);

    const restored = planTenantIncrementalScan({
      previousRows: previousRows('detached', 3),
      scan: { complete: true, items: [targetObservation(), controlObservation()] },
      scope: scope(),
      removalMissThreshold: 3
    });
    expect(restored.events.find((event) => event.sourceId === TARGET_ALBUM)).toMatchObject({
      type: 'RESTORED',
      needsDetail: true
    });

    const stageScan = { complete: true, items: [controlObservation()], taxonomy: [] };
    const v8Stage = buildIncrementalStageWritePlan({
      context: context('imp_aaaaaaaaaaaaaaaaaaaa', 8),
      scan: stageScan,
      plan: miss1
    });
    expect(v8Stage.beginBatch.some((query) => query.sql.includes('supplier_sync_stage_removal_policy'))).toBe(true);
    expect(v8Stage.sealBatch.some((query) => query.sql.includes('sync_removal_policy_snapshot_mismatch'))).toBe(true);

    const v7Stage = buildIncrementalStageWritePlan({
      context: context('imp_bbbbbbbbbbbbbbbbbbbb', 7),
      scan: stageScan,
      plan: miss1
    });
    expect(v7Stage.beginBatch.some((query) => query.sql.includes('supplier_sync_stage_removal_policy'))).toBe(false);
  });
});

describe('M7D9 scoped removal promotion authority', () => {
  it('promotes three repeated misses exactly once, removes only on the last membership and restores merchant truth', async () => {
    const database = openDatabase();

    const first = seedAbsenceRun(database, {
      runId: 'imp_11111111111111111111',
      eventType: 'MISSING',
      nextMissCount: 1,
      baseRevision: 0
    });
    expect(await promote(database, first)).toMatchObject({
      outcome: 'success',
      alreadyComplete: false,
      authorityRevision: 1
    });
    expect(database.prepare(`SELECT state,miss_count FROM supplier_scope_memberships
      WHERE tenant_id=?1 AND source_key=?2 AND scope_id=?3 AND album_source_id=?4`)
      .get(TENANT_ID, SOURCE_KEY, SCOPE_A, TARGET_ALBUM)).toEqual({ state: 'missing', miss_count: 1 });
    expect(database.prepare('SELECT COUNT(*) AS total FROM catalog_products WHERE product_id=?1').get(TARGET_ID).total).toBe(1);

    expect(await promote(database, first)).toMatchObject({
      outcome: 'success',
      alreadyComplete: true,
      authorityRevision: 1
    });
    expect(database.prepare(`SELECT miss_count FROM supplier_scope_memberships
      WHERE tenant_id=?1 AND source_key=?2 AND scope_id=?3 AND album_source_id=?4`)
      .get(TENANT_ID, SOURCE_KEY, SCOPE_A, TARGET_ALBUM).miss_count).toBe(1);

    const second = seedAbsenceRun(database, {
      runId: 'imp_22222222222222222222',
      eventType: 'MISSING',
      nextMissCount: 2,
      baseRevision: 1
    });
    expect(await promote(database, second)).toMatchObject({ outcome: 'success', authorityRevision: 2 });
    expect(database.prepare(`SELECT state,miss_count FROM supplier_scope_memberships
      WHERE tenant_id=?1 AND source_key=?2 AND scope_id=?3 AND album_source_id=?4`)
      .get(TENANT_ID, SOURCE_KEY, SCOPE_A, TARGET_ALBUM)).toEqual({ state: 'missing', miss_count: 2 });

    const third = seedAbsenceRun(database, {
      runId: 'imp_33333333333333333333',
      eventType: 'REMOVED',
      nextMissCount: 3,
      baseRevision: 2
    });
    expect(await promote(database, third)).toMatchObject({ outcome: 'success', authorityRevision: 3 });
    expect(database.prepare(`SELECT state,miss_count FROM supplier_scope_memberships
      WHERE tenant_id=?1 AND source_key=?2 AND scope_id=?3 AND album_source_id=?4`)
      .get(TENANT_ID, SOURCE_KEY, SCOPE_A, TARGET_ALBUM)).toEqual({ state: 'detached', miss_count: 3 });
    expect(database.prepare('SELECT COUNT(*) AS total FROM catalog_products WHERE product_id=?1').get(TARGET_ID).total).toBe(0);
    expect(database.prepare('SELECT status,miss_count FROM supplier_album_index WHERE album_source_id=?1').get(TARGET_ALBUM)).toEqual({
      status: 'deleted',
      miss_count: 3
    });
    expect(database.prepare(`SELECT override_json,override_version FROM catalog_product_classification_override_retention
      WHERE product_id=?1`).get(TARGET_ID)).toEqual({
      override_json: '{"displayName":"Merchant Target"}',
      override_version: 7
    });
    expect(database.prepare('SELECT revision FROM catalog_serving_authority WHERE tenant_id=?1').get(TENANT_ID).revision).toBe(3);

    const restored = seedRestoredRun(database, {
      runId: 'imp_44444444444444444444',
      baseRevision: 3
    });
    expect(await promote(database, restored)).toMatchObject({ outcome: 'success', authorityRevision: 4 });
    expect(database.prepare('SELECT name FROM catalog_products WHERE product_id=?1').get(TARGET_ID)).toEqual({
      name: 'Target Restored'
    });
    expect(database.prepare(`SELECT state,miss_count FROM supplier_scope_memberships
      WHERE tenant_id=?1 AND source_key=?2 AND scope_id=?3 AND album_source_id=?4`)
      .get(TENANT_ID, SOURCE_KEY, SCOPE_A, TARGET_ALBUM)).toEqual({ state: 'active', miss_count: 0 });
    expect(database.prepare('SELECT override_json,override_version FROM catalog_product_classification_overrides WHERE product_id=?1').get(TARGET_ID)).toEqual({
      override_json: '{"displayName":"Merchant Target"}',
      override_version: 7
    });
    expect(database.prepare('SELECT COUNT(*) AS total FROM catalog_product_classification_override_retention WHERE product_id=?1').get(TARGET_ID).total).toBe(0);
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('detaches one scope without deleting a product still owned by another scope', async () => {
    const database = openDatabase();
    database.prepare(`INSERT INTO supplier_scope_memberships
      (tenant_id,source_key,scope_id,scope_kind,album_source_id,public_product_id,
       removal_threshold,state,miss_count)
      VALUES (?1,?2,?3,'category',?4,?5,3,'active',0)`)
      .run(TENANT_ID, SOURCE_KEY, SCOPE_B, TARGET_ALBUM, TARGET_ID);

    const run = seedAbsenceRun(database, {
      runId: 'imp_55555555555555555555',
      eventType: 'REMOVED',
      nextMissCount: 3,
      baseRevision: 0,
      scopeId: SCOPE_A
    });
    expect(await promote(database, run)).toMatchObject({ outcome: 'success', authorityRevision: 1 });
    expect(database.prepare('SELECT COUNT(*) AS total FROM catalog_products WHERE product_id=?1').get(TARGET_ID).total).toBe(1);
    expect(database.prepare('SELECT COUNT(*) AS total FROM catalog_product_classification_overrides WHERE product_id=?1').get(TARGET_ID).total).toBe(1);
    expect(database.prepare('SELECT COUNT(*) AS total FROM catalog_product_classification_override_retention WHERE product_id=?1').get(TARGET_ID).total).toBe(0);
    expect(database.prepare('SELECT status FROM supplier_album_index WHERE album_source_id=?1').get(TARGET_ALBUM).status).toBe('active');
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});
