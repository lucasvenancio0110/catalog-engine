import { queryD1Batch } from '../cloudflare-platform.js';
import { ingestionPlatformConfig } from './context.js';

export const TENANT_INCREMENTAL_PROMOTION_CONTRACT_VERSION = 1;
export const TENANT_INCREMENTAL_PROMOTION_VERIFICATION_CODE = 'sync_candidate_verified_v1';
export const TENANT_INCREMENTAL_PROMOTION_MAX_PRODUCTS = 20_000;
export const TENANT_INCREMENTAL_PROMOTION_MAX_MEDIA_RELATIONSHIPS = 40_000;
export const TENANT_INCREMENTAL_PROMOTION_MAX_STATEMENTS = 100;
export const TENANT_INCREMENTAL_PROMOTION_MAX_SQL_BYTES = 100_000;
export const TENANT_INCREMENTAL_PROMOTION_MAX_BOUND_PARAMS = 100;

function text(value) {
  return String(value ?? '').trim();
}

function assertContext(context) {
  if (context?.mode !== 'incremental') throw new Error('tenant_sync_incremental_context_required');
  if (!text(context.importId) || !text(context.tenantId) || !text(context.sourceKey)) {
    throw new Error('tenant_sync_promotion_identity_invalid');
  }
  if (Number(context.schemaVersion || 0) < 7) throw new Error('tenant_schema_not_ready');
}

function publicLeak(expression) {
  return `(
    lower(COALESCE(${expression},'')) LIKE '%x.yupoo.com%'
    OR lower(COALESCE(${expression},'')) LIKE '%photo.yupoo.com%'
    OR lower(COALESCE(${expression},'')) LIKE '%http://%'
    OR lower(COALESCE(${expression},'')) LIKE '%https://%'
  )`;
}

function composedProductCountSql(context) {
  if (Number(context?.schemaVersion || 0) < 8) {
    return `(
      (SELECT COUNT(*) FROM catalog_products p
        WHERE NOT EXISTS (
          SELECT 1 FROM supplier_sync_stage_product_details d
           WHERE d.run_id=?1 AND d.public_product_id=p.product_id
        ))
      + (SELECT COUNT(*) FROM supplier_sync_stage_product_details d
          WHERE d.run_id=?1 AND d.detail_state='complete')
    )`;
  }
  return `(
    (SELECT COUNT(*) FROM catalog_products p
      WHERE NOT EXISTS (
        SELECT 1 FROM supplier_sync_stage_product_details d
         WHERE d.run_id=?1 AND d.public_product_id=p.product_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM supplier_sync_stage_events e
        JOIN supplier_sync_stage_runs r ON r.run_id=e.run_id
         WHERE e.run_id=?1 AND e.public_product_id=p.product_id AND e.event_type='REMOVED'
           AND NOT EXISTS (
             SELECT 1 FROM supplier_scope_memberships sm
              WHERE sm.tenant_id=r.tenant_id AND sm.public_product_id=p.product_id
                AND sm.scope_id<>r.scope_id AND sm.state IN ('active','missing')
           )
      ))
    + (SELECT COUNT(*) FROM supplier_sync_stage_product_details d
        WHERE d.run_id=?1 AND d.detail_state='complete')
  )`;
}

function composedMediaCountSql(context) {
  if (Number(context?.schemaVersion || 0) < 8) {
    return `(
      (SELECT COUNT(*) FROM product_media pm
        WHERE NOT EXISTS (
          SELECT 1 FROM supplier_sync_stage_product_details d
           WHERE d.run_id=?1 AND d.public_product_id=pm.product_id
        ))
      + (SELECT COUNT(*) FROM supplier_sync_stage_product_media pm WHERE pm.run_id=?1)
    )`;
  }
  return `(
    (SELECT COUNT(*) FROM product_media pm
      WHERE NOT EXISTS (
        SELECT 1 FROM supplier_sync_stage_product_details d
         WHERE d.run_id=?1 AND d.public_product_id=pm.product_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM supplier_sync_stage_events e
        JOIN supplier_sync_stage_runs r ON r.run_id=e.run_id
         WHERE e.run_id=?1 AND e.public_product_id=pm.product_id AND e.event_type='REMOVED'
           AND NOT EXISTS (
             SELECT 1 FROM supplier_scope_memberships sm
              WHERE sm.tenant_id=r.tenant_id AND sm.public_product_id=pm.product_id
                AND sm.scope_id<>r.scope_id AND sm.state IN ('active','missing')
           )
      ))
    + (SELECT COUNT(*) FROM supplier_sync_stage_product_media pm WHERE pm.run_id=?1)
  )`;
}

function overrideMismatchSql(context) {
  const overrideRelation = Number(context?.schemaVersion || 0) >= 8
    ? 'catalog_product_effective_classification_overrides'
    : 'catalog_product_classification_overrides';
  return `EXISTS (
    SELECT 1
      FROM supplier_sync_stage_classification_state c
      LEFT JOIN ${overrideRelation} o ON o.product_id=c.public_product_id
     WHERE c.run_id=?1 AND (
       c.override_applied<>CASE WHEN o.product_id IS NULL THEN 0 ELSE 1 END
       OR (o.product_id IS NOT NULL AND (
         COALESCE(c.merchant_override_version,0)<>o.override_version
         OR COALESCE(c.merchant_override_updated_at,'')<>COALESCE(o.updated_at,'')
       ))
       OR (o.product_id IS NULL AND c.merchant_override_version IS NOT NULL)
     )
  )`;
}

function candidatePublicLeakSql() {
  return `EXISTS (
    SELECT 1 FROM supplier_sync_stage_product_details d
     WHERE d.run_id=?1 AND (
       ${publicLeak('d.name')} OR ${publicLeak('d.display_name')}
       OR ${publicLeak('d.description')} OR ${publicLeak('d.search_text')}
       OR ${publicLeak('d.category_name')} OR ${publicLeak('d.display_category_name')}
     )
  ) OR EXISTS (
    SELECT 1 FROM supplier_sync_stage_catalog_categories c
     WHERE c.run_id=?1 AND ${publicLeak('c.name')}
  ) OR EXISTS (
    SELECT 1 FROM supplier_sync_stage_teams t
     WHERE t.run_id=?1 AND (${publicLeak('t.name')} OR ${publicLeak('t.short_name')})
  ) OR EXISTS (
    SELECT 1 FROM supplier_sync_stage_leagues l
     WHERE l.run_id=?1 AND ${publicLeak('l.name')}
  ) OR EXISTS (
    SELECT 1 FROM supplier_sync_stage_facets f
     WHERE f.run_id=?1 AND ${publicLeak('f.name')}
  ) OR EXISTS (
    SELECT 1 FROM supplier_sync_stage_intelligence_state i
     WHERE i.run_id=?1 AND (
       lower(i.state_json) LIKE '%x.yupoo.com%'
       OR lower(i.state_json) LIKE '%photo.yupoo.com%'
       OR lower(i.state_json) LIKE '%http://%'
       OR lower(i.state_json) LIKE '%https://%'
     )
  )`;
}

function absenceEventSql() {
  return `EXISTS (
    SELECT 1 FROM supplier_sync_stage_events e
     WHERE e.run_id=?1 AND e.event_type IN ('MISSING','REMOVED')
  )`;
}

function removalPolicyGateSql() {
  return `EXISTS (
    SELECT 1
      FROM supplier_sync_stage_runs r
      JOIN supplier_sync_stage_removal_policy p
        ON p.run_id=r.run_id AND p.tenant_id=r.tenant_id AND p.source_key=r.source_key
     WHERE r.run_id=?1 AND r.tenant_id=?2 AND r.source_key=?3
       AND p.scope_id=r.scope_id AND p.scope_kind=r.scope_kind
       AND p.contract_version=1 AND p.policy_version=1 AND p.removal_threshold>=2
       AND NOT EXISTS (
         SELECT 1 FROM supplier_sync_stage_events e
          WHERE e.run_id=?1 AND e.event_type IN ('MISSING','REMOVED') AND (
            e.needs_detail<>0 OR e.next_miss_count IS NULL OR e.next_miss_count<1
            OR COALESCE(e.reason_code,'')<>'sync_not_observed_authoritative'
            OR (e.event_type='MISSING' AND e.next_miss_count>=p.removal_threshold)
            OR (e.event_type='REMOVED' AND e.next_miss_count<p.removal_threshold)
          )
       )
  )`;
}

function exactPromotingGate() {
  return `EXISTS (
    SELECT 1
      FROM supplier_sync_stage_runs r
      JOIN supplier_sync_stage_authority sa
        ON sa.run_id=r.run_id AND sa.tenant_id=r.tenant_id AND sa.source_key=r.source_key
      JOIN catalog_serving_authority a ON a.tenant_id=r.tenant_id
     WHERE r.run_id=?1 AND r.tenant_id=?2 AND r.source_key=?3
       AND r.state='promoting'
       AND sa.contract_version=1
       AND a.contract_version=1
       AND a.revision=sa.base_authority_revision
  )`;
}

export function buildIncrementalPromotionPreflightBatch({ context }) {
  assertContext(context);
  const params = [context.importId, context.tenantId, context.sourceKey];
  const removalSchema = Number(context.schemaVersion || 0) >= 8;
  return Object.freeze([
    {
      sql: `SELECT r.state, r.safety_outcome, r.verification_code, r.verified_at,
                   r.last_error_code, r.expected_detail_count,
                   sa.base_authority_revision,
                   a.revision AS current_authority_revision,
                   a.last_promoted_run_id, a.last_promoted_source_key
              FROM supplier_sync_stage_runs r
              JOIN supplier_sync_stage_authority sa
                ON sa.run_id=r.run_id AND sa.tenant_id=r.tenant_id AND sa.source_key=r.source_key
              JOIN catalog_serving_authority a ON a.tenant_id=r.tenant_id
             WHERE r.run_id=?1 AND r.tenant_id=?2 AND r.source_key=?3
             LIMIT 1`,
      params
    },
    { sql: `SELECT ${composedProductCountSql(context)} AS total`, params: [context.importId] },
    { sql: `SELECT ${composedMediaCountSql(context)} AS total`, params: [context.importId] },
    {
      sql: `SELECT COUNT(*) AS total FROM supplier_sync_stage_events
             WHERE run_id=?1 AND event_type IN ('MISSING','REMOVED')`,
      params: [context.importId]
    },
    ...(removalSchema
      ? [{ sql: `SELECT CASE WHEN ${removalPolicyGateSql()} THEN 1 ELSE 0 END AS total`, params }]
      : []),
    {
      sql: `SELECT CASE WHEN ${overrideMismatchSql(context)} THEN 1 ELSE 0 END AS total`,
      params: [context.importId]
    },
    {
      sql: `SELECT CASE WHEN ${candidatePublicLeakSql()} THEN 1 ELSE 0 END AS total`,
      params: [context.importId]
    }
  ]);
}

function resultRows(entry) {
  return entry?.results || [];
}

export function parseIncrementalPromotionPreflight(result) {
  const hasRemovalPolicyProbe = Array.isArray(result) && result.length >= 7;
  const overrideIndex = hasRemovalPolicyProbe ? 5 : 4;
  const leakIndex = hasRemovalPolicyProbe ? 6 : 5;
  return Object.freeze({
    run: resultRows(result?.[0])[0] || null,
    composedProducts: Number(resultRows(result?.[1])[0]?.total || 0),
    composedMediaRelationships: Number(resultRows(result?.[2])[0]?.total || 0),
    absenceEvents: Number(resultRows(result?.[3])[0]?.total || 0),
    removalPolicyValid: hasRemovalPolicyProbe
      ? Number(resultRows(result?.[4])[0]?.total || 0)
      : null,
    overrideMismatches: Number(resultRows(result?.[overrideIndex])[0]?.total || 0),
    publicLeakFindings: Number(resultRows(result?.[leakIndex])[0]?.total || 0)
  });
}

export function assessIncrementalPromotionAdmission(preflight, context) {
  const run = preflight?.run || null;
  if (!run) return { allowed: false, code: 'sync_promotion_stage_missing' };
  if (
    run.state === 'promoted' &&
    text(run.last_promoted_run_id) === context.importId &&
    text(run.last_promoted_source_key) === context.sourceKey
  ) {
    return { allowed: false, alreadyComplete: true, code: 'sync_promotion_already_complete' };
  }
  if (run.state !== 'verified') return { allowed: false, code: 'sync_promotion_not_verified' };
  if (
    run.verification_code !== TENANT_INCREMENTAL_PROMOTION_VERIFICATION_CODE ||
    !text(run.verified_at) ||
    run.safety_outcome !== 'proceed' ||
    text(run.last_error_code)
  ) {
    return { allowed: false, code: 'sync_promotion_verification_invalid' };
  }
  if (Number(run.base_authority_revision) !== Number(run.current_authority_revision)) {
    return { allowed: false, code: 'sync_promotion_stale_base' };
  }
  if (preflight.absenceEvents > 0 && Number(context.schemaVersion || 0) < 8) {
    return { allowed: false, code: 'sync_promotion_removal_not_ready' };
  }
  if (Number(context.schemaVersion || 0) >= 8 && Number(preflight.removalPolicyValid || 0) !== 1) {
    return { allowed: false, code: 'sync_promotion_removal_policy_invalid' };
  }
  if (preflight.overrideMismatches > 0) {
    return { allowed: false, code: 'sync_promotion_merchant_override_stale' };
  }
  if (preflight.publicLeakFindings > 0) {
    return { allowed: false, code: 'sync_promotion_public_projection_leak' };
  }
  if (
    preflight.composedProducts < 1 ||
    preflight.composedProducts > TENANT_INCREMENTAL_PROMOTION_MAX_PRODUCTS ||
    preflight.composedMediaRelationships > TENANT_INCREMENTAL_PROMOTION_MAX_MEDIA_RELATIONSHIPS
  ) {
    return { allowed: false, code: 'sync_promotion_envelope_exceeded' };
  }
  return { allowed: true, code: 'sync_promotion_admitted' };
}

export function buildIncrementalPromotionTransaction({ context }) {
  assertContext(context);
  const params = [context.importId, context.tenantId, context.sourceKey];
  const gate = exactPromotingGate();
  const removalSchema = Number(context.schemaVersion || 0) >= 8;
  const removalGate = removalSchema ? removalPolicyGateSql() : `NOT ${absenceEventSql()}`;
  const statements = [
    {
      sql: `UPDATE supplier_sync_stage_runs
               SET state='promoting', updated_at=CURRENT_TIMESTAMP
             WHERE run_id=?1 AND tenant_id=?2 AND source_key=?3
               AND state='verified'
               AND verification_code='${TENANT_INCREMENTAL_PROMOTION_VERIFICATION_CODE}'
               AND verified_at IS NOT NULL
               AND safety_outcome='proceed'
               AND last_error_code IS NULL
               AND EXISTS (
                 SELECT 1
                   FROM supplier_sync_stage_authority sa
                   JOIN catalog_serving_authority a ON a.tenant_id=sa.tenant_id
                  WHERE sa.run_id=?1 AND sa.tenant_id=?2 AND sa.source_key=?3
                    AND sa.contract_version=1 AND a.contract_version=1
                    AND a.revision=sa.base_authority_revision
               )
               AND ${removalGate}
               AND NOT ${overrideMismatchSql(context)}
               AND NOT (${candidatePublicLeakSql()})
               AND ${composedProductCountSql(context)} BETWEEN 1 AND ${TENANT_INCREMENTAL_PROMOTION_MAX_PRODUCTS}
               AND ${composedMediaCountSql(context)} <= ${TENANT_INCREMENTAL_PROMOTION_MAX_MEDIA_RELATIONSHIPS}`,
      params
    },
    {
      sql: `INSERT INTO supplier_category_index
              (tenant_id,source_key,category_source_id,name,parent_source_id,depth,sort_order,updated_at)
            SELECT ?2,?3,c.category_source_id,c.name,c.parent_source_id,c.depth,c.sort_order,CURRENT_TIMESTAMP
              FROM supplier_sync_stage_categories c
             WHERE c.run_id=?1 AND ${gate}
            ON CONFLICT(tenant_id,source_key,category_source_id) DO UPDATE SET
              name=excluded.name,parent_source_id=excluded.parent_source_id,depth=excluded.depth,
              sort_order=excluded.sort_order,updated_at=CURRENT_TIMESTAMP`,
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
                   detail_fingerprint=COALESCE((SELECT d.detail_fingerprint FROM supplier_sync_stage_product_details d WHERE d.run_id=?1 AND d.album_source_id=supplier_album_index.album_source_id AND d.detail_state='complete'),detail_fingerprint),
                   status='active',miss_count=0,last_seen_at=CURRENT_TIMESTAMP,
                   last_changed_at=CASE WHEN EXISTS (SELECT 1 FROM supplier_sync_stage_events e WHERE e.run_id=?1 AND e.album_source_id=supplier_album_index.album_source_id) THEN CURRENT_TIMESTAMP ELSE last_changed_at END,
                   last_detail_at=CASE WHEN EXISTS (SELECT 1 FROM supplier_sync_stage_product_details d WHERE d.run_id=?1 AND d.album_source_id=supplier_album_index.album_source_id AND d.detail_state='complete') THEN CURRENT_TIMESTAMP ELSE last_detail_at END,
                   detail_retry_count=CASE WHEN EXISTS (SELECT 1 FROM supplier_sync_stage_product_details d WHERE d.run_id=?1 AND d.album_source_id=supplier_album_index.album_source_id AND d.detail_state='complete') THEN 0 ELSE detail_retry_count END,
                   detail_retry_after=CASE WHEN EXISTS (SELECT 1 FROM supplier_sync_stage_product_details d WHERE d.run_id=?1 AND d.album_source_id=supplier_album_index.album_source_id AND d.detail_state='complete') THEN NULL ELSE detail_retry_after END,
                   detail_last_error=CASE WHEN EXISTS (SELECT 1 FROM supplier_sync_stage_product_details d WHERE d.run_id=?1 AND d.album_source_id=supplier_album_index.album_source_id AND d.detail_state='complete') THEN NULL ELSE detail_last_error END,
                   updated_at=CURRENT_TIMESTAMP
             WHERE tenant_id=?2 AND source_key=?3 AND ${gate}
               AND EXISTS (SELECT 1 FROM supplier_sync_stage_observations o WHERE o.run_id=?1 AND o.album_source_id=supplier_album_index.album_source_id)`,
      params
    },
    {
      sql: `INSERT INTO supplier_album_index
              (tenant_id,source_key,album_source_id,public_product_id,source_url,source_title,
               source_category_id,source_category_path_json,cover_source_url,image_count_hint,
               listing_fingerprint,detail_fingerprint,status,miss_count,first_seen_at,last_seen_at,
               last_changed_at,last_detail_at,detail_retry_count,updated_at)
            SELECT ?2,?3,o.album_source_id,o.public_product_id,o.source_url,o.source_title,
                   o.source_category_id,o.source_category_path_json,o.cover_source_url,o.image_count_hint,
                   o.listing_fingerprint,d.detail_fingerprint,'active',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,
                   CURRENT_TIMESTAMP,CASE WHEN d.detail_state='complete' THEN CURRENT_TIMESTAMP ELSE NULL END,0,CURRENT_TIMESTAMP
              FROM supplier_sync_stage_observations o
              LEFT JOIN supplier_sync_stage_product_details d
                ON d.run_id=o.run_id AND d.album_source_id=o.album_source_id AND d.public_product_id=o.public_product_id
             WHERE o.run_id=?1 AND ${gate}
               AND NOT EXISTS (SELECT 1 FROM supplier_album_index i WHERE i.tenant_id=?2 AND i.source_key=?3 AND i.album_source_id=o.album_source_id)`,
      params
    },
    ...(removalSchema ? [
      {
        sql: `INSERT INTO supplier_scope_memberships
                (tenant_id,source_key,scope_id,scope_kind,album_source_id,public_product_id,
                 contract_version,removal_policy_version,removal_threshold,state,miss_count,
                 last_observed_run_id,last_progress_run_id,detached_at,updated_at)
              SELECT r.tenant_id,r.source_key,r.scope_id,r.scope_kind,o.album_source_id,o.public_product_id,
                     p.contract_version,p.policy_version,p.removal_threshold,'active',0,?1,?1,NULL,CURRENT_TIMESTAMP
                FROM supplier_sync_stage_observations o
                JOIN supplier_sync_stage_runs r ON r.run_id=o.run_id
                JOIN supplier_sync_stage_removal_policy p ON p.run_id=r.run_id
               WHERE o.run_id=?1 AND ${gate}
              ON CONFLICT(tenant_id,source_key,scope_id,album_source_id) DO UPDATE SET
                public_product_id=excluded.public_product_id,scope_kind=excluded.scope_kind,
                contract_version=excluded.contract_version,removal_policy_version=excluded.removal_policy_version,
                removal_threshold=excluded.removal_threshold,state='active',miss_count=0,
                last_observed_run_id=?1,last_progress_run_id=?1,detached_at=NULL,updated_at=CURRENT_TIMESTAMP`,
        params
      },
      {
        sql: `INSERT INTO supplier_scope_memberships
                (tenant_id,source_key,scope_id,scope_kind,album_source_id,public_product_id,
                 contract_version,removal_policy_version,removal_threshold,state,miss_count,
                 last_progress_run_id,detached_at,updated_at)
              SELECT r.tenant_id,r.source_key,r.scope_id,r.scope_kind,e.album_source_id,e.public_product_id,
                     p.contract_version,p.policy_version,p.removal_threshold,
                     CASE WHEN e.event_type='REMOVED' THEN 'detached' ELSE 'missing' END,
                     e.next_miss_count,?1,
                     CASE WHEN e.event_type='REMOVED' THEN CURRENT_TIMESTAMP ELSE NULL END,CURRENT_TIMESTAMP
                FROM supplier_sync_stage_events e
                JOIN supplier_sync_stage_runs r ON r.run_id=e.run_id
                JOIN supplier_sync_stage_removal_policy p ON p.run_id=r.run_id
               WHERE e.run_id=?1 AND e.event_type IN ('MISSING','REMOVED') AND ${gate}
              ON CONFLICT(tenant_id,source_key,scope_id,album_source_id) DO UPDATE SET
                public_product_id=excluded.public_product_id,scope_kind=excluded.scope_kind,
                contract_version=excluded.contract_version,removal_policy_version=excluded.removal_policy_version,
                removal_threshold=excluded.removal_threshold,state=excluded.state,miss_count=excluded.miss_count,
                last_progress_run_id=?1,detached_at=excluded.detached_at,updated_at=CURRENT_TIMESTAMP`,
        params
      },
      {
        sql: `UPDATE supplier_album_index
                 SET status=CASE
                       WHEN EXISTS (SELECT 1 FROM supplier_scope_memberships sm
                                    WHERE sm.tenant_id=?2 AND sm.public_product_id=supplier_album_index.public_product_id
                                      AND sm.state='active') THEN 'active'
                       WHEN EXISTS (SELECT 1 FROM supplier_scope_memberships sm
                                    WHERE sm.tenant_id=?2 AND sm.public_product_id=supplier_album_index.public_product_id
                                      AND sm.state='missing') THEN 'missing'
                       ELSE 'deleted'
                     END,
                     miss_count=COALESCE((SELECT MAX(sm.miss_count) FROM supplier_scope_memberships sm
                                          WHERE sm.tenant_id=?2 AND sm.public_product_id=supplier_album_index.public_product_id),0),
                     updated_at=CURRENT_TIMESTAMP
               WHERE tenant_id=?2 AND source_key=?3 AND ${gate}
                 AND EXISTS (SELECT 1 FROM supplier_sync_stage_events e
                              WHERE e.run_id=?1 AND e.album_source_id=supplier_album_index.album_source_id
                                AND e.event_type IN ('MISSING','REMOVED'))`,
        params
      }
    ] : []),
    {
      sql: `INSERT INTO catalog_categories
              (category_id,name,parent_id,depth,sort_order,product_count,updated_at)
            SELECT category_id,name,parent_id,depth,sort_order,product_count,CURRENT_TIMESTAMP
              FROM supplier_sync_stage_catalog_categories WHERE run_id=?1 AND ${gate}
            ON CONFLICT(category_id) DO UPDATE SET name=excluded.name,parent_id=excluded.parent_id,
              depth=excluded.depth,sort_order=excluded.sort_order,product_count=excluded.product_count,
              updated_at=CURRENT_TIMESTAMP`,
      params
    },
    {
      sql: `INSERT INTO catalog_leagues
              (league_id,name,country_code,country_name,entity_type,logo_url,sort_order,product_count,updated_at)
            SELECT league_id,name,country_code,country_name,entity_type,logo_url,sort_order,product_count,CURRENT_TIMESTAMP
              FROM supplier_sync_stage_leagues WHERE run_id=?1 AND ${gate}
            ON CONFLICT(league_id) DO UPDATE SET name=excluded.name,country_code=excluded.country_code,
              country_name=excluded.country_name,entity_type=excluded.entity_type,logo_url=excluded.logo_url,
              sort_order=excluded.sort_order,product_count=excluded.product_count,updated_at=CURRENT_TIMESTAMP`,
      params
    },
    {
      sql: `INSERT INTO catalog_teams
              (team_id,name,short_name,league_id,country_code,entity_type,logo_url,initials,sort_order,product_count,updated_at)
            SELECT team_id,name,short_name,league_id,country_code,entity_type,logo_url,initials,sort_order,product_count,CURRENT_TIMESTAMP
              FROM supplier_sync_stage_teams WHERE run_id=?1 AND ${gate}
            ON CONFLICT(team_id) DO UPDATE SET name=excluded.name,short_name=excluded.short_name,
              league_id=excluded.league_id,country_code=excluded.country_code,entity_type=excluded.entity_type,
              logo_url=excluded.logo_url,initials=excluded.initials,sort_order=excluded.sort_order,
              product_count=excluded.product_count,updated_at=CURRENT_TIMESTAMP`,
      params
    },
    {
      sql: `INSERT INTO catalog_facets
              (facet_id,facet_type,name,sort_order,product_count,updated_at)
            SELECT facet_id,facet_type,name,sort_order,product_count,CURRENT_TIMESTAMP
              FROM supplier_sync_stage_facets WHERE run_id=?1 AND ${gate}
            ON CONFLICT(facet_id) DO UPDATE SET facet_type=excluded.facet_type,name=excluded.name,
              sort_order=excluded.sort_order,product_count=excluded.product_count,updated_at=CURRENT_TIMESTAMP`,
      params
    },
    {
      sql: `INSERT INTO media_sources
              (media_id,provider,source_url,display_source_url,thumbnail_source_url,referer_url,active,updated_at)
            SELECT media_id,provider,source_url,display_source_url,thumbnail_source_url,referer_url,active,CURRENT_TIMESTAMP
              FROM supplier_sync_stage_media_sources WHERE run_id=?1 AND ${gate}
            ON CONFLICT(media_id) DO UPDATE SET provider=excluded.provider,source_url=excluded.source_url,
              display_source_url=excluded.display_source_url,thumbnail_source_url=excluded.thumbnail_source_url,
              referer_url=excluded.referer_url,active=excluded.active,updated_at=CURRENT_TIMESTAMP`,
      params
    },
    {
      sql: `INSERT INTO catalog_products
              (product_id,name,search_text,category_id,category_name,description,image_count,
               primary_media_id,sort_order,source_name,display_name,source_category_name,
               display_category_name,team_id,league_id,classification_status,
               classification_confidence,updated_at)
            SELECT public_product_id,name,search_text,category_id,category_name,description,image_count,
                   primary_media_id,sort_order,source_name,display_name,source_category_name,
                   display_category_name,team_id,league_id,classification_status,
                   classification_confidence,CURRENT_TIMESTAMP
              FROM supplier_sync_stage_product_details
             WHERE run_id=?1 AND detail_state='complete' AND ${gate}
            ON CONFLICT(product_id) DO UPDATE SET name=excluded.name,search_text=excluded.search_text,
              category_id=excluded.category_id,category_name=excluded.category_name,
              description=excluded.description,image_count=excluded.image_count,
              primary_media_id=excluded.primary_media_id,sort_order=excluded.sort_order,
              source_name=excluded.source_name,display_name=excluded.display_name,
              source_category_name=excluded.source_category_name,
              display_category_name=excluded.display_category_name,team_id=excluded.team_id,
              league_id=excluded.league_id,classification_status=excluded.classification_status,
              classification_confidence=excluded.classification_confidence,updated_at=CURRENT_TIMESTAMP`,
      params
    },
    ...(removalSchema ? [
      {
        sql: `INSERT INTO catalog_product_classification_override_retention
                (product_id,override_json,override_version,original_created_at,original_updated_at,
                 retained_by_run_id,retained_at,updated_at)
              SELECT o.product_id,o.override_json,o.override_version,o.created_at,o.updated_at,
                     ?1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
                FROM catalog_product_classification_overrides o
                JOIN supplier_sync_stage_events e ON e.public_product_id=o.product_id
                JOIN supplier_sync_stage_runs r ON r.run_id=e.run_id
               WHERE e.run_id=?1 AND e.event_type='REMOVED' AND ${gate}
                 AND NOT EXISTS (SELECT 1 FROM supplier_scope_memberships sm
                                  WHERE sm.tenant_id=r.tenant_id AND sm.public_product_id=e.public_product_id
                                    AND sm.state IN ('active','missing'))
              ON CONFLICT(product_id) DO UPDATE SET
                override_json=excluded.override_json,override_version=excluded.override_version,
                original_created_at=excluded.original_created_at,original_updated_at=excluded.original_updated_at,
                retained_by_run_id=excluded.retained_by_run_id,retained_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`,
        params
      },
      {
        sql: `DELETE FROM catalog_products
               WHERE ${gate}
                 AND EXISTS (
                   SELECT 1 FROM supplier_sync_stage_events e
                   JOIN supplier_sync_stage_runs r ON r.run_id=e.run_id
                    WHERE e.run_id=?1 AND e.event_type='REMOVED'
                      AND e.public_product_id=catalog_products.product_id
                      AND NOT EXISTS (SELECT 1 FROM supplier_scope_memberships sm
                                      WHERE sm.tenant_id=r.tenant_id AND sm.public_product_id=e.public_product_id
                                        AND sm.state IN ('active','missing'))
                 )`,
        params
      },
      {
        sql: `INSERT INTO catalog_product_classification_overrides
                (product_id,override_json,override_version,created_at,updated_at)
              SELECT retained.product_id,retained.override_json,retained.override_version,
                     retained.original_created_at,retained.original_updated_at
                FROM catalog_product_classification_override_retention retained
               WHERE ${gate}
                 AND EXISTS (SELECT 1 FROM catalog_products p WHERE p.product_id=retained.product_id)
                 AND EXISTS (SELECT 1 FROM supplier_sync_stage_events e
                              WHERE e.run_id=?1 AND e.public_product_id=retained.product_id
                                AND e.event_type='RESTORED')
              ON CONFLICT(product_id) DO UPDATE SET
                override_json=excluded.override_json,override_version=excluded.override_version,
                updated_at=excluded.updated_at
              WHERE excluded.override_version>=catalog_product_classification_overrides.override_version`,
        params
      },
      {
        sql: `DELETE FROM catalog_product_classification_override_retention
               WHERE ${gate}
                 AND EXISTS (SELECT 1 FROM supplier_sync_stage_events e
                              WHERE e.run_id=?1
                                AND e.public_product_id=catalog_product_classification_override_retention.product_id
                                AND e.event_type='RESTORED')
                 AND EXISTS (SELECT 1 FROM catalog_product_classification_overrides o
                              WHERE o.product_id=catalog_product_classification_override_retention.product_id
                                AND o.override_version>=catalog_product_classification_override_retention.override_version)`,
        params
      }
    ] : []),
    {
      sql: `DELETE FROM product_media
             WHERE ${gate} AND product_id IN (
               SELECT public_product_id FROM supplier_sync_stage_product_details WHERE run_id=?1
             )`,
      params
    },
    {
      sql: `INSERT INTO product_media (product_id,media_id,position,created_at,updated_at)
            SELECT public_product_id,media_id,position,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
              FROM supplier_sync_stage_product_media WHERE run_id=?1 AND ${gate}`,
      params
    },
    {
      sql: `DELETE FROM catalog_product_categories
             WHERE ${gate} AND product_id IN (
               SELECT public_product_id FROM supplier_sync_stage_product_details WHERE run_id=?1
             )`,
      params
    },
    {
      sql: `INSERT INTO catalog_product_categories (product_id,category_id)
            SELECT public_product_id,category_id
              FROM supplier_sync_stage_product_categories WHERE run_id=?1 AND ${gate}`,
      params
    },
    {
      sql: `DELETE FROM catalog_product_facets
             WHERE ${gate} AND product_id IN (
               SELECT public_product_id FROM supplier_sync_stage_product_details WHERE run_id=?1
             )`,
      params
    },
    {
      sql: `INSERT INTO catalog_product_facets (product_id,facet_id)
            SELECT public_product_id,facet_id
              FROM supplier_sync_stage_product_facets WHERE run_id=?1 AND ${gate}`,
      params
    },
    {
      sql: `INSERT INTO catalog_product_classification_state
              (product_id,classifier_version,classifier_key,override_applied,classified_at,updated_at)
            SELECT public_product_id,classifier_version,classifier_key,override_applied,classified_at,CURRENT_TIMESTAMP
              FROM supplier_sync_stage_classification_state WHERE run_id=?1 AND ${gate}
            ON CONFLICT(product_id) DO UPDATE SET classifier_version=excluded.classifier_version,
              classifier_key=excluded.classifier_key,override_applied=excluded.override_applied,
              classified_at=excluded.classified_at,updated_at=CURRENT_TIMESTAMP`,
      params
    },
    {
      sql: `INSERT INTO catalog_product_intelligence_state
              (product_id,contract_version,evidence_schema_version,classifier_version,classifier_key,
               knowledge_pack_key,knowledge_pack_version,domain_id,domain_confidence,
               domain_knowledge_state,knowledge_state,override_applied,review_required,research_required,
               conflict_count,state_json,classified_at,updated_at)
            SELECT public_product_id,contract_version,evidence_schema_version,classifier_version,classifier_key,
                   knowledge_pack_key,knowledge_pack_version,domain_id,domain_confidence,
                   domain_knowledge_state,knowledge_state,override_applied,review_required,research_required,
                   conflict_count,state_json,classified_at,CURRENT_TIMESTAMP
              FROM supplier_sync_stage_intelligence_state WHERE run_id=?1 AND ${gate}
            ON CONFLICT(product_id) DO UPDATE SET contract_version=excluded.contract_version,
              evidence_schema_version=excluded.evidence_schema_version,
              classifier_version=excluded.classifier_version,classifier_key=excluded.classifier_key,
              knowledge_pack_key=excluded.knowledge_pack_key,knowledge_pack_version=excluded.knowledge_pack_version,
              domain_id=excluded.domain_id,domain_confidence=excluded.domain_confidence,
              domain_knowledge_state=excluded.domain_knowledge_state,knowledge_state=excluded.knowledge_state,
              override_applied=excluded.override_applied,review_required=excluded.review_required,
              research_required=excluded.research_required,conflict_count=excluded.conflict_count,
              state_json=excluded.state_json,classified_at=excluded.classified_at,updated_at=CURRENT_TIMESTAMP`,
      params
    },
    {
      sql: `INSERT INTO catalog_meta (key,value_json,updated_at)
            SELECT key,value_json,CURRENT_TIMESTAMP
              FROM supplier_sync_stage_catalog_meta WHERE run_id=?1 AND ${gate}
            ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=CURRENT_TIMESTAMP`,
      params
    },
    {
      sql: `UPDATE catalog_categories
               SET product_count=(SELECT COUNT(*) FROM catalog_product_categories pc WHERE pc.category_id=catalog_categories.category_id),
                   updated_at=CURRENT_TIMESTAMP
             WHERE ${gate}`,
      params
    },
    {
      sql: `UPDATE catalog_teams
               SET product_count=(SELECT COUNT(*) FROM catalog_products p WHERE p.team_id=catalog_teams.team_id),
                   updated_at=CURRENT_TIMESTAMP
             WHERE ${gate}`,
      params
    },
    {
      sql: `UPDATE catalog_leagues
               SET product_count=(SELECT COUNT(*) FROM catalog_products p WHERE p.league_id=catalog_leagues.league_id),
                   updated_at=CURRENT_TIMESTAMP
             WHERE ${gate}`,
      params
    },
    {
      sql: `UPDATE catalog_facets
               SET product_count=(SELECT COUNT(*) FROM catalog_product_facets pf WHERE pf.facet_id=catalog_facets.facet_id),
                   updated_at=CURRENT_TIMESTAMP
             WHERE ${gate}`,
      params
    },
    {
      sql: `DELETE FROM media_sources
             WHERE ${gate} AND NOT EXISTS (SELECT 1 FROM product_media pm WHERE pm.media_id=media_sources.media_id)`,
      params
    },
    { sql: `DELETE FROM supplier_sync_events WHERE run_id=?1 AND ${gate}`, params },
    {
      sql: `INSERT INTO supplier_sync_events
              (run_id,tenant_id,source_key,album_source_id,public_product_id,event_type,needs_detail,created_at)
            SELECT ?1,?2,?3,e.album_source_id,e.public_product_id,e.event_type,e.needs_detail,CURRENT_TIMESTAMP
              FROM supplier_sync_stage_events e WHERE e.run_id=?1 AND ${gate}`,
      params
    },
    {
      sql: `UPDATE supplier_sources
               SET last_scan_at=CURRENT_TIMESTAMP,last_success_at=CURRENT_TIMESTAMP,last_error=NULL,
                   updated_at=CURRENT_TIMESTAMP
             WHERE tenant_id=?2 AND source_key=?3 AND ${gate}`,
      params
    },
    {
      sql: `UPDATE supplier_sync_runs
               SET status='success',finished_at=CURRENT_TIMESTAMP,error_text=NULL
             WHERE run_id=?1 AND tenant_id=?2 AND source_key=?3 AND status='running' AND ${gate}`,
      params
    },
    {
      sql: `UPDATE catalog_serving_authority
               SET revision=revision+1,last_promoted_run_id=?1,last_promoted_source_key=?3,
                   promoted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
             WHERE tenant_id=?2
               AND revision=(SELECT base_authority_revision FROM supplier_sync_stage_authority WHERE run_id=?1 AND tenant_id=?2 AND source_key=?3)
               AND ${gate}`,
      params
    },
    {
      sql: `UPDATE supplier_sync_stage_runs
               SET state='promoted',promoted_at=COALESCE(promoted_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP
             WHERE run_id=?1 AND tenant_id=?2 AND source_key=?3 AND state='promoting'
               AND EXISTS (
                 SELECT 1 FROM supplier_sync_stage_authority sa
                 JOIN catalog_serving_authority a ON a.tenant_id=sa.tenant_id
                WHERE sa.run_id=?1 AND sa.tenant_id=?2 AND sa.source_key=?3
                  AND a.last_promoted_run_id=?1 AND a.last_promoted_source_key=?3
                  AND a.revision=sa.base_authority_revision+1
               )`,
      params
    },
    {
      sql: `SELECT r.state,r.promoted_at,r.verification_code,
                   a.revision AS authority_revision,a.last_promoted_run_id,a.last_promoted_source_key
              FROM supplier_sync_stage_runs r
              JOIN catalog_serving_authority a ON a.tenant_id=r.tenant_id
             WHERE r.run_id=?1 AND r.tenant_id=?2 AND r.source_key=?3 LIMIT 1`,
      params
    }
  ];

  validatePromotionTransactionShape(statements);
  return Object.freeze(statements.map((statement) => Object.freeze(statement)));
}

function boundParameterCount(statement) {
  return new Set(String(statement.sql).match(/\?\d+/g) || []).size;
}

export function validatePromotionTransactionShape(statements) {
  if (!Array.isArray(statements) || statements.length > TENANT_INCREMENTAL_PROMOTION_MAX_STATEMENTS) {
    throw new Error('sync_promotion_statement_envelope_exceeded');
  }
  const encoder = new TextEncoder();
  for (const statement of statements) {
    if (encoder.encode(String(statement.sql || '')).byteLength > TENANT_INCREMENTAL_PROMOTION_MAX_SQL_BYTES) {
      throw new Error('sync_promotion_sql_envelope_exceeded');
    }
    if (boundParameterCount(statement) > TENANT_INCREMENTAL_PROMOTION_MAX_BOUND_PARAMS) {
      throw new Error('sync_promotion_parameter_envelope_exceeded');
    }
  }
  return true;
}

function tenantRequest(context, platform, batch, queryBatch, fetchImpl) {
  return queryBatch(
    {
      ...platform,
      tenantId: context.tenantId,
      databaseId: context.dataPlane.databaseId,
      batch
    },
    { fetchImpl }
  );
}

export async function processTenantIncrementalPromotion(
  env,
  context,
  { queryBatch = queryD1Batch, fetchImpl = fetch } = {}
) {
  assertContext(context);
  const platform = {
    ...ingestionPlatformConfig(env, context.dataPlane.dispatchNamespace),
    tenantId: context.tenantId
  };
  const preflightResult = await tenantRequest(
    context,
    platform,
    buildIncrementalPromotionPreflightBatch({ context }),
    queryBatch,
    fetchImpl
  );
  const preflight = parseIncrementalPromotionPreflight(preflightResult);
  const admission = assessIncrementalPromotionAdmission(preflight, context);
  if (admission.alreadyComplete) {
    return {
      outcome: 'success',
      alreadyComplete: true,
      authorityRevision: Number(preflight.run.current_authority_revision || 0)
    };
  }
  if (!admission.allowed) {
    return { outcome: 'failed', error: admission.code };
  }

  try {
    const result = await tenantRequest(
      context,
      platform,
      buildIncrementalPromotionTransaction({ context }),
      queryBatch,
      fetchImpl
    );
    const finalRow = resultRows(result?.[result.length - 1])[0] || null;
    if (
      finalRow?.state === 'promoted' &&
      text(finalRow.last_promoted_run_id) === context.importId &&
      text(finalRow.last_promoted_source_key) === context.sourceKey
    ) {
      return {
        outcome: 'success',
        alreadyComplete: false,
        stageState: 'promoted',
        authorityRevision: Number(finalRow.authority_revision || 0)
      };
    }
    return { outcome: 'failed', error: 'sync_promotion_authority_conflict' };
  } catch {
    return { outcome: 'failed', error: 'sync_promotion_transaction_failed' };
  }
}
