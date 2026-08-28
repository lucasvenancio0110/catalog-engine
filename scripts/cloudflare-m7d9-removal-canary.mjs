import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createD1Database, queryD1Batch } from '../worker/cloudflare-platform.js';
import { splitD1Batch } from './d1-batch-chunks.mjs';
import { planTenantIncrementalScan } from '../worker/ingestion/incremental-plan.js';
import { processTenantIncrementalPromotion } from '../worker/ingestion/incremental-promotion.js';
import {
  TENANT_DATA_PLANE_SCHEMA_VERSION,
  tenantDataPlaneCurrentBatch
} from '../worker/tenant-data-plane-schema-v8.js';

const API_ORIGIN = 'https://api.cloudflare.com';
const ACCOUNT_ID = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const API_TOKEN = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const DISPATCH_NAMESPACE = String(
  process.env.CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE || 'catalog-engine-production'
).trim();
const SOURCE_KEY = 'm7d9-canary';
const SCOPE_A = 's_aaaaaaaaaaaaaaaaaaaa';
const SCOPE_B = 's_bbbbbbbbbbbbbbbbbbbb';
const TARGET_ID = 'p_11111111111111111111';
const CONTROL_ID = 'p_22222222222222222222';
const TARGET_ALBUM = 'album-target';
const CONTROL_ALBUM = 'album-control';
const CATEGORY_ID = 'c_33333333333333333333';
const OVERRIDE_JSON = '{"displayName":"Merchant Target"}';

if (!/^[a-f0-9]{32}$/i.test(ACCOUNT_ID)) throw new Error('m7d9_canary_account_unconfigured');
if (API_TOKEN.length < 20) throw new Error('m7d9_canary_token_unconfigured');
if (TENANT_DATA_PLANE_SCHEMA_VERSION !== 8) throw new Error('m7d9_canary_schema_contract_changed');

const wrangler = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
if (String(wrangler.vars?.TENANT_SYNC_AUTOMATION_ENABLED || '') !== '0') {
  throw new Error('m7d9_canary_recurring_sync_must_remain_off');
}
if (String(wrangler.vars?.TENANT_SYNC_ACTIVE_COHORT || '') !== '') {
  throw new Error('m7d9_canary_active_cohort_must_remain_empty');
}
if (String(wrangler.vars?.TENANT_SYNC_MAX_JOBS_PER_TICK || '') !== '1') {
  throw new Error('m7d9_canary_sync_cap_must_remain_one');
}

function platformConfig() {
  return {
    accountId: ACCOUNT_ID,
    apiToken: API_TOKEN,
    dispatchNamespace: DISPATCH_NAMESPACE
  };
}

function promotionEnv() {
  return {
    CLOUDFLARE_PLATFORM_ACCOUNT_ID: ACCOUNT_ID,
    CLOUDFLARE_PLATFORM_API_TOKEN: API_TOKEN,
    CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE: DISPATCH_NAMESPACE
  };
}

async function cloudflareRequest(path, { method = 'GET', allowNotFound = false } = {}) {
  const response = await fetch(new URL(path, API_ORIGIN), {
    method,
    redirect: 'error',
    headers: { authorization: `Bearer ${API_TOKEN}`, accept: 'application/json' }
  });
  if (allowNotFound && response.status === 404) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) {
    const providerCode = Number(payload?.errors?.[0]?.code);
    const code = Number.isFinite(providerCode)
      ? String(providerCode)
      : String(response.status || 'unknown');
    throw new Error(`m7d9_canary_cloudflare_${code}`);
  }
  return payload.result ?? null;
}

async function d1Batch(databaseId, batch) {
  return queryD1Batch({ ...platformConfig(), databaseId, batch });
}

async function createEphemeralDatabase(name) {
  const result = await createD1Database({ ...platformConfig(), databaseName: name });
  if (!result?.databaseId) throw new Error('m7d9_canary_database_create_failed');
  return result.databaseId;
}

async function deleteDatabase(databaseId) {
  if (!databaseId) return;
  await cloudflareRequest(
    `/client/v4/accounts/${ACCOUNT_ID}/d1/database/${encodeURIComponent(databaseId)}`,
    { method: 'DELETE', allowNotFound: true }
  );
}

function fixtureIdentity(kind) {
  const seed = `${process.env.GITHUB_RUN_ID || Date.now()}:${process.env.GITHUB_RUN_ATTEMPT || '1'}:${kind}`;
  const suffix = createHash('sha256').update(`m7d9:${seed}`).digest('hex').slice(0, 20);
  return {
    kind,
    tenantId: `t_${suffix}`,
    databaseName: `cem7d9-${kind}-${suffix}`,
    databaseId: null,
    sourceUrl: `https://m7d9-${suffix}.x.yupoo.com/albums/`
  };
}

function promotionContext(fixture, importId) {
  return {
    importId,
    tenantId: fixture.tenantId,
    sourceKey: SOURCE_KEY,
    mode: 'incremental',
    schemaVersion: 8,
    dataPlane: {
      databaseId: fixture.databaseId,
      dispatchNamespace: DISPATCH_NAMESPACE
    }
  };
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

function provePlannerSafety() {
  const scope = { id: SCOPE_A, kind: 'source' };
  const miss1 = planTenantIncrementalScan({
    previousRows: previousRows('active', 0),
    scan: { complete: true, items: [controlObservation()] },
    scope,
    removalMissThreshold: 3
  });
  const miss2 = planTenantIncrementalScan({
    previousRows: previousRows('missing', 1),
    scan: { complete: true, items: [controlObservation()] },
    scope,
    removalMissThreshold: 3
  });
  const removed = planTenantIncrementalScan({
    previousRows: previousRows('missing', 2),
    scan: { complete: true, items: [controlObservation()] },
    scope,
    removalMissThreshold: 3
  });
  const partial = planTenantIncrementalScan({
    previousRows: previousRows('missing', 2),
    scan: { complete: false, items: [controlObservation()] },
    scope,
    removalMissThreshold: 3
  });
  const zero = planTenantIncrementalScan({
    previousRows: previousRows('missing', 2),
    scan: { complete: true, items: [] },
    scope,
    removalMissThreshold: 3
  });
  const restored = planTenantIncrementalScan({
    previousRows: previousRows('detached', 3),
    scan: { complete: true, items: [targetObservation(), controlObservation()] },
    scope,
    removalMissThreshold: 3
  });

  const event = (plan, type) => plan.events.find((entry) => entry.sourceId === TARGET_ALBUM && entry.type === type);
  if (event(miss1, 'MISSING')?.missCount !== 1) throw new Error('m7d9_canary_planner_miss1_invalid');
  if (event(miss2, 'MISSING')?.missCount !== 2) throw new Error('m7d9_canary_planner_miss2_invalid');
  if (event(removed, 'REMOVED')?.missCount !== 3) throw new Error('m7d9_canary_planner_removed_invalid');
  if (partial.decision?.outcome !== 'preserve_last_known_good') {
    throw new Error('m7d9_canary_partial_scan_not_preserved');
  }
  if (partial.events.some((entry) => ['MISSING', 'REMOVED'].includes(entry.type))) {
    throw new Error('m7d9_canary_partial_scan_progressed_removal');
  }
  if (zero.decision?.outcome !== 'quarantine') throw new Error('m7d9_canary_zero_scan_not_quarantined');
  if (zero.events.some((entry) => ['MISSING', 'REMOVED'].includes(entry.type))) {
    throw new Error('m7d9_canary_zero_scan_progressed_removal');
  }
  if (!event(restored, 'RESTORED')?.needsDetail) throw new Error('m7d9_canary_restored_plan_invalid');
  if (
    miss1.removalPolicy?.contractVersion !== 1 ||
    miss1.removalPolicy?.policyVersion !== 1 ||
    miss1.removalPolicy?.removalThreshold !== 3 ||
    miss1.removalPolicy?.scopeId !== SCOPE_A
  ) {
    throw new Error('m7d9_canary_policy_snapshot_invalid');
  }
  return true;
}

async function initializeFixture(fixture, { secondScope = false } = {}) {
  const schemaBootstrap = tenantDataPlaneCurrentBatch({
    tenantId: fixture.tenantId,
    source: {
      provider: 'yupoo',
      sourceKey: SOURCE_KEY,
      sourceUrl: fixture.sourceUrl,
      syncStrategy: 'incremental',
      removalMissThreshold: 3
    }
  });
  for (const chunk of splitD1Batch(schemaBootstrap)) {
    await d1Batch(fixture.databaseId, chunk);
  }
  const batch = [
    {
      sql: `INSERT INTO catalog_categories
              (category_id,name,depth,sort_order,product_count)
            VALUES (?1,'Safe Category',0,0,2)`,
      params: [CATEGORY_ID]
    },
    {
      sql: `INSERT INTO catalog_products
              (product_id,name,search_text,category_id,category_name,description,image_count,
               sort_order,source_name,display_name,source_category_name,display_category_name,
               classification_status,classification_confidence)
            VALUES
              (?1,'Target','target',?3,'Safe Category','target product',0,0,
               'Target','Merchant Target','Safe Category','Safe Category','automatic',0.9),
              (?2,'Control','control',?3,'Safe Category','control product',0,1,
               'Control','Control','Safe Category','Safe Category','automatic',0.9)`,
      params: [TARGET_ID, CONTROL_ID, CATEGORY_ID]
    },
    {
      sql: `INSERT INTO catalog_product_categories(product_id,category_id)
            VALUES (?1,?3),(?2,?3)`,
      params: [TARGET_ID, CONTROL_ID, CATEGORY_ID]
    },
    {
      sql: `INSERT INTO catalog_product_classification_overrides
              (product_id,override_json,override_version,created_at,updated_at)
            VALUES (?1,?2,7,'2026-08-25T10:00:00Z','2026-08-25T10:00:00Z')`,
      params: [TARGET_ID, OVERRIDE_JSON]
    },
    {
      sql: `INSERT INTO supplier_album_index
              (tenant_id,source_key,album_source_id,public_product_id,source_url,source_title,
               source_category_id,source_category_path_json,listing_fingerprint,detail_fingerprint,
               status,miss_count)
            VALUES
              (?1,?2,?3,?4,?7,'Target','safe','["safe"]','listing-target','detail-target','active',0),
              (?1,?2,?5,?6,?8,'Control','safe','["safe"]','listing-control','detail-control','active',0)`,
      params: [
        fixture.tenantId,
        SOURCE_KEY,
        TARGET_ALBUM,
        TARGET_ID,
        CONTROL_ALBUM,
        CONTROL_ID,
        `${fixture.sourceUrl}${TARGET_ALBUM}`,
        `${fixture.sourceUrl}${CONTROL_ALBUM}`
      ]
    },
    {
      sql: `INSERT INTO supplier_scope_memberships
              (tenant_id,source_key,scope_id,scope_kind,album_source_id,public_product_id,
               removal_threshold,state,miss_count)
            VALUES
              (?1,?2,?3,'source',?4,?5,3,'active',0),
              (?1,?2,?3,'source',?6,?7,3,'active',0)`,
      params: [
        fixture.tenantId,
        SOURCE_KEY,
        SCOPE_A,
        TARGET_ALBUM,
        TARGET_ID,
        CONTROL_ALBUM,
        CONTROL_ID
      ]
    }
  ];
  if (secondScope) {
    batch.push({
      sql: `INSERT INTO supplier_scope_memberships
              (tenant_id,source_key,scope_id,scope_kind,album_source_id,public_product_id,
               removal_threshold,state,miss_count)
            VALUES (?1,?2,?3,'category',?4,?5,3,'active',0)`,
      params: [fixture.tenantId, SOURCE_KEY, SCOPE_B, TARGET_ALBUM, TARGET_ID]
    });
  }
  await d1Batch(fixture.databaseId, batch);
}

async function seedAbsenceRun(
  fixture,
  { runId, eventType, nextMissCount, baseRevision, scopeId = SCOPE_A }
) {
  await d1Batch(fixture.databaseId, [
    {
      sql: `INSERT INTO supplier_sync_runs
              (run_id,tenant_id,source_key,mode,status,complete_scan,scanned_albums,
               missing_count,removed_count,detail_fetch_count,started_at)
            VALUES (?1,?2,?3,'incremental','running',1,1,?4,?5,0,CURRENT_TIMESTAMP)`,
      params: [
        runId,
        fixture.tenantId,
        SOURCE_KEY,
        eventType === 'MISSING' ? 1 : 0,
        eventType === 'REMOVED' ? 1 : 0
      ]
    },
    {
      sql: `INSERT INTO supplier_sync_stage_runs
              (run_id,tenant_id,source_key,scope_id,scope_kind,contract_version,state,safety_outcome,
               safety_policy_version,scan_complete,previous_known_good_count,observed_count,
               disqualifying_failure_count,expected_event_count,expected_detail_count,
               staged_observation_count,staged_event_count,staged_category_count,
               verification_code,verified_at)
            VALUES (?1,?2,?3,?4,'source',1,'verified','proceed',1,1,2,1,0,1,0,1,1,0,
                    'sync_candidate_verified_v1',CURRENT_TIMESTAMP)`,
      params: [runId, fixture.tenantId, SOURCE_KEY, scopeId]
    },
    {
      sql: `INSERT INTO supplier_sync_stage_authority
              (run_id,tenant_id,source_key,contract_version,base_authority_revision)
            VALUES (?1,?2,?3,1,?4)`,
      params: [runId, fixture.tenantId, SOURCE_KEY, baseRevision]
    },
    {
      sql: `INSERT INTO supplier_sync_stage_removal_policy
              (run_id,tenant_id,source_key,scope_id,scope_kind,contract_version,policy_version,removal_threshold)
            VALUES (?1,?2,?3,?4,'source',1,1,3)`,
      params: [runId, fixture.tenantId, SOURCE_KEY, scopeId]
    },
    {
      sql: `INSERT INTO supplier_sync_stage_observations
              (run_id,album_source_id,public_product_id,source_url,source_title,
               source_category_id,source_category_path_json,listing_fingerprint,sort_order)
            VALUES (?1,?2,?3,?4,'Control','safe','["safe"]','listing-control',1)`,
      params: [
        runId,
        CONTROL_ALBUM,
        CONTROL_ID,
        `${fixture.sourceUrl}${CONTROL_ALBUM}`
      ]
    },
    {
      sql: `INSERT INTO supplier_sync_stage_events
              (run_id,album_source_id,public_product_id,event_type,needs_detail,next_miss_count,reason_code)
            VALUES (?1,?2,?3,?4,0,?5,'sync_not_observed_authoritative')`,
      params: [runId, TARGET_ALBUM, TARGET_ID, eventType, nextMissCount]
    }
  ]);
  return promotionContext(fixture, runId);
}

async function seedRestoredRun(fixture, { runId, baseRevision }) {
  await d1Batch(fixture.databaseId, [
    {
      sql: `INSERT INTO supplier_sync_runs
              (run_id,tenant_id,source_key,mode,status,complete_scan,scanned_albums,
               restored_count,detail_fetch_count,started_at)
            VALUES (?1,?2,?3,'incremental','running',1,2,1,1,CURRENT_TIMESTAMP)`,
      params: [runId, fixture.tenantId, SOURCE_KEY]
    },
    {
      sql: `INSERT INTO supplier_sync_stage_runs
              (run_id,tenant_id,source_key,scope_id,scope_kind,contract_version,state,safety_outcome,
               safety_policy_version,scan_complete,previous_known_good_count,observed_count,
               disqualifying_failure_count,expected_event_count,expected_detail_count,
               staged_observation_count,staged_event_count,staged_category_count,
               verification_code,verified_at)
            VALUES (?1,?2,?3,?4,'source',1,'verified','proceed',1,1,1,2,0,1,1,2,1,1,
                    'sync_candidate_verified_v1',CURRENT_TIMESTAMP)`,
      params: [runId, fixture.tenantId, SOURCE_KEY, SCOPE_A]
    },
    {
      sql: `INSERT INTO supplier_sync_stage_authority
              (run_id,tenant_id,source_key,contract_version,base_authority_revision)
            VALUES (?1,?2,?3,1,?4)`,
      params: [runId, fixture.tenantId, SOURCE_KEY, baseRevision]
    },
    {
      sql: `INSERT INTO supplier_sync_stage_removal_policy
              (run_id,tenant_id,source_key,scope_id,scope_kind,contract_version,policy_version,removal_threshold)
            VALUES (?1,?2,?3,?4,'source',1,1,3)`,
      params: [runId, fixture.tenantId, SOURCE_KEY, SCOPE_A]
    },
    {
      sql: `INSERT INTO supplier_sync_stage_observations
              (run_id,album_source_id,public_product_id,source_url,source_title,
               source_category_id,source_category_path_json,listing_fingerprint,sort_order)
            VALUES
              (?1,?2,?3,?6,'Target Restored','safe','["safe"]','listing-restored',0),
              (?1,?4,?5,?7,'Control','safe','["safe"]','listing-control',1)`,
      params: [
        runId,
        TARGET_ALBUM,
        TARGET_ID,
        CONTROL_ALBUM,
        CONTROL_ID,
        `${fixture.sourceUrl}${TARGET_ALBUM}`,
        `${fixture.sourceUrl}${CONTROL_ALBUM}`
      ]
    },
    {
      sql: `INSERT INTO supplier_sync_stage_events
              (run_id,album_source_id,public_product_id,event_type,needs_detail,reason_code)
            VALUES (?1,?2,?3,'RESTORED',1,'sync_listing_restored')`,
      params: [runId, TARGET_ALBUM, TARGET_ID]
    },
    {
      sql: `INSERT INTO supplier_sync_stage_categories
              (run_id,category_source_id,name,depth,sort_order)
            VALUES (?1,'safe','Safe Category',0,0)`,
      params: [runId]
    },
    {
      sql: `INSERT INTO supplier_sync_stage_catalog_categories
              (run_id,category_id,name,depth,sort_order,product_count)
            VALUES (?1,?2,'Safe Category',0,0,2)`,
      params: [runId, CATEGORY_ID]
    },
    {
      sql: `INSERT INTO supplier_sync_stage_product_details
              (run_id,album_source_id,public_product_id,detail_state,attempt_count,
               provider_contract_version,evidence_schema_version,detail_fingerprint,
               normalized_evidence_json,name,search_text,category_id,category_name,description,
               image_count,primary_media_id,sort_order,source_name,display_name,
               source_category_name,display_category_name,classification_status,
               classification_confidence,processed_at)
            VALUES (?1,?2,?3,'complete',1,1,1,'detail-restored','{"safe":true}',
                    'Target Restored','target restored',?4,'Safe Category','restored safely',
                    0,NULL,0,'Target Restored','Target Restored','Safe Category','Safe Category',
                    'automatic',0.95,CURRENT_TIMESTAMP)`,
      params: [runId, TARGET_ALBUM, TARGET_ID, CATEGORY_ID]
    },
    {
      sql: `INSERT INTO supplier_sync_stage_product_categories
              (run_id,public_product_id,category_id) VALUES (?1,?2,?3)`,
      params: [runId, TARGET_ID, CATEGORY_ID]
    }
  ]);
  return promotionContext(fixture, runId);
}

async function promote(context) {
  return processTenantIncrementalPromotion(promotionEnv(), context);
}

async function state(fixture) {
  const result = await d1Batch(fixture.databaseId, [
    {
      sql: `SELECT state,miss_count,last_progress_run_id
              FROM supplier_scope_memberships
             WHERE tenant_id=?1 AND source_key=?2 AND scope_id=?3 AND album_source_id=?4`,
      params: [fixture.tenantId, SOURCE_KEY, SCOPE_A, TARGET_ALBUM]
    },
    {
      sql: 'SELECT COUNT(*) AS total FROM catalog_products WHERE product_id=?1',
      params: [TARGET_ID]
    },
    {
      sql: 'SELECT status,miss_count FROM supplier_album_index WHERE album_source_id=?1',
      params: [TARGET_ALBUM]
    },
    {
      sql: `SELECT override_json,override_version
              FROM catalog_product_classification_overrides WHERE product_id=?1`,
      params: [TARGET_ID]
    },
    {
      sql: `SELECT override_json,override_version
              FROM catalog_product_classification_override_retention WHERE product_id=?1`,
      params: [TARGET_ID]
    },
    {
      sql: 'SELECT revision,last_promoted_run_id FROM catalog_serving_authority WHERE tenant_id=?1',
      params: [fixture.tenantId]
    },
    { sql: 'PRAGMA foreign_key_check', params: [] }
  ]);
  return {
    membership: result[0]?.results?.[0] || null,
    productCount: Number(result[1]?.results?.[0]?.total || 0),
    album: result[2]?.results?.[0] || null,
    override: result[3]?.results?.[0] || null,
    retainedOverride: result[4]?.results?.[0] || null,
    authority: result[5]?.results?.[0] || null,
    foreignKeyFindings: (result[6]?.results || []).length
  };
}

async function secondScopeState(fixture) {
  const result = await d1Batch(fixture.databaseId, [
    {
      sql: `SELECT scope_id,state,miss_count FROM supplier_scope_memberships
             WHERE tenant_id=?1 AND source_key=?2 AND album_source_id=?3
             ORDER BY scope_id`,
      params: [fixture.tenantId, SOURCE_KEY, TARGET_ALBUM]
    },
    {
      sql: 'SELECT COUNT(*) AS total FROM catalog_products WHERE product_id=?1',
      params: [TARGET_ID]
    },
    {
      sql: 'SELECT COUNT(*) AS total FROM catalog_product_classification_overrides WHERE product_id=?1',
      params: [TARGET_ID]
    },
    {
      sql: 'SELECT COUNT(*) AS total FROM catalog_product_classification_override_retention WHERE product_id=?1',
      params: [TARGET_ID]
    },
    {
      sql: 'SELECT status FROM supplier_album_index WHERE album_source_id=?1',
      params: [TARGET_ALBUM]
    },
    {
      sql: 'SELECT revision FROM catalog_serving_authority WHERE tenant_id=?1',
      params: [fixture.tenantId]
    },
    { sql: 'PRAGMA foreign_key_check', params: [] }
  ]);
  return {
    memberships: result[0]?.results || [],
    productCount: Number(result[1]?.results?.[0]?.total || 0),
    overrideCount: Number(result[2]?.results?.[0]?.total || 0),
    retainedOverrideCount: Number(result[3]?.results?.[0]?.total || 0),
    albumStatus: result[4]?.results?.[0]?.status || null,
    authorityRevision: Number(result[5]?.results?.[0]?.revision || -1),
    foreignKeyFindings: (result[6]?.results || []).length
  };
}

async function proveLifecycle(fixture) {
  const firstRunId = 'imp_11111111111111111111';
  const firstContext = await seedAbsenceRun(fixture, {
    runId: firstRunId,
    eventType: 'MISSING',
    nextMissCount: 1,
    baseRevision: 0
  });
  const first = await promote(firstContext);
  let current = await state(fixture);
  if (
    first.outcome !== 'success' ||
    first.alreadyComplete !== false ||
    Number(first.authorityRevision) !== 1 ||
    current.membership?.state !== 'missing' ||
    Number(current.membership?.miss_count) !== 1 ||
    current.productCount !== 1
  ) {
    throw new Error('m7d9_canary_first_miss_failed');
  }

  const replay = await promote(firstContext);
  current = await state(fixture);
  if (
    replay.outcome !== 'success' ||
    replay.alreadyComplete !== true ||
    Number(replay.authorityRevision) !== 1 ||
    Number(current.membership?.miss_count) !== 1 ||
    Number(current.authority?.revision) !== 1
  ) {
    throw new Error('m7d9_canary_replay_incremented_miss');
  }

  const secondContext = await seedAbsenceRun(fixture, {
    runId: 'imp_22222222222222222222',
    eventType: 'MISSING',
    nextMissCount: 2,
    baseRevision: 1
  });
  const second = await promote(secondContext);
  current = await state(fixture);
  if (
    second.outcome !== 'success' ||
    Number(second.authorityRevision) !== 2 ||
    current.membership?.state !== 'missing' ||
    Number(current.membership?.miss_count) !== 2 ||
    current.productCount !== 1
  ) {
    throw new Error('m7d9_canary_second_miss_failed');
  }

  const removedRunId = 'imp_33333333333333333333';
  const removedContext = await seedAbsenceRun(fixture, {
    runId: removedRunId,
    eventType: 'REMOVED',
    nextMissCount: 3,
    baseRevision: 2
  });
  const removed = await promote(removedContext);
  current = await state(fixture);
  if (
    removed.outcome !== 'success' ||
    Number(removed.authorityRevision) !== 3 ||
    current.membership?.state !== 'detached' ||
    Number(current.membership?.miss_count) !== 3 ||
    current.productCount !== 0 ||
    current.album?.status !== 'deleted' ||
    Number(current.album?.miss_count) !== 3 ||
    current.override !== null ||
    current.retainedOverride?.override_json !== OVERRIDE_JSON ||
    Number(current.retainedOverride?.override_version) !== 7 ||
    Number(current.authority?.revision) !== 3 ||
    current.foreignKeyFindings !== 0
  ) {
    throw new Error('m7d9_canary_safe_removal_failed');
  }

  const restoredRunId = 'imp_44444444444444444444';
  const restoredContext = await seedRestoredRun(fixture, {
    runId: restoredRunId,
    baseRevision: 3
  });
  const restored = await promote(restoredContext);
  current = await state(fixture);
  if (
    restored.outcome !== 'success' ||
    Number(restored.authorityRevision) !== 4 ||
    current.membership?.state !== 'active' ||
    Number(current.membership?.miss_count) !== 0 ||
    current.productCount !== 1 ||
    current.album?.status !== 'active' ||
    Number(current.album?.miss_count) !== 0 ||
    current.override?.override_json !== OVERRIDE_JSON ||
    Number(current.override?.override_version) !== 7 ||
    current.retainedOverride !== null ||
    Number(current.authority?.revision) !== 4 ||
    current.authority?.last_promoted_run_id !== restoredRunId ||
    current.foreignKeyFindings !== 0
  ) {
    throw new Error('m7d9_canary_restore_failed');
  }

  return {
    firstMissAuthorityRevision: 1,
    duplicateReplayNoop: true,
    secondMissAuthorityRevision: 2,
    removedAuthorityRevision: 3,
    overrideRetainedAcrossRemoval: true,
    restoredAuthorityRevision: 4,
    overrideRestoredToCanonical: true
  };
}

async function proveCrossScope(fixture) {
  const context = await seedAbsenceRun(fixture, {
    runId: 'imp_55555555555555555555',
    eventType: 'REMOVED',
    nextMissCount: 3,
    baseRevision: 0,
    scopeId: SCOPE_A
  });
  const result = await promote(context);
  const current = await secondScopeState(fixture);
  const scopeA = current.memberships.find((entry) => entry.scope_id === SCOPE_A);
  const scopeB = current.memberships.find((entry) => entry.scope_id === SCOPE_B);
  if (
    result.outcome !== 'success' ||
    Number(result.authorityRevision) !== 1 ||
    scopeA?.state !== 'detached' ||
    Number(scopeA?.miss_count) !== 3 ||
    scopeB?.state !== 'active' ||
    current.productCount !== 1 ||
    current.overrideCount !== 1 ||
    current.retainedOverrideCount !== 0 ||
    current.albumStatus !== 'active' ||
    current.authorityRevision !== 1 ||
    current.foreignKeyFindings !== 0
  ) {
    throw new Error('m7d9_canary_cross_scope_retention_failed');
  }
  return { detachedOneScopeOnly: true, canonicalProductPreservedByOtherScope: true };
}

const lifecycleFixture = fixtureIdentity('lifecycle');
const scopeFixture = fixtureIdentity('scope');
const fixtures = [lifecycleFixture, scopeFixture];

try {
  provePlannerSafety();

  lifecycleFixture.databaseId = await createEphemeralDatabase(lifecycleFixture.databaseName);
  scopeFixture.databaseId = await createEphemeralDatabase(scopeFixture.databaseName);
  await initializeFixture(lifecycleFixture);
  await initializeFixture(scopeFixture, { secondScope: true });

  const lifecycle = await proveLifecycle(lifecycleFixture);
  const crossScope = await proveCrossScope(scopeFixture);

  const summary = {
    m7d9SafeRemovalCanaryPassed: true,
    schemaVersion: TENANT_DATA_PLANE_SCHEMA_VERSION,
    recurringSyncEnabled: false,
    activeCohortEmpty: true,
    syncCapRemainsOne: true,
    manualQueueMessagesProduced: false,
    productionBusinessDataMutated: false,
    ephemeralTenantDataPlanes: true,
    partialScanPreservesLkg: true,
    zeroScanQuarantined: true,
    thresholdAndScopePolicyFrozen: true,
    ...lifecycle,
    ...crossScope,
    cleanupComplete: true
  };

  await deleteDatabase(lifecycleFixture.databaseId);
  await deleteDatabase(scopeFixture.databaseId);
  lifecycleFixture.databaseId = null;
  scopeFixture.databaseId = null;
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  const safeCode = /^[a-z0-9_]+$/i.test(String(error?.message || ''))
    ? String(error.message)
    : 'm7d9_canary_failed';
  console.error(
    JSON.stringify({
      m7d9SafeRemovalCanaryPassed: false,
      retainedEvidence: true,
      error: safeCode,
      fixtures: fixtures.map((fixture) => ({
        kind: fixture.kind,
        tenantId: fixture.tenantId,
        databaseName: fixture.databaseName,
        databaseId: fixture.databaseId
      }))
    })
  );
  throw error;
}
