export const TENANT_SYNC_STAGE_WRITE_CONTRACT_VERSION = 1;
export const TENANT_SYNC_STAGE_JSON_MAX_BYTES = 220_000;
export const TENANT_SYNC_STAGE_MAX_RECORDS_PER_CHUNK = 250;

const EVENT_REASON_CODES = Object.freeze({
  'listing-changed': 'sync_listing_changed',
  'detail-pending': 'sync_detail_pending',
  'source-placement-changed': 'sync_source_placement_changed',
  'not-observed-in-authoritative-scan': 'sync_not_observed_authoritative'
});

function text(value) {
  return String(value ?? '').trim();
}

function nullableText(value) {
  const valueText = text(value);
  return valueText || null;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function assertIncrementalStageInput(context, scan, plan) {
  if (context?.mode !== 'incremental') throw new Error('tenant_sync_incremental_context_required');
  if (!text(context.importId) || !text(context.tenantId) || !text(context.sourceKey)) {
    throw new Error('tenant_sync_stage_identity_invalid');
  }
  if (!scan || typeof scan.complete !== 'boolean' || !Array.isArray(scan.items) || !Array.isArray(scan.taxonomy)) {
    throw new Error('tenant_sync_scan_contract_invalid');
  }
  if (!plan?.decision || !Array.isArray(plan.events) || !Array.isArray(plan.detailQueue)) {
    throw new Error('tenant_sync_stage_plan_invalid');
  }
}

function normalizeObservation(item, sortOrder) {
  return {
    albumSourceId: text(item.albumSourceId ?? item.sourceId),
    publicProductId: text(item.publicProductId),
    sourceUrl: text(item.sourceUrl),
    sourceTitle: text(item.sourceTitle),
    sourceCategoryId: nullableText(item.sourceCategoryId ?? item.categoryId),
    sourceCategoryPathJson: JSON.stringify(item.sourceCategoryPath ?? item.categoryPathIds ?? []),
    coverSourceUrl: nullableText(item.coverSourceUrl),
    imageCountHint: nullableNumber(item.imageCountHint),
    listingFingerprint: text(item.listingFingerprint),
    sortOrder
  };
}

function normalizeEvent(event) {
  const current = event.current || null;
  const previous = event.previous || null;
  return {
    albumSourceId: text(event.sourceId),
    publicProductId: text(current?.publicProductId || previous?.publicProductId),
    eventType: text(event.type),
    needsDetail: event.needsDetail ? 1 : 0,
    nextMissCount: nullableNumber(event.missCount),
    reasonCode: EVENT_REASON_CODES[event.reason] || null
  };
}

function normalizeCategory(category, sortOrder) {
  return {
    categorySourceId: text(category.id ?? category.categorySourceId),
    name: text(category.name),
    parentSourceId: nullableText(category.parentId ?? category.parentSourceId),
    depth: Math.max(0, Number.parseInt(category.depth, 10) || 0),
    sortOrder
  };
}

function jsonChunks(records) {
  const chunks = [];
  let current = [];
  let currentBytes = 2;

  for (const record of records) {
    const serialized = JSON.stringify(record);
    const recordBytes = new TextEncoder().encode(serialized).byteLength;
    if (recordBytes + 2 > TENANT_SYNC_STAGE_JSON_MAX_BYTES) {
      throw new Error('tenant_sync_stage_record_too_large');
    }
    const separatorBytes = current.length ? 1 : 0;
    if (
      current.length >= TENANT_SYNC_STAGE_MAX_RECORDS_PER_CHUNK ||
      currentBytes + separatorBytes + recordBytes > TENANT_SYNC_STAGE_JSON_MAX_BYTES
    ) {
      chunks.push(`[${current.join(',')}]`);
      current = [];
      currentBytes = 2;
    }
    current.push(serialized);
    currentBytes += (current.length > 1 ? 1 : 0) + recordBytes;
  }

  if (current.length) chunks.push(`[${current.join(',')}]`);
  return chunks;
}

function beginStageQuery(context, scan, plan) {
  const decision = plan.decision;
  return {
    sql: `INSERT INTO supplier_sync_stage_runs
      (run_id, tenant_id, source_key, contract_version, state, safety_outcome,
       safety_policy_version, scan_complete, previous_known_good_count, observed_count,
       disqualifying_failure_count, expected_event_count, expected_detail_count,
       staged_observation_count, staged_event_count, staged_category_count,
       verification_code, last_error_code, updated_at, verified_at, promoted_at)
      VALUES (?1, ?2, ?3, ?4, 'staging', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
              0, 0, 0, NULL, NULL, CURRENT_TIMESTAMP, NULL, NULL)
      ON CONFLICT(run_id) DO UPDATE SET
        contract_version=excluded.contract_version,
        state='staging',
        safety_outcome=excluded.safety_outcome,
        safety_policy_version=excluded.safety_policy_version,
        scan_complete=excluded.scan_complete,
        previous_known_good_count=excluded.previous_known_good_count,
        observed_count=excluded.observed_count,
        disqualifying_failure_count=excluded.disqualifying_failure_count,
        expected_event_count=excluded.expected_event_count,
        expected_detail_count=excluded.expected_detail_count,
        staged_observation_count=0,
        staged_event_count=0,
        staged_category_count=0,
        verification_code=NULL,
        last_error_code=NULL,
        updated_at=CURRENT_TIMESTAMP,
        verified_at=NULL,
        promoted_at=NULL
      WHERE supplier_sync_stage_runs.tenant_id=excluded.tenant_id
        AND supplier_sync_stage_runs.source_key=excluded.source_key
        AND supplier_sync_stage_runs.state IN ('staging','planned','details_pending','preserved','quarantined','failed')`,
    params: [
      context.importId,
      context.tenantId,
      context.sourceKey,
      TENANT_SYNC_STAGE_WRITE_CONTRACT_VERSION,
      decision.outcome,
      Number(decision.policyVersion || 1),
      scan.complete ? 1 : 0,
      Number(plan.previousKnownGoodCount || 0),
      Number(plan.observedCount || scan.items.length || 0),
      Number(scan.disqualifyingFailureCount ?? scan.stats?.disqualifyingFailureCount ?? 0) || 0,
      plan.events.length,
      plan.detailQueue.length
    ]
  };
}

function clearStageQuery(table, context) {
  return {
    sql: `DELETE FROM ${table}
           WHERE run_id=?1
             AND EXISTS (
               SELECT 1 FROM supplier_sync_stage_runs r
                WHERE r.run_id=?1 AND r.tenant_id=?2 AND r.source_key=?3 AND r.state='staging'
             )`,
    params: [context.importId, context.tenantId, context.sourceKey]
  };
}

function observationChunkQuery(context, payload) {
  return {
    sql: `INSERT INTO supplier_sync_stage_observations
      (run_id, album_source_id, public_product_id, source_url, source_title,
       source_category_id, source_category_path_json, cover_source_url,
       image_count_hint, listing_fingerprint, sort_order, updated_at)
      SELECT ?1,
             json_extract(value,'$.albumSourceId'),
             json_extract(value,'$.publicProductId'),
             json_extract(value,'$.sourceUrl'),
             COALESCE(json_extract(value,'$.sourceTitle'),''),
             json_extract(value,'$.sourceCategoryId'),
             json_extract(value,'$.sourceCategoryPathJson'),
             json_extract(value,'$.coverSourceUrl'),
             json_extract(value,'$.imageCountHint'),
             json_extract(value,'$.listingFingerprint'),
             json_extract(value,'$.sortOrder'),
             CURRENT_TIMESTAMP
        FROM json_each(?2)
       WHERE EXISTS (
         SELECT 1 FROM supplier_sync_stage_runs r
          WHERE r.run_id=?1 AND r.tenant_id=?3 AND r.source_key=?4 AND r.state='staging'
       )
      ON CONFLICT(run_id, album_source_id) DO UPDATE SET
        public_product_id=excluded.public_product_id,
        source_url=excluded.source_url,
        source_title=excluded.source_title,
        source_category_id=excluded.source_category_id,
        source_category_path_json=excluded.source_category_path_json,
        cover_source_url=excluded.cover_source_url,
        image_count_hint=excluded.image_count_hint,
        listing_fingerprint=excluded.listing_fingerprint,
        sort_order=excluded.sort_order,
        updated_at=CURRENT_TIMESTAMP`,
    params: [context.importId, payload, context.tenantId, context.sourceKey]
  };
}

function eventChunkQuery(context, payload) {
  return {
    sql: `INSERT INTO supplier_sync_stage_events
      (run_id, album_source_id, public_product_id, event_type, needs_detail,
       next_miss_count, reason_code, updated_at)
      SELECT ?1,
             json_extract(value,'$.albumSourceId'),
             json_extract(value,'$.publicProductId'),
             json_extract(value,'$.eventType'),
             json_extract(value,'$.needsDetail'),
             json_extract(value,'$.nextMissCount'),
             json_extract(value,'$.reasonCode'),
             CURRENT_TIMESTAMP
        FROM json_each(?2)
       WHERE EXISTS (
         SELECT 1 FROM supplier_sync_stage_runs r
          WHERE r.run_id=?1 AND r.tenant_id=?3 AND r.source_key=?4 AND r.state='staging'
       )
      ON CONFLICT(run_id, album_source_id) DO UPDATE SET
        public_product_id=excluded.public_product_id,
        event_type=excluded.event_type,
        needs_detail=excluded.needs_detail,
        next_miss_count=excluded.next_miss_count,
        reason_code=excluded.reason_code,
        updated_at=CURRENT_TIMESTAMP`,
    params: [context.importId, payload, context.tenantId, context.sourceKey]
  };
}

function categoryChunkQuery(context, payload) {
  return {
    sql: `INSERT INTO supplier_sync_stage_categories
      (run_id, category_source_id, name, parent_source_id, depth, sort_order, updated_at)
      SELECT ?1,
             json_extract(value,'$.categorySourceId'),
             json_extract(value,'$.name'),
             json_extract(value,'$.parentSourceId'),
             json_extract(value,'$.depth'),
             json_extract(value,'$.sortOrder'),
             CURRENT_TIMESTAMP
        FROM json_each(?2)
       WHERE EXISTS (
         SELECT 1 FROM supplier_sync_stage_runs r
          WHERE r.run_id=?1 AND r.tenant_id=?3 AND r.source_key=?4 AND r.state='staging'
       )
      ON CONFLICT(run_id, category_source_id) DO UPDATE SET
        name=excluded.name,
        parent_source_id=excluded.parent_source_id,
        depth=excluded.depth,
        sort_order=excluded.sort_order,
        updated_at=CURRENT_TIMESTAMP`,
    params: [context.importId, payload, context.tenantId, context.sourceKey]
  };
}

function sealStageQuery(context, plan) {
  const outcome = plan.decision.outcome;
  const targetState =
    outcome === 'quarantine'
      ? 'quarantined'
      : outcome === 'preserve_last_known_good'
        ? 'preserved'
        : plan.detailQueue.length
          ? 'details_pending'
          : 'planned';
  const writesExpected = outcome === 'proceed';

  return {
    sql: `UPDATE supplier_sync_stage_runs
             SET staged_observation_count=(
                   SELECT COUNT(*) FROM supplier_sync_stage_observations o WHERE o.run_id=?1
                 ),
                 staged_event_count=(
                   SELECT COUNT(*) FROM supplier_sync_stage_events e WHERE e.run_id=?1
                 ),
                 staged_category_count=(
                   SELECT COUNT(*) FROM supplier_sync_stage_categories c WHERE c.run_id=?1
                 ),
                 state=CASE
                   WHEN ?4=0 THEN ?5
                   WHEN (SELECT COUNT(*) FROM supplier_sync_stage_observations o WHERE o.run_id=?1)=observed_count
                    AND (SELECT COUNT(*) FROM supplier_sync_stage_events e WHERE e.run_id=?1)=expected_event_count
                    AND (SELECT COUNT(*) FROM supplier_sync_stage_categories c WHERE c.run_id=?1)=?6
                   THEN ?5
                   ELSE 'failed'
                 END,
                 last_error_code=CASE
                   WHEN ?4=0 THEN NULL
                   WHEN (SELECT COUNT(*) FROM supplier_sync_stage_observations o WHERE o.run_id=?1)=observed_count
                    AND (SELECT COUNT(*) FROM supplier_sync_stage_events e WHERE e.run_id=?1)=expected_event_count
                    AND (SELECT COUNT(*) FROM supplier_sync_stage_categories c WHERE c.run_id=?1)=?6
                   THEN NULL
                   ELSE 'sync_stage_count_mismatch'
                 END,
                 updated_at=CURRENT_TIMESTAMP
           WHERE run_id=?1 AND tenant_id=?2 AND source_key=?3 AND state='staging'`,
    params: [
      context.importId,
      context.tenantId,
      context.sourceKey,
      writesExpected ? 1 : 0,
      targetState,
      writesExpected ? Number(plan.scanTaxonomyCount || 0) : 0
    ]
  };
}

export function buildIncrementalStageWritePlan({ context, scan, plan }) {
  assertIncrementalStageInput(context, scan, plan);
  const proceed = plan.decision.outcome === 'proceed';
  const planWithTaxonomy = { ...plan, scanTaxonomyCount: scan.taxonomy.length };
  const observationRecords = proceed
    ? scan.items.map((item, index) => normalizeObservation(item, index))
    : [];
  const eventRecords = proceed ? plan.events.map(normalizeEvent) : [];
  const categoryRecords = proceed
    ? scan.taxonomy.map((category, index) => normalizeCategory(category, index))
    : [];

  return Object.freeze({
    contractVersion: TENANT_SYNC_STAGE_WRITE_CONTRACT_VERSION,
    beginBatch: Object.freeze([
      beginStageQuery(context, scan, plan),
      clearStageQuery('supplier_sync_stage_observations', context),
      clearStageQuery('supplier_sync_stage_events', context),
      clearStageQuery('supplier_sync_stage_categories', context)
    ]),
    observationBatches: Object.freeze(
      jsonChunks(observationRecords).map((payload) => Object.freeze([observationChunkQuery(context, payload)]))
    ),
    eventBatches: Object.freeze(
      jsonChunks(eventRecords).map((payload) => Object.freeze([eventChunkQuery(context, payload)]))
    ),
    categoryBatches: Object.freeze(
      jsonChunks(categoryRecords).map((payload) => Object.freeze([categoryChunkQuery(context, payload)]))
    ),
    sealBatch: Object.freeze([sealStageQuery(context, planWithTaxonomy)])
  });
}

export function buildIncrementalStageVerificationBatch({ context, verificationCode = 'sync_verified' }) {
  if (context?.mode !== 'incremental') throw new Error('tenant_sync_incremental_context_required');
  return Object.freeze([
    {
      sql: `UPDATE supplier_sync_stage_runs
               SET state='verified', verification_code=?4, verified_at=CURRENT_TIMESTAMP,
                   last_error_code=NULL, updated_at=CURRENT_TIMESTAMP
             WHERE run_id=?1 AND tenant_id=?2 AND source_key=?3
               AND safety_outcome='proceed'
               AND state IN ('planned','details_complete')
               AND staged_observation_count=observed_count
               AND staged_event_count=expected_event_count`,
      params: [context.importId, context.tenantId, context.sourceKey, verificationCode]
    },
    {
      sql: `SELECT state, safety_outcome, observed_count, staged_observation_count,
                   expected_event_count, staged_event_count, expected_detail_count,
                   verification_code
              FROM supplier_sync_stage_runs
             WHERE run_id=?1 AND tenant_id=?2 AND source_key=?3 LIMIT 1`,
      params: [context.importId, context.tenantId, context.sourceKey]
    }
  ]);
}

function promotionGate() {
  return `EXISTS (
    SELECT 1 FROM supplier_sync_stage_runs r
     WHERE r.run_id=?1 AND r.tenant_id=?2 AND r.source_key=?3 AND r.state='promoting'
  )`;
}

export function buildIncrementalStagePromotionBatch({ context }) {
  if (context?.mode !== 'incremental') throw new Error('tenant_sync_incremental_context_required');
  const gate = promotionGate();
  const params = [context.importId, context.tenantId, context.sourceKey];

  return Object.freeze([
    {
      sql: `UPDATE supplier_sync_stage_runs
               SET state='promoting', updated_at=CURRENT_TIMESTAMP
             WHERE run_id=?1 AND tenant_id=?2 AND source_key=?3
               AND state IN ('verified','promoting')`,
      params
    },
    {
      sql: `UPDATE supplier_album_index
               SET public_product_id=(SELECT o.public_product_id FROM supplier_sync_stage_observations o WHERE o.run_id=?1 AND o.album_source_id=supplier_album_index.album_source_id),
                   source_url=(SELECT o.source_url FROM supplier_sync_stage_observations o WHERE o.run_id=?1 AND o.album_source_id=supplier_album_index.album_source_id),
                   source_title=(SELECT o.source_title FROM supplier_sync_stage_observations o WHERE o.run_id=?1 AND o.album_source_id=supplier_album_index.album_source_id),
                   source_category_id=(SELECT o.source_category_id FROM supplier_sync_stage_observations o WHERE o.run_id=?1 AND o.album_source_id=supplier_album_index.album_source_id),
                   source_category_path_json=(SELECT o.source_category_path_json FROM supplier_sync_stage_observations o WHERE o.run_id=?1 AND o.album_source_id=supplier_album_index.album_source_id),
                   cover_source_url=(SELECT o.cover_source_url FROM supplier_sync_stage_observations o WHERE o.run_id=?1 AND o.album_source_id=supplier_album_index.album_source_id),
                   image_count_hint=(SELECT o.image_count_hint FROM supplier_sync_stage_observations o WHERE o.run_id=?1 AND o.album_source_id=supplier_album_index.album_source_id),
                   listing_fingerprint=(SELECT o.listing_fingerprint FROM supplier_sync_stage_observations o WHERE o.run_id=?1 AND o.album_source_id=supplier_album_index.album_source_id),
                   detail_fingerprint=CASE WHEN EXISTS (
                     SELECT 1 FROM supplier_sync_stage_events e
                      WHERE e.run_id=?1 AND e.album_source_id=supplier_album_index.album_source_id AND e.needs_detail=1
                   ) THEN NULL ELSE detail_fingerprint END,
                   status='active', miss_count=0,
                   detail_retry_count=CASE WHEN EXISTS (
                     SELECT 1 FROM supplier_sync_stage_events e
                      WHERE e.run_id=?1 AND e.album_source_id=supplier_album_index.album_source_id AND e.needs_detail=1
                   ) THEN 0 ELSE detail_retry_count END,
                   detail_retry_after=CASE WHEN EXISTS (
                     SELECT 1 FROM supplier_sync_stage_events e
                      WHERE e.run_id=?1 AND e.album_source_id=supplier_album_index.album_source_id AND e.needs_detail=1
                   ) THEN NULL ELSE detail_retry_after END,
                   detail_last_error=CASE WHEN EXISTS (
                     SELECT 1 FROM supplier_sync_stage_events e
                      WHERE e.run_id=?1 AND e.album_source_id=supplier_album_index.album_source_id AND e.needs_detail=1
                   ) THEN NULL ELSE detail_last_error END,
                   last_seen_at=CURRENT_TIMESTAMP,
                   last_changed_at=CASE WHEN EXISTS (
                     SELECT 1 FROM supplier_sync_stage_events e
                      WHERE e.run_id=?1 AND e.album_source_id=supplier_album_index.album_source_id
                   ) THEN CURRENT_TIMESTAMP ELSE last_changed_at END,
                   updated_at=CURRENT_TIMESTAMP
             WHERE tenant_id=?2 AND source_key=?3
               AND ${gate}
               AND EXISTS (
                 SELECT 1 FROM supplier_sync_stage_observations o
                  WHERE o.run_id=?1 AND o.album_source_id=supplier_album_index.album_source_id
               )`,
      params
    },
    {
      sql: `INSERT INTO supplier_album_index
        (tenant_id, source_key, album_source_id, public_product_id, source_url, source_title,
         source_category_id, source_category_path_json, cover_source_url, image_count_hint,
         listing_fingerprint, detail_fingerprint, status, miss_count, first_seen_at,
         last_seen_at, last_changed_at, updated_at)
        SELECT ?2, ?3, o.album_source_id, o.public_product_id, o.source_url, o.source_title,
               o.source_category_id, o.source_category_path_json, o.cover_source_url,
               o.image_count_hint, o.listing_fingerprint, NULL, 'active', 0,
               CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          FROM supplier_sync_stage_observations o
         WHERE o.run_id=?1 AND ${gate}
           AND NOT EXISTS (
             SELECT 1 FROM supplier_album_index i
              WHERE i.tenant_id=?2 AND i.source_key=?3 AND i.album_source_id=o.album_source_id
           )`,
      params
    },
    {
      sql: `UPDATE supplier_album_index
               SET status=CASE (
                     SELECT e.event_type FROM supplier_sync_stage_events e
                      WHERE e.run_id=?1 AND e.album_source_id=supplier_album_index.album_source_id
                   ) WHEN 'REMOVED' THEN 'deleted' ELSE 'missing' END,
                   miss_count=COALESCE((
                     SELECT e.next_miss_count FROM supplier_sync_stage_events e
                      WHERE e.run_id=?1 AND e.album_source_id=supplier_album_index.album_source_id
                   ), miss_count),
                   updated_at=CURRENT_TIMESTAMP
             WHERE tenant_id=?2 AND source_key=?3 AND ${gate}
               AND EXISTS (
                 SELECT 1 FROM supplier_sync_stage_events e
                  WHERE e.run_id=?1 AND e.album_source_id=supplier_album_index.album_source_id
                    AND e.event_type IN ('MISSING','REMOVED')
               )`,
      params
    },
    {
      sql: `DELETE FROM supplier_sync_events WHERE run_id=?1 AND ${gate}`,
      params
    },
    {
      sql: `INSERT INTO supplier_sync_events
        (run_id, tenant_id, source_key, album_source_id, public_product_id,
         event_type, needs_detail, created_at)
        SELECT ?1, ?2, ?3, e.album_source_id, e.public_product_id,
               e.event_type, e.needs_detail, CURRENT_TIMESTAMP
          FROM supplier_sync_stage_events e
         WHERE e.run_id=?1 AND ${gate}`,
      params
    },
    {
      sql: `INSERT OR REPLACE INTO supplier_category_index
        (tenant_id, source_key, category_source_id, name, parent_source_id, depth, sort_order, updated_at)
        SELECT ?2, ?3, c.category_source_id, c.name, c.parent_source_id, c.depth, c.sort_order,
               CURRENT_TIMESTAMP
          FROM supplier_sync_stage_categories c
         WHERE c.run_id=?1 AND ${gate}`,
      params
    },
    {
      sql: `UPDATE supplier_sources
               SET last_scan_at=CURRENT_TIMESTAMP, last_success_at=CURRENT_TIMESTAMP,
                   last_error=NULL, updated_at=CURRENT_TIMESTAMP
             WHERE tenant_id=?2 AND source_key=?3 AND ${gate}`,
      params
    },
    {
      sql: `UPDATE supplier_sync_stage_runs
               SET state='promoted', promoted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
             WHERE run_id=?1 AND tenant_id=?2 AND source_key=?3 AND state='promoting'`,
      params
    },
    {
      sql: `SELECT state, promoted_at, verification_code
              FROM supplier_sync_stage_runs
             WHERE run_id=?1 AND tenant_id=?2 AND source_key=?3 LIMIT 1`,
      params
    }
  ]);
}
