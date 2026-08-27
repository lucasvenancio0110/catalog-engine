import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { tenantDataPlaneCurrentBatch } from '../worker/tenant-data-plane-schema-v7.js';
import {
  TENANT_INCREMENTAL_PROMOTION_MAX_BOUND_PARAMS,
  TENANT_INCREMENTAL_PROMOTION_MAX_MEDIA_RELATIONSHIPS,
  TENANT_INCREMENTAL_PROMOTION_MAX_PRODUCTS,
  TENANT_INCREMENTAL_PROMOTION_MAX_SQL_BYTES,
  TENANT_INCREMENTAL_PROMOTION_MAX_STATEMENTS,
  assessIncrementalPromotionAdmission,
  buildIncrementalPromotionPreflightBatch,
  buildIncrementalPromotionTransaction,
  parseIncrementalPromotionPreflight,
  processTenantIncrementalPromotion,
  validatePromotionTransactionShape
} from '../worker/ingestion/incremental-promotion.js';

const TENANT_ID = 't_0123456789abcdefabcd';
const SOURCE_KEY = 'primary';
const PRODUCT_ID = 'p_0123456789abcdefabcd';
const CATEGORY_ID = 'c_0123456789abcdefabcd';
const MEDIA_ID = 'm_0123456789abcdefabcd';
const ALBUM_ID = 'alb_fixture';
const DATABASE_ID = '0123456789abcdef0123456789abcdef';
const OVERRIDE_UPDATED_AT = '2026-08-25T10:00:00Z';
const databases = [];

afterEach(() => {
  while (databases.length) databases.pop().close();
});

function source() {
  return {
    provider: 'yupoo',
    sourceKey: SOURCE_KEY,
    sourceUrl: 'https://private-supplier.x.yupoo.com/albums/',
    syncStrategy: 'incremental',
    removalMissThreshold: 3
  };
}

function context(runId) {
  return {
    importId: runId,
    tenantId: TENANT_ID,
    sourceKey: SOURCE_KEY,
    mode: 'incremental',
    schemaVersion: 7,
    dataPlane: {
      databaseId: DATABASE_ID,
      dispatchNamespace: 'catalog-engine-production'
    }
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
    return { success: true, results: prepared.all(...params) };
  }
  const result = prepared.run(...params);
  return { success: true, results: [], meta: { changes: Number(result.changes || 0) } };
}

function executeBatch(database, batch, { failAt = -1 } = {}) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const results = [];
    for (let index = 0; index < batch.length; index += 1) {
      if (index === failAt) throw new Error('forced_mid_batch_failure');
      results.push(queryEntry(database, batch[index]));
    }
    database.exec('COMMIT');
    return results;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function fakeQueryBatch(database) {
  return async ({ batch }) => executeBatch(database, batch);
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
    VALUES ('${CATEGORY_ID}','Old Category',0,0,1);
    INSERT INTO media_sources
      (media_id,provider,source_url,active)
    VALUES ('${MEDIA_ID}','yupoo','https://photo.yupoo.com/private-old.jpg',1);
    INSERT INTO catalog_products
      (product_id,name,search_text,category_id,category_name,description,image_count,
       primary_media_id,sort_order,source_name,display_name,source_category_name,
       display_category_name,classification_status,classification_confidence)
    VALUES ('${PRODUCT_ID}','Old LKG','old lkg','${CATEGORY_ID}','Old Category','old',1,
            '${MEDIA_ID}',0,'Old Source','Merchant LKG','Old Source Category',
            'Old Category','automatic',0.7);
    INSERT INTO product_media(product_id,media_id,position)
    VALUES ('${PRODUCT_ID}','${MEDIA_ID}',0);
    INSERT INTO catalog_product_categories(product_id,category_id)
    VALUES ('${PRODUCT_ID}','${CATEGORY_ID}');
    INSERT INTO catalog_product_classification_state
      (product_id,classifier_version,classifier_key,override_applied)
    VALUES ('${PRODUCT_ID}',3,'professional-v3',1);
    INSERT INTO catalog_product_classification_overrides
      (product_id,override_json,override_version,created_at,updated_at)
    VALUES ('${PRODUCT_ID}','{"displayName":"Merchant LKG"}',7,'${OVERRIDE_UPDATED_AT}','${OVERRIDE_UPDATED_AT}');
    INSERT INTO catalog_product_intelligence_state
      (product_id,contract_version,evidence_schema_version,classifier_version,classifier_key,
       knowledge_pack_key,knowledge_pack_version,domain_id,domain_confidence,
       domain_knowledge_state,knowledge_state,override_applied,review_required,research_required,
       conflict_count,state_json)
    VALUES ('${PRODUCT_ID}',1,1,3,'professional-v3','sports-v1',1,'sports',0.7,
            'KNOWN','KNOWN',1,0,0,0,'{"version":"old"}');
    INSERT INTO supplier_album_index
      (tenant_id,source_key,album_source_id,public_product_id,source_url,source_title,
       source_category_id,source_category_path_json,listing_fingerprint,detail_fingerprint,status,miss_count)
    VALUES ('${TENANT_ID}','${SOURCE_KEY}','${ALBUM_ID}','${PRODUCT_ID}',
            'https://private-supplier.x.yupoo.com/albums/old','Old Album','src_old','["src_old"]',
            'listing-old','detail-old','active',0);
  `);
  return database;
}

function seedVerifiedCandidate(database, {
  runId = 'imp_11111111111111111111',
  state = 'verified',
  eventType = 'CHANGED',
  baseRevision = 0,
  candidateName = 'New Verified Product',
  displayName = 'Merchant LKG',
  overrideVersion = 7,
  overrideUpdatedAt = OVERRIDE_UPDATED_AT,
  publicDescription = 'public safe description'
} = {}) {
  const needsDetail = ['NEW', 'CHANGED', 'CHANGED_MOVED', 'RESTORED'].includes(eventType) ? 1 : 0;
  const expectedDetail = needsDetail;
  database.prepare(`INSERT INTO supplier_sync_runs
    (run_id,tenant_id,source_key,mode,status,complete_scan,scanned_albums,
     changed_count,moved_count,restored_count,detail_fetch_count)
    VALUES (?1,?2,?3,'incremental','running',1,1,
            ?4,?5,?6,?7)`).run(
    runId,
    TENANT_ID,
    SOURCE_KEY,
    ['CHANGED','CHANGED_MOVED'].includes(eventType) ? 1 : 0,
    ['MOVED','CHANGED_MOVED'].includes(eventType) ? 1 : 0,
    eventType === 'RESTORED' ? 1 : 0,
    expectedDetail
  );
  database.prepare(`INSERT INTO supplier_sync_stage_runs
    (run_id,tenant_id,source_key,scope_id,scope_kind,contract_version,state,safety_outcome,
     safety_policy_version,scan_complete,previous_known_good_count,observed_count,
     disqualifying_failure_count,expected_event_count,expected_detail_count,
     staged_observation_count,staged_event_count,staged_category_count,
     verification_code,verified_at)
    VALUES (?1,?2,?3,'catalog','catalog',1,?4,'proceed',1,1,1,1,0,1,?5,1,1,1,
            CASE WHEN ?4='verified' THEN 'sync_candidate_verified_v1' ELSE NULL END,
            CASE WHEN ?4='verified' THEN '2026-08-25T12:00:00Z' ELSE NULL END)`).run(
    runId,
    TENANT_ID,
    SOURCE_KEY,
    state,
    expectedDetail
  );
  database.prepare(`INSERT INTO supplier_sync_stage_authority
    (run_id,tenant_id,source_key,contract_version,base_authority_revision)
    VALUES (?1,?2,?3,1,?4)`).run(runId, TENANT_ID, SOURCE_KEY, baseRevision);
  database.prepare(`INSERT INTO supplier_sync_stage_observations
    (run_id,album_source_id,public_product_id,source_url,source_title,source_category_id,
     source_category_path_json,cover_source_url,image_count_hint,listing_fingerprint,sort_order)
    VALUES (?1,?2,?3,'https://private-supplier.x.yupoo.com/albums/new','New Album','src_new',
            '["src_new"]','https://photo.yupoo.com/private-cover.jpg',1,'listing-new',0)`).run(
    runId,
    ALBUM_ID,
    PRODUCT_ID
  );
  database.prepare(`INSERT INTO supplier_sync_stage_events
    (run_id,album_source_id,public_product_id,event_type,needs_detail,reason_code)
    VALUES (?1,?2,?3,?4,?5,'sync_listing_changed')`).run(
    runId,
    ALBUM_ID,
    PRODUCT_ID,
    eventType,
    needsDetail
  );
  database.prepare(`INSERT INTO supplier_sync_stage_categories
    (run_id,category_source_id,name,depth,sort_order)
    VALUES (?1,'src_new','Supplier Source Category',0,0)`).run(runId);

  if (needsDetail) {
    database.prepare(`INSERT INTO supplier_sync_stage_catalog_categories
      (run_id,category_id,name,depth,sort_order,product_count)
      VALUES (?1,?2,'Public Category',0,0,1)`).run(runId, CATEGORY_ID);
    database.prepare(`INSERT INTO supplier_sync_stage_media_sources
      (run_id,media_id,provider,source_url,display_source_url,thumbnail_source_url,referer_url,active)
      VALUES (?1,?2,'yupoo','https://photo.yupoo.com/private-new.jpg',NULL,NULL,
              'https://private-supplier.x.yupoo.com/albums/new',1)`).run(runId, MEDIA_ID);
    database.prepare(`INSERT INTO supplier_sync_stage_product_details
      (run_id,album_source_id,public_product_id,detail_state,provider_contract_version,
       evidence_schema_version,detail_fingerprint,normalized_evidence_json,name,search_text,
       category_id,category_name,description,image_count,primary_media_id,sort_order,source_name,
       display_name,source_category_name,display_category_name,classification_status,
       classification_confidence,processed_at)
      VALUES (?1,?2,?3,'complete',1,1,'detail-new','{"privateEvidence":"retained"}',
              ?4,'new verified product',?5,'Public Category',?6,1,?7,0,'Supplier Label',
              ?8,'Supplier Category','Public Category','automatic',0.95,CURRENT_TIMESTAMP)`).run(
      runId,
      ALBUM_ID,
      PRODUCT_ID,
      candidateName,
      CATEGORY_ID,
      publicDescription,
      MEDIA_ID,
      displayName
    );
    database.prepare(`INSERT INTO supplier_sync_stage_product_media
      (run_id,public_product_id,media_id,position)
      VALUES (?1,?2,?3,0)`).run(runId, PRODUCT_ID, MEDIA_ID);
    database.prepare(`INSERT INTO supplier_sync_stage_product_categories
      (run_id,public_product_id,category_id)
      VALUES (?1,?2,?3)`).run(runId, PRODUCT_ID, CATEGORY_ID);
    database.prepare(`INSERT INTO supplier_sync_stage_classification_state
      (run_id,public_product_id,classifier_version,classifier_key,override_applied,
       merchant_override_version,merchant_override_updated_at)
      VALUES (?1,?2,3,'professional-v3',1,?3,?4)`).run(
      runId,
      PRODUCT_ID,
      overrideVersion,
      overrideUpdatedAt
    );
    database.prepare(`INSERT INTO supplier_sync_stage_intelligence_state
      (run_id,public_product_id,contract_version,evidence_schema_version,classifier_version,
       classifier_key,knowledge_pack_key,knowledge_pack_version,domain_id,domain_confidence,
       domain_knowledge_state,knowledge_state,override_applied,review_required,research_required,
       conflict_count,state_json)
      VALUES (?1,?2,1,1,3,'professional-v3','sports-v1',1,'sports',0.95,
              'KNOWN','KNOWN',1,0,0,0,'{"version":"new","automatic":{"claims":{}},"effective":{"claims":{}}}')`).run(
      runId,
      PRODUCT_ID
    );
    database.prepare(`INSERT INTO supplier_sync_stage_catalog_meta(run_id,key,value_json)
      VALUES (?1,'navigation','[{"id":"new"}]'),
             (?1,'merchandising','{"projection":"candidate-composed-v1"}')`).run(runId);
  } else {
    database.prepare(`INSERT INTO supplier_sync_stage_catalog_meta(run_id,key,value_json)
      VALUES (?1,'navigation','[{"id":"moved"}]'),
             (?1,'merchandising','{"projection":"candidate-composed-v1"}')`).run(runId);
  }
  return context(runId);
}

function platformEnv() {
  return {
    CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE: 'catalog-engine-production',
    CLOUDFLARE_PLATFORM_ACCOUNT_ID: 'a'.repeat(32),
    CLOUDFLARE_PLATFORM_API_TOKEN: 'token-token-token-token-token'
  };
}

describe('M7D7 incremental promotion authority primitive', () => {
  it('promotes an exact verified affected candidate in one transaction and preserves merchant override truth', async () => {
    const database = openDatabase();
    const ctx = seedVerifiedCandidate(database);
    const result = await processTenantIncrementalPromotion(platformEnv(), ctx, {
      queryBatch: fakeQueryBatch(database),
      fetchImpl: async () => {
        throw new Error('network_not_expected');
      }
    });

    expect(result).toMatchObject({ outcome: 'success', alreadyComplete: false, stageState: 'promoted', authorityRevision: 1 });
    expect(database.prepare('SELECT name,display_name,description FROM catalog_products WHERE product_id=?1').get(PRODUCT_ID)).toEqual({
      name: 'New Verified Product',
      display_name: 'Merchant LKG',
      description: 'public safe description'
    });
    expect(database.prepare('SELECT override_json,override_version FROM catalog_product_classification_overrides WHERE product_id=?1').get(PRODUCT_ID)).toEqual({
      override_json: '{"displayName":"Merchant LKG"}',
      override_version: 7
    });
    expect(database.prepare('SELECT revision,last_promoted_run_id,last_promoted_source_key FROM catalog_serving_authority WHERE tenant_id=?1').get(TENANT_ID)).toEqual({
      revision: 1,
      last_promoted_run_id: ctx.importId,
      last_promoted_source_key: SOURCE_KEY
    });
    expect(database.prepare('SELECT state FROM supplier_sync_stage_runs WHERE run_id=?1').get(ctx.importId).state).toBe('promoted');
    expect(database.prepare('SELECT status FROM supplier_sync_runs WHERE run_id=?1').get(ctx.importId).status).toBe('success');
  });

  it('treats replay after a committed authority switch as idempotent success', async () => {
    const database = openDatabase();
    const ctx = seedVerifiedCandidate(database);
    const queryBatch = fakeQueryBatch(database);
    const first = await processTenantIncrementalPromotion(platformEnv(), ctx, { queryBatch });
    const second = await processTenantIncrementalPromotion(platformEnv(), ctx, { queryBatch });

    expect(first.outcome).toBe('success');
    expect(second).toMatchObject({ outcome: 'success', alreadyComplete: true, authorityRevision: 1 });
    expect(database.prepare('SELECT revision FROM catalog_serving_authority WHERE tenant_id=?1').get(TENANT_ID).revision).toBe(1);
  });

  it('rejects stale and competing verified candidates so exactly one old-base candidate can win', async () => {
    const database = openDatabase();
    const firstContext = seedVerifiedCandidate(database, { runId: 'imp_11111111111111111111', candidateName: 'Winner' });
    const secondContext = seedVerifiedCandidate(database, { runId: 'imp_22222222222222222222', candidateName: 'Loser' });
    const queryBatch = fakeQueryBatch(database);

    expect((await processTenantIncrementalPromotion(platformEnv(), firstContext, { queryBatch })).outcome).toBe('success');
    expect(await processTenantIncrementalPromotion(platformEnv(), secondContext, { queryBatch })).toEqual({
      outcome: 'failed',
      error: 'sync_promotion_stale_base'
    });
    expect(database.prepare('SELECT name FROM catalog_products WHERE product_id=?1').get(PRODUCT_ID).name).toBe('Winner');
    expect(database.prepare('SELECT state FROM supplier_sync_stage_runs WHERE run_id=?1').get(secondContext.importId).state).toBe('verified');
  });

  it('rejects unverified work, removal activation, stale merchant overrides and public projection leaks before canonical mutation', async () => {
    for (const scenario of [
      { options: { state: 'details_complete' }, code: 'sync_promotion_not_verified' },
      { options: { eventType: 'REMOVED' }, code: 'sync_promotion_removal_not_ready' },
      { options: { overrideVersion: 6 }, code: 'sync_promotion_merchant_override_stale' },
      { options: { publicDescription: 'https://private-supplier.x.yupoo.com/leak' }, code: 'sync_promotion_public_projection_leak' }
    ]) {
      const database = openDatabase();
      const ctx = seedVerifiedCandidate(database, scenario.options);
      const before = database.prepare('SELECT name FROM catalog_products WHERE product_id=?1').get(PRODUCT_ID).name;
      expect(await processTenantIncrementalPromotion(platformEnv(), ctx, { queryBatch: fakeQueryBatch(database) })).toEqual({
        outcome: 'failed',
        error: scenario.code
      });
      expect(database.prepare('SELECT name FROM catalog_products WHERE product_id=?1').get(PRODUCT_ID).name).toBe(before);
      expect(database.prepare('SELECT revision FROM catalog_serving_authority WHERE tenant_id=?1').get(TENANT_ID).revision).toBe(0);
      database.close();
      databases.splice(databases.indexOf(database), 1);
    }
  });

  it('rolls back every canonical and authority mutation when a middle statement fails', () => {
    const database = openDatabase();
    const ctx = seedVerifiedCandidate(database);
    const batch = buildIncrementalPromotionTransaction({ context: ctx });
    const productWriteIndex = batch.findIndex((statement) => statement.sql.includes('INSERT INTO catalog_products'));
    expect(productWriteIndex).toBeGreaterThan(0);
    expect(() => executeBatch(database, batch, { failAt: productWriteIndex + 1 })).toThrow('forced_mid_batch_failure');
    expect(database.prepare('SELECT name FROM catalog_products WHERE product_id=?1').get(PRODUCT_ID).name).toBe('Old LKG');
    expect(database.prepare('SELECT state FROM supplier_sync_stage_runs WHERE run_id=?1').get(ctx.importId).state).toBe('verified');
    expect(database.prepare('SELECT revision FROM catalog_serving_authority WHERE tenant_id=?1').get(TENANT_ID).revision).toBe(0);
  });

  it('keeps MOVED-only inside the authority switch without refetching or rewriting canonical product detail', async () => {
    const database = openDatabase();
    const ctx = seedVerifiedCandidate(database, { eventType: 'MOVED' });
    const result = await processTenantIncrementalPromotion(platformEnv(), ctx, { queryBatch: fakeQueryBatch(database) });
    expect(result.outcome).toBe('success');
    expect(database.prepare('SELECT name FROM catalog_products WHERE product_id=?1').get(PRODUCT_ID).name).toBe('Old LKG');
    expect(database.prepare('SELECT source_category_id FROM supplier_album_index WHERE tenant_id=?1 AND source_key=?2 AND album_source_id=?3').get(TENANT_ID, SOURCE_KEY, ALBUM_ID).source_category_id).toBe('src_new');
    expect(database.prepare('SELECT revision FROM catalog_serving_authority WHERE tenant_id=?1').get(TENANT_ID).revision).toBe(1);
  });

  it('enforces the measured v1 envelope and repository D1 statement limits', () => {
    const ctx = context('imp_33333333333333333333');
    const baseRun = {
      state: 'verified',
      safety_outcome: 'proceed',
      verification_code: 'sync_candidate_verified_v1',
      verified_at: '2026-08-25T12:00:00Z',
      last_error_code: null,
      base_authority_revision: 4,
      current_authority_revision: 4,
      last_promoted_run_id: null,
      last_promoted_source_key: null
    };
    expect(assessIncrementalPromotionAdmission({ run: baseRun, composedProducts: TENANT_INCREMENTAL_PROMOTION_MAX_PRODUCTS + 1, composedMediaRelationships: 0, absenceEvents: 0, overrideMismatches: 0, publicLeakFindings: 0 }, ctx).code).toBe('sync_promotion_envelope_exceeded');
    expect(assessIncrementalPromotionAdmission({ run: baseRun, composedProducts: 1, composedMediaRelationships: TENANT_INCREMENTAL_PROMOTION_MAX_MEDIA_RELATIONSHIPS + 1, absenceEvents: 0, overrideMismatches: 0, publicLeakFindings: 0 }, ctx).code).toBe('sync_promotion_envelope_exceeded');

    const batch = buildIncrementalPromotionTransaction({ context: ctx });
    expect(batch.length).toBeLessThanOrEqual(TENANT_INCREMENTAL_PROMOTION_MAX_STATEMENTS);
    for (const statement of batch) {
      expect(new TextEncoder().encode(statement.sql).byteLength).toBeLessThanOrEqual(TENANT_INCREMENTAL_PROMOTION_MAX_SQL_BYTES);
      expect(new Set(statement.sql.match(/\?\d+/g) || []).size).toBeLessThanOrEqual(TENANT_INCREMENTAL_PROMOTION_MAX_BOUND_PARAMS);
    }
    expect(validatePromotionTransactionShape(batch)).toBe(true);
    expect(TENANT_INCREMENTAL_PROMOTION_MAX_PRODUCTS).toBe(20_000);
    expect(TENANT_INCREMENTAL_PROMOTION_MAX_MEDIA_RELATIONSHIPS).toBe(40_000);
  });

  it('keeps preflight read-only and tenant/source/run scoped', () => {
    const ctx = context('imp_44444444444444444444');
    const batch = buildIncrementalPromotionPreflightBatch({ context: ctx });
    expect(batch.length).toBe(6);
    expect(batch.every((statement) => /^\s*SELECT\b/i.test(statement.sql))).toBe(true);
    expect(batch[0].sql).toContain('r.run_id=?1 AND r.tenant_id=?2 AND r.source_key=?3');
    const parsed = parseIncrementalPromotionPreflight([
      { results: [{ state: 'verified' }] },
      { results: [{ total: '12' }] },
      { results: [{ total: '24' }] },
      { results: [{ total: '0' }] },
      { results: [{ total: '0' }] },
      { results: [{ total: '0' }] }
    ]);
    expect(parsed.composedProducts).toBe(12);
    expect(parsed.composedMediaRelationships).toBe(24);
  });
});
