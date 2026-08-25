import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  processTenantIncrementalClassification
} from '../worker/ingestion/incremental-classification-runner.js';
import {
  processTenantIncrementalVerification
} from '../worker/ingestion/incremental-verification-runner.js';
import { tenantDataPlaneCurrentBatch } from '../worker/tenant-data-plane-schema-v6.js';

const databases = [];
const tenantId = 't_0123456789abcdefabcd';
const importId = 'imp_0123456789abcdefabcd';
const productId = 'p_0123456789abcdefabcd';
const categoryId = 'c_aaaaaaaaaaaaaaaaaaaa';
const mediaId = 'm_bbbbbbbbbbbbbbbbbbbb';
const albumSourceId = '100';
const sourceKey = 'primary';
const sourceUrl = 'https://supplier.x.yupoo.com/categories/10?isSubCate=true';

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

function queryBatchFor(instance) {
  return async (request) => request.batch.map((query) => {
    const statement = instance.prepare(query.sql);
    const params = (query.params || []).map((value) =>
      value === null || value === undefined ? null : String(value)
    );
    if (/^\s*(?:SELECT|PRAGMA)\b/i.test(query.sql)) {
      return { results: statement.all(...params), success: true, meta: { changes: 0 } };
    }
    const result = statement.run(...params);
    return { results: [], success: true, meta: { changes: Number(result.changes || 0) } };
  });
}

function context({ expected = 1, phase = 'details' } = {}) {
  return {
    importId,
    tenantId,
    sourceKey,
    mode: 'incremental',
    importStatus: phase === 'finalize' ? 'finalizing' : 'details',
    phase,
    schemaVersion: 6,
    discoveredCount: expected,
    detailEnqueueCursor: expected,
    privateSource: {
      provider: 'yupoo',
      url: sourceUrl,
      syncStrategy: 'incremental',
      removalMissThreshold: 3
    },
    dataPlane: {
      databaseId: '12ac414c-4aef-4668-a8f9-dc63d57d449f',
      dispatchNamespace: 'catalog-engine-production'
    }
  };
}

function env() {
  return {
    TENANT_DISPATCH: { get() {} },
    CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE: 'catalog-engine-production'
  };
}

function installSchema(instance) {
  applyBatch(
    instance,
    tenantDataPlaneCurrentBatch({
      tenantId,
      source: {
        provider: 'yupoo',
        sourceKey,
        sourceUrl,
        syncStrategy: 'incremental',
        removalMissThreshold: 3
      }
    })
  );
}

function seedCanonical(instance) {
  instance
    .prepare(
      `INSERT INTO supplier_album_index
        (tenant_id,source_key,album_source_id,public_product_id,source_url,source_title,
         source_category_id,source_category_path_json,listing_fingerprint,detail_fingerprint,
         status,miss_count,first_seen_at,last_seen_at,last_changed_at,updated_at)
       VALUES (?1,?2,?3,?4,?5,'Old Arsenal','10','["1","10"]','listing-old','detail-old',
               'active',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
    )
    .run(tenantId, sourceKey, albumSourceId, productId, `${sourceUrl}/albums/${albumSourceId}`);
  instance
    .prepare(
      `INSERT INTO catalog_products
        (product_id,name,search_text,category_id,category_name,description,
         source_name,display_name,source_category_name,display_category_name,
         classification_status,classification_confidence)
       VALUES (?1,'Last Known Good','last known good','legacy','Legacy','healthy',
               'Last Known Good','Last Known Good','Legacy','Legacy','automatic',0.99)`
    )
    .run(productId);
  instance
    .prepare(
      `INSERT INTO catalog_product_classification_overrides
        (product_id,override_json,override_version,updated_at)
       VALUES (?1,?2,7,'2026-08-25 10:00:00')`
    )
    .run(productId, JSON.stringify({ displayName: 'Merchant Arsenal' }));
}

function seedSourceStage(instance, { state = 'details_complete', expectedDetail = 1, eventType = 'CHANGED' } = {}) {
  instance
    .prepare(
      `INSERT INTO supplier_sync_stage_runs
        (run_id,tenant_id,source_key,scope_id,scope_kind,state,safety_outcome,
         safety_policy_version,scan_complete,previous_known_good_count,observed_count,
         disqualifying_failure_count,expected_event_count,expected_detail_count,
         staged_observation_count,staged_event_count,staged_category_count)
       VALUES (?1,?2,?3,'catalog','catalog',?4,'proceed',1,1,1,1,0,1,?5,1,1,2)`
    )
    .run(importId, tenantId, sourceKey, state, expectedDetail);
  instance
    .prepare(
      `INSERT INTO supplier_sync_runs
        (run_id,tenant_id,source_key,mode,status,complete_scan,scanned_albums,
         new_count,changed_count,moved_count,restored_count,missing_count,removed_count,
         detail_fetch_count,started_at)
       VALUES (?1,?2,?3,'incremental','running',1,1,0,1,0,0,0,0,?4,CURRENT_TIMESTAMP)`
    )
    .run(importId, tenantId, sourceKey, expectedDetail);
  instance
    .prepare(
      `INSERT INTO supplier_sync_stage_categories
        (run_id,category_source_id,name,parent_source_id,depth,sort_order)
       VALUES (?1,'1','Premier League',NULL,0,0),
              (?1,'10','Arsenal','1',1,1)`
    )
    .run(importId);
  instance
    .prepare(
      `INSERT INTO supplier_sync_stage_observations
        (run_id,album_source_id,public_product_id,source_url,source_title,
         source_category_id,source_category_path_json,listing_fingerprint)
       VALUES (?1,?2,?3,?4,'Arsenal Player Version','10','["1","10"]','listing-v2')`
    )
    .run(importId, albumSourceId, productId, `${sourceUrl}/albums/${albumSourceId}`);
  instance
    .prepare(
      `INSERT INTO supplier_sync_stage_events
        (run_id,album_source_id,public_product_id,event_type,needs_detail,reason_code)
       VALUES (?1,?2,?3,?4,?5,?6)`
    )
    .run(
      importId,
      albumSourceId,
      productId,
      eventType,
      expectedDetail > 0 ? 1 : 0,
      expectedDetail > 0 ? 'sync_listing_changed' : 'sync_source_placement_changed'
    );
}

function seedCandidateDetail(instance) {
  instance
    .prepare(
      `INSERT INTO supplier_sync_stage_catalog_categories
        (run_id,category_id,name,depth,sort_order,product_count)
       VALUES (?1,?2,'Arsenal',0,0,1)`
    )
    .run(importId, categoryId);
  instance
    .prepare(
      `INSERT INTO supplier_sync_stage_media_sources
        (run_id,media_id,provider,source_url,display_source_url,thumbnail_source_url,referer_url,active)
       VALUES (?1,?2,'yupoo',?3,?3,?3,?4,1)`
    )
    .run(
      importId,
      mediaId,
      'https://photo.yupoo.com/supplier/example.jpg',
      `${sourceUrl}/albums/${albumSourceId}`
    );
  instance
    .prepare(
      `INSERT INTO supplier_sync_stage_product_details
        (run_id,album_source_id,public_product_id,detail_state,attempt_count,
         provider_contract_version,evidence_schema_version,detail_fingerprint,
         normalized_evidence_json,name,search_text,category_id,category_name,
         description,image_count,primary_media_id,sort_order,source_name,display_name,
         source_category_name,display_category_name,processed_at)
       VALUES (?1,?2,?3,'complete',1,1,1,'detail-v2',?4,
               'Arsenal 25/26 Player Version Jersey','arsenal jersey',?5,'Arsenal',
               'Official style football jersey',1,?6,0,'Arsenal 25/26 Player Version Jersey',
               'Arsenal 25/26 Player Version Jersey','Arsenal','Arsenal',CURRENT_TIMESTAMP)`
    )
    .run(
      importId,
      albumSourceId,
      productId,
      JSON.stringify({ name: 'Arsenal 25/26 Player Version Jersey', detailFingerprint: 'detail-v2' }),
      categoryId,
      mediaId
    );
  instance
    .prepare(
      `INSERT INTO supplier_sync_stage_product_categories
        (run_id,public_product_id,category_id) VALUES (?1,?2,?3)`
    )
    .run(importId, productId, categoryId);
  instance
    .prepare(
      `INSERT INTO supplier_sync_stage_product_media
        (run_id,public_product_id,media_id,position) VALUES (?1,?2,?3,0)`
    )
    .run(importId, productId, mediaId);
}

function seedAffectedCandidate(instance) {
  installSchema(instance);
  seedCanonical(instance);
  seedSourceStage(instance);
  seedCandidateDetail(instance);
}

function canonicalSnapshot(instance) {
  return {
    product: instance
      .prepare(
        `SELECT product_id,name,search_text,category_id,category_name,description,
                source_name,display_name,source_category_name,display_category_name,
                team_id,league_id,classification_status,classification_confidence
           FROM catalog_products WHERE product_id=?1`
      )
      .get(productId),
    source: instance
      .prepare(
        `SELECT public_product_id,listing_fingerprint,detail_fingerprint,status,miss_count
           FROM supplier_album_index
          WHERE tenant_id=?1 AND source_key=?2 AND album_source_id=?3`
      )
      .get(tenantId, sourceKey, albumSourceId),
    override: instance
      .prepare(
        `SELECT override_json,override_version,updated_at
           FROM catalog_product_classification_overrides WHERE product_id=?1`
      )
      .get(productId),
    intelligence: instance.prepare('SELECT COUNT(*) AS total FROM catalog_product_intelligence_state').get().total
  };
}

afterEach(() => {
  while (databases.length) databases.pop().close();
});

describe('M7D6 complete private candidate verification', () => {
  it('verifies the composed LKG + affected candidate view without changing canonical authority', async () => {
    const instance = database();
    seedAffectedCandidate(instance);
    const queryBatch = queryBatchFor(instance);
    const before = canonicalSnapshot(instance);

    const classified = await processTenantIncrementalClassification(env(), context(), { queryBatch });
    expect(classified.outcome).toBe('success');

    const first = await processTenantIncrementalVerification(env(), context(), { queryBatch });
    expect(first).toMatchObject({
      outcome: 'success',
      verificationCode: 'sync_candidate_verified_v1',
      stageState: 'verified',
      expected: 1,
      proposedProducts: 1
    });
    expect(first.merchandising).toMatchObject({
      knowledgePackKey: 'sports-v1',
      knowledgePackVersion: 1,
      merchandisingContractVersion: 1
    });
    expect(first.merchandising.navigationItems).toBeGreaterThan(0);

    expect(
      instance
        .prepare('SELECT state,verification_code,verified_at,last_error_code FROM supplier_sync_stage_runs WHERE run_id=?1')
        .get(importId)
    ).toMatchObject({
      state: 'verified',
      verification_code: 'sync_candidate_verified_v1',
      last_error_code: null
    });
    expect(
      instance
        .prepare(
          `SELECT COUNT(*) AS total FROM supplier_sync_stage_catalog_meta
            WHERE run_id=?1 AND key IN ('navigation','merchandising')`
        )
        .get(importId).total
    ).toBe(2);
    expect(canonicalSnapshot(instance)).toEqual(before);
    expect(instance.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

    const second = await processTenantIncrementalVerification(env(), context({ phase: 'finalize' }), {
      queryBatch
    });
    expect(second).toEqual({
      outcome: 'success',
      alreadyComplete: true,
      verificationCode: 'sync_candidate_verified_v1'
    });
    expect(canonicalSnapshot(instance)).toEqual(before);
  });

  it('fails closed when merchant override provenance changes after candidate classification', async () => {
    const instance = database();
    seedAffectedCandidate(instance);
    const queryBatch = queryBatchFor(instance);
    expect((await processTenantIncrementalClassification(env(), context(), { queryBatch })).outcome).toBe('success');

    instance
      .prepare(
        `UPDATE catalog_product_classification_overrides
            SET override_version=8,updated_at='2026-08-25 11:00:00'
          WHERE product_id=?1`
      )
      .run(productId);
    const canonicalProductBefore = canonicalSnapshot(instance).product;

    const result = await processTenantIncrementalVerification(env(), context(), { queryBatch });
    expect(result.outcome).toBe('failed');
    expect(result.findings).toContain('merchant_override_provenance_stale');
    expect(instance.prepare('SELECT state FROM supplier_sync_stage_runs WHERE run_id=?1').get(importId)).toEqual({
      state: 'failed'
    });
    expect(canonicalSnapshot(instance).product).toEqual(canonicalProductBefore);
  });

  it('blocks supplier/private text that would leak through the candidate public projection', async () => {
    const instance = database();
    seedAffectedCandidate(instance);
    const queryBatch = queryBatchFor(instance);
    expect((await processTenantIncrementalClassification(env(), context(), { queryBatch })).outcome).toBe('success');
    instance
      .prepare(
        `UPDATE supplier_sync_stage_product_details
            SET display_name='https://supplier.x.yupoo.com/albums/100'
          WHERE run_id=?1 AND public_product_id=?2`
      )
      .run(importId, productId);

    const result = await processTenantIncrementalVerification(env(), context(), { queryBatch });
    expect(result.outcome).toBe('failed');
    expect(result.findings).toContain('candidate_public_source_leak');
    expect(instance.prepare('SELECT state FROM supplier_sync_stage_runs WHERE run_id=?1').get(importId)).toEqual({
      state: 'failed'
    });
  });

  it('uses the same complete gate for a MOVED-only run with no detail/CEI work', async () => {
    const instance = database();
    installSchema(instance);
    seedCanonical(instance);
    seedSourceStage(instance, { state: 'planned', expectedDetail: 0, eventType: 'MOVED' });
    const before = canonicalSnapshot(instance);

    const result = await processTenantIncrementalVerification(env(), context({ expected: 0 }), {
      queryBatch: queryBatchFor(instance)
    });
    expect(result).toMatchObject({
      outcome: 'success',
      verificationCode: 'sync_candidate_verified_v1',
      stageState: 'verified',
      expected: 0,
      proposedProducts: 1
    });
    expect(result.merchandising.navigationItems).toBeGreaterThan(0);
    expect(instance.prepare('SELECT COUNT(*) AS total FROM supplier_sync_stage_product_details').get().total).toBe(0);
    expect(instance.prepare('SELECT COUNT(*) AS total FROM supplier_sync_stage_intelligence_state').get().total).toBe(0);
    expect(canonicalSnapshot(instance)).toEqual(before);
  });
});
