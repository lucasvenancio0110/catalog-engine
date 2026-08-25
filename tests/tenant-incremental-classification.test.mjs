import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  processTenantIncrementalClassification
} from '../worker/ingestion/incremental-classification-runner.js';
import { tenantDataPlaneCurrentBatch } from '../worker/tenant-data-plane-schema-v6.js';

const databases = [];
const tenantId = 't_0123456789abcdefabcd';
const importId = 'imp_0123456789abcdefabcd';
const productId = 'p_0123456789abcdefabcd';
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

function context({ expected = 1 } = {}) {
  return {
    importId,
    tenantId,
    sourceKey,
    mode: 'incremental',
    importStatus: 'details',
    phase: 'details',
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

function seedAffectedCandidate(instance) {
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
  instance
    .prepare(
      `INSERT INTO catalog_products
        (product_id,name,search_text,category_id,category_name,description,
         source_name,display_name,source_category_name,display_category_name)
       VALUES (?1,'Last Known Good','last known good','legacy','Legacy','healthy',
               'Last Known Good','Last Known Good','Legacy','Legacy')`
    )
    .run(productId);
  instance
    .prepare(
      `INSERT INTO catalog_product_classification_overrides
        (product_id,override_json,override_version,updated_at)
       VALUES (?1,?2,7,'2026-08-25 10:00:00')`
    )
    .run(productId, JSON.stringify({ displayName: 'Merchant Arsenal' }));
  instance
    .prepare(
      `INSERT INTO supplier_sync_stage_runs
        (run_id,tenant_id,source_key,scope_id,scope_kind,state,safety_outcome,
         safety_policy_version,scan_complete,previous_known_good_count,observed_count,
         expected_event_count,expected_detail_count,staged_observation_count,
         staged_event_count,staged_category_count)
       VALUES (?1,?2,?3,'catalog','catalog','details_complete','proceed',1,1,1,1,1,1,1,1,2)`
    )
    .run(importId, tenantId, sourceKey);
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
        (run_id,album_source_id,public_product_id,event_type,needs_detail)
       VALUES (?1,?2,?3,'CHANGED',1)`
    )
    .run(importId, albumSourceId, productId);
  instance
    .prepare(
      `INSERT INTO supplier_sync_stage_catalog_categories
        (run_id,category_id,name,depth,sort_order,product_count)
       VALUES (?1,'c_candidate','Arsenal',0,0,1)`
    )
    .run(importId);
  instance
    .prepare(
      `INSERT INTO supplier_sync_stage_product_details
        (run_id,album_source_id,public_product_id,detail_state,attempt_count,
         provider_contract_version,evidence_schema_version,detail_fingerprint,
         normalized_evidence_json,name,search_text,category_id,category_name,
         description,image_count,sort_order,source_name,display_name,
         source_category_name,display_category_name,processed_at)
       VALUES (?1,?2,?3,'complete',1,1,1,'detail-v2',?4,
               'Arsenal 25/26 Player Version Jersey','arsenal jersey','c_candidate','Arsenal',
               'Official style football jersey',1,0,'Arsenal 25/26 Player Version Jersey',
               'Arsenal 25/26 Player Version Jersey','Arsenal','Arsenal',CURRENT_TIMESTAMP)`
    )
    .run(
      importId,
      albumSourceId,
      productId,
      JSON.stringify({ name: 'Arsenal 25/26 Player Version Jersey', detailFingerprint: 'detail-v2' })
    );
}

afterEach(() => {
  while (databases.length) databases.pop().close();
});

describe('M7D5 affected-only CEI candidate processing', () => {
  it('classifies only the affected candidate, reapplies merchant truth and preserves canonical LKG', async () => {
    const instance = database();
    seedAffectedCandidate(instance);
    const queryBatch = queryBatchFor(instance);

    const first = await processTenantIncrementalClassification(env(), context(), { queryBatch });

    expect(first).toMatchObject({
      outcome: 'success',
      expected: 1,
      processed: 1,
      reused: 0,
      classificationCount: 1,
      intelligenceCount: 1
    });
    expect(
      instance
        .prepare(
          `SELECT display_name,team_id,league_id,classification_status,classification_confidence
             FROM supplier_sync_stage_product_details
            WHERE run_id=?1 AND public_product_id=?2`
        )
        .get(importId, productId)
    ).toMatchObject({
      display_name: 'Merchant Arsenal',
      team_id: 'arsenal',
      league_id: 'premier-league'
    });
    expect(
      instance
        .prepare(
          `SELECT classifier_version,classifier_key,override_applied,
                  merchant_override_version,merchant_override_updated_at
             FROM supplier_sync_stage_classification_state
            WHERE run_id=?1 AND public_product_id=?2`
        )
        .get(importId, productId)
    ).toEqual({
      classifier_version: 3,
      classifier_key: 'professional-v3',
      override_applied: 1,
      merchant_override_version: 7,
      merchant_override_updated_at: '2026-08-25 10:00:00'
    });
    const intelligence = instance
      .prepare(
        `SELECT classifier_version,classifier_key,knowledge_pack_key,knowledge_pack_version,
                domain_id,override_applied,state_json
           FROM supplier_sync_stage_intelligence_state
          WHERE run_id=?1 AND public_product_id=?2`
      )
      .get(importId, productId);
    expect(intelligence).toMatchObject({
      classifier_version: 3,
      classifier_key: 'professional-v3',
      knowledge_pack_key: 'sports-v1',
      knowledge_pack_version: 1,
      domain_id: 'sports',
      override_applied: 1
    });
    expect(JSON.parse(intelligence.state_json).overrideApplied).toBe(true);
    expect(instance.prepare('SELECT name,display_name FROM catalog_products WHERE product_id=?1').get(productId)).toEqual({
      name: 'Last Known Good',
      display_name: 'Last Known Good'
    });
    expect(instance.prepare('SELECT override_version FROM catalog_product_classification_overrides WHERE product_id=?1').get(productId)).toEqual({
      override_version: 7
    });
    expect(instance.prepare('SELECT COUNT(*) AS total FROM catalog_product_intelligence_state').get().total).toBe(0);
    expect(instance.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

    const second = await processTenantIncrementalClassification(env(), context(), { queryBatch });
    expect(second).toMatchObject({
      outcome: 'success',
      expected: 1,
      processed: 0,
      reused: 1,
      classificationCount: 1,
      intelligenceCount: 1
    });
  });

  it('does not classify MOVED-only work that has no affected detail candidate', async () => {
    const instance = database();
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
    instance
      .prepare(
        `INSERT INTO supplier_sync_stage_runs
          (run_id,tenant_id,source_key,scope_id,scope_kind,state,safety_outcome,
           scan_complete,expected_detail_count)
         VALUES (?1,?2,?3,'catalog','catalog','details_complete','proceed',1,0)`
      )
      .run(importId, tenantId, sourceKey);

    const result = await processTenantIncrementalClassification(env(), context({ expected: 0 }), {
      queryBatch: queryBatchFor(instance)
    });
    expect(result).toEqual({ outcome: 'success', alreadyComplete: true, expected: 0 });
    expect(instance.prepare('SELECT COUNT(*) AS total FROM supplier_sync_stage_classification_state').get().total).toBe(0);
    expect(instance.prepare('SELECT COUNT(*) AS total FROM supplier_sync_stage_intelligence_state').get().total).toBe(0);
  });
});
