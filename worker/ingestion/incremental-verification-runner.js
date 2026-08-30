import { CEI_INTELLIGENCE_STATE_CONTRACT_VERSION } from '../../src/catalog-intelligence/core/intelligence-state.js';
import { CEI_MERCHANDISING_CONTRACT_VERSION } from '../../src/catalog-intelligence/core/merchandising.js';
import { SPORTS_KNOWLEDGE_PACK } from '../../src/catalog-intelligence/domains/sports/knowledge-pack.js';
import {
  CATALOG_CLASSIFIER_KEY,
  CATALOG_CLASSIFIER_VERSION
} from '../../src/domain/catalog-classifier.js';
import { buildSportsMerchandisingState } from '../cei-merchandising-persistence.js';
import { queryD1Batch } from '../cloudflare-platform.js';
import {
  claimTenantSyncPhaseLease,
  failTenantSyncPhaseLease,
  releaseTenantSyncPhaseLease
} from '../tenant-sync-phase-lease.js';
import {
  TenantImportContextError,
  ingestionPlatformConfig,
  loadTenantImportContext
} from './context.js';

const DEFAULT_LIMIT = 2;
const MAX_LIMIT = 5;
const VERIFICATION_CODE = 'sync_candidate_verified_v1';
const MAX_FINDINGS = 32;

function boundedLimit(value) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function platformRuntimeConfigured(env) {
  if (env?.TENANT_DISPATCH && typeof env.TENANT_DISPATCH.get === 'function') return true;
  const accountId = String(env?.CLOUDFLARE_PLATFORM_ACCOUNT_ID || '').trim();
  const apiToken = String(env?.CLOUDFLARE_PLATFORM_API_TOKEN || '').trim();
  return /^[a-f0-9]{32}$/i.test(accountId) && apiToken.length >= 20;
}

function safeVerificationError(error) {
  if (error instanceof TenantImportContextError) return error.code;
  const value = String(error?.code || error?.message || error || '').trim();
  if (/^(tenant|sync|cei|catalog_provider)_[a-z0-9_]+$/i.test(value)) return value.slice(0, 120);
  return 'sync_candidate_verification_failed';
}

function verificationFailureCode(findings) {
  const first = String(findings?.[0] || 'findings')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .slice(0, 72);
  return `sync_candidate_verify_${first || 'findings'}`.slice(0, 120);
}

async function discoverCandidateJobs(db, limit) {
  const result = await db
    .prepare(
      `SELECT j.import_id, j.tenant_id, j.source_key, j.state_revision
         FROM tenant_import_jobs j
         JOIN tenant_catalog_instances i ON i.tenant_id=j.tenant_id
         JOIN tenant_data_plane_provider_state p ON p.tenant_id=j.tenant_id
        WHERE j.mode='incremental'
          AND j.status='details'
          AND j.phase='details'
          AND j.completed_detail_count=j.discovered_count
          AND j.failed_detail_count=0
          AND j.deferred_detail_count=0
          AND j.candidate_classified_at IS NOT NULL
          AND (j.phase_lease_token IS NULL OR j.phase_lease_until<=CURRENT_TIMESTAMP)
          AND i.status='ready'
          AND i.schema_version >= 6
          AND p.database_status='active'
          AND p.worker_status='active'
          AND p.d1_database_id IS NOT NULL
        ORDER BY j.updated_at ASC, j.created_at ASC
        LIMIT ?1`
    )
    .bind(limit)
    .all();
  return result.results || [];
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

function globalRemovalEventSql(context, alias = 'e') {
  if (Number(context?.schemaVersion || 0) < 8) return `${alias}.event_type='REMOVED'`;
  return `(${alias}.event_type='REMOVED' AND NOT EXISTS (
    SELECT 1 FROM supplier_scope_memberships sm
    JOIN supplier_sync_stage_runs sr ON sr.run_id=${alias}.run_id
     WHERE sm.tenant_id=sr.tenant_id
       AND sm.public_product_id=${alias}.public_product_id
       AND sm.scope_id<>sr.scope_id
       AND sm.state IN ('active','missing')
  ))`;
}

async function loadReadiness(context, platform, queryBatch, fetchImpl) {
  const result = await tenantRequest(
    context,
    platform,
    [
      {
        sql: `SELECT state, safety_outcome, scan_complete, disqualifying_failure_count,
                     observed_count, staged_observation_count,
                     expected_event_count, staged_event_count, staged_category_count,
                     expected_detail_count, verification_code, last_error_code
                FROM supplier_sync_stage_runs
               WHERE run_id=?1 AND tenant_id=?2 AND source_key=?3
               LIMIT 1`,
        params: [context.importId, context.tenantId, context.sourceKey]
      },
      {
        sql: `SELECT COUNT(*) AS total
                FROM supplier_sync_stage_product_details
               WHERE run_id=?1 AND detail_state='complete'`,
        params: [context.importId]
      },
      {
        sql: `SELECT COUNT(*) AS total
                FROM supplier_sync_stage_classification_state
               WHERE run_id=?1 AND classifier_version=?2 AND classifier_key=?3`,
        params: [context.importId, CATALOG_CLASSIFIER_VERSION, CATALOG_CLASSIFIER_KEY]
      },
      {
        sql: `SELECT COUNT(*) AS total
                FROM supplier_sync_stage_intelligence_state
               WHERE run_id=?1
                 AND contract_version=?2
                 AND classifier_version=?3
                 AND classifier_key=?4
                 AND json_valid(state_json)=1`,
        params: [
          context.importId,
          CEI_INTELLIGENCE_STATE_CONTRACT_VERSION,
          CATALOG_CLASSIFIER_VERSION,
          CATALOG_CLASSIFIER_KEY
        ]
      }
    ],
    queryBatch,
    fetchImpl
  );
  return {
    run: result[0]?.results?.[0] || null,
    completeDetails: Number(result[1]?.results?.[0]?.total || 0),
    currentClassification: Number(result[2]?.results?.[0]?.total || 0),
    currentIntelligence: Number(result[3]?.results?.[0]?.total || 0)
  };
}

async function refreshCandidateDerivedCounts(context, platform, queryBatch, fetchImpl) {
  await tenantRequest(
    context,
    platform,
    [
      {
        sql: `UPDATE supplier_sync_stage_catalog_categories
                 SET product_count=(
                   SELECT COUNT(*)
                     FROM supplier_sync_stage_product_categories pc
                    WHERE pc.run_id=?1
                      AND pc.category_id=supplier_sync_stage_catalog_categories.category_id
                 ), updated_at=CURRENT_TIMESTAMP
               WHERE run_id=?1
                 AND EXISTS (
                   SELECT 1 FROM supplier_sync_stage_runs r
                    WHERE r.run_id=?1 AND r.tenant_id=?2 AND r.source_key=?3
                      AND r.state IN ('planned','details_complete','verified')
                 )`,
        params: [context.importId, context.tenantId, context.sourceKey]
      },
      {
        sql: `UPDATE supplier_sync_stage_leagues
                 SET product_count=(
                   SELECT COUNT(*)
                     FROM supplier_sync_stage_product_details d
                    WHERE d.run_id=?1
                      AND d.detail_state='complete'
                      AND d.league_id=supplier_sync_stage_leagues.league_id
                 ), updated_at=CURRENT_TIMESTAMP
               WHERE run_id=?1`,
        params: [context.importId]
      },
      {
        sql: `UPDATE supplier_sync_stage_teams
                 SET product_count=(
                   SELECT COUNT(*)
                     FROM supplier_sync_stage_product_details d
                    WHERE d.run_id=?1
                      AND d.detail_state='complete'
                      AND d.team_id=supplier_sync_stage_teams.team_id
                 ), updated_at=CURRENT_TIMESTAMP
               WHERE run_id=?1`,
        params: [context.importId]
      },
      {
        sql: `UPDATE supplier_sync_stage_facets
                 SET product_count=(
                   SELECT COUNT(*)
                     FROM supplier_sync_stage_product_facets pf
                    WHERE pf.run_id=?1
                      AND pf.facet_id=supplier_sync_stage_facets.facet_id
                 ), updated_at=CURRENT_TIMESTAMP
               WHERE run_id=?1`,
        params: [context.importId]
      }
    ],
    queryBatch,
    fetchImpl
  );
}

function addRowsToMap(target, rows, keyField) {
  for (const row of rows || []) {
    const key = String(row?.[keyField] || '').trim();
    if (!key) continue;
    target.set(key, (target.get(key) || 0) + Math.max(0, Number(row.total || 0)));
  }
}

async function persistProposedMerchandising(context, platform, queryBatch, fetchImpl) {
  const globalRemoval = globalRemovalEventSql(context);
  const result = await tenantRequest(
    context,
    platform,
    [
      {
        sql: `SELECT t.entity_type, COUNT(*) AS total
                FROM catalog_products p
                JOIN catalog_teams t ON t.team_id=p.team_id
               WHERE NOT EXISTS (
                 SELECT 1 FROM supplier_sync_stage_events e
                  WHERE e.run_id=?1 AND e.public_product_id=p.product_id
                    AND (e.needs_detail=1 OR ${globalRemoval})
               )
               GROUP BY t.entity_type`,
        params: [context.importId]
      },
      {
        sql: `SELECT t.entity_type, COUNT(*) AS total
                FROM supplier_sync_stage_product_details d
                JOIN supplier_sync_stage_teams t
                  ON t.run_id=d.run_id AND t.team_id=d.team_id
               WHERE d.run_id=?1 AND d.detail_state='complete'
               GROUP BY t.entity_type`,
        params: [context.importId]
      },
      {
        sql: `SELECT f.facet_id, COUNT(*) AS total
                FROM catalog_product_facets pf
                JOIN catalog_facets f ON f.facet_id=pf.facet_id
               WHERE NOT EXISTS (
                 SELECT 1 FROM supplier_sync_stage_events e
                  WHERE e.run_id=?1 AND e.public_product_id=pf.product_id
                    AND (e.needs_detail=1 OR ${globalRemoval})
               )
               GROUP BY f.facet_id`,
        params: [context.importId]
      },
      {
        sql: `SELECT pf.facet_id, COUNT(*) AS total
                FROM supplier_sync_stage_product_facets pf
               WHERE pf.run_id=?1
               GROUP BY pf.facet_id`,
        params: [context.importId]
      }
    ],
    queryBatch,
    fetchImpl
  );

  const counts = { entityTypes: new Map(), facets: new Map() };
  addRowsToMap(counts.entityTypes, result[0]?.results || [], 'entity_type');
  addRowsToMap(counts.entityTypes, result[1]?.results || [], 'entity_type');
  addRowsToMap(counts.facets, result[2]?.results || [], 'facet_id');
  addRowsToMap(counts.facets, result[3]?.results || [], 'facet_id');
  const state = buildSportsMerchandisingState(counts);
  const navigationJson = JSON.stringify(state.navigation);
  const merchandisingJson = JSON.stringify({
    contractVersion: state.contractVersion,
    knowledgePackKey: state.knowledgePackKey,
    knowledgePackVersion: state.knowledgePackVersion,
    domain: state.domain,
    fallbackUsed: state.fallbackUsed,
    navigationItems: state.navigation.length,
    projection: 'candidate-composed-v1'
  });

  await tenantRequest(
    context,
    platform,
    [
      {
        sql: `INSERT INTO supplier_sync_stage_catalog_meta
                (run_id, key, value_json, updated_at)
              SELECT ?1, 'navigation', ?4, CURRENT_TIMESTAMP
               WHERE EXISTS (
                 SELECT 1 FROM supplier_sync_stage_runs r
                  WHERE r.run_id=?1 AND r.tenant_id=?2 AND r.source_key=?3
                    AND r.state IN ('planned','details_complete','verified')
               )
              ON CONFLICT(run_id,key) DO UPDATE SET
                value_json=excluded.value_json, updated_at=CURRENT_TIMESTAMP`,
        params: [context.importId, context.tenantId, context.sourceKey, navigationJson]
      },
      {
        sql: `INSERT INTO supplier_sync_stage_catalog_meta
                (run_id, key, value_json, updated_at)
              SELECT ?1, 'merchandising', ?4, CURRENT_TIMESTAMP
               WHERE EXISTS (
                 SELECT 1 FROM supplier_sync_stage_runs r
                  WHERE r.run_id=?1 AND r.tenant_id=?2 AND r.source_key=?3
                    AND r.state IN ('planned','details_complete','verified')
               )
              ON CONFLICT(run_id,key) DO UPDATE SET
                value_json=excluded.value_json, updated_at=CURRENT_TIMESTAMP`,
        params: [context.importId, context.tenantId, context.sourceKey, merchandisingJson]
      }
    ],
    queryBatch,
    fetchImpl
  );
  return {
    navigationItems: state.navigation.length,
    fallbackUsed: state.fallbackUsed,
    knowledgePackKey: state.knowledgePackKey,
    knowledgePackVersion: state.knowledgePackVersion,
    merchandisingContractVersion: state.contractVersion
  };
}

function metricSpecs(context) {
  const runId = context.importId;
  const tenantId = context.tenantId;
  const sourceKey = context.sourceKey;
  const removalSchema = Number(context.schemaVersion || 0) >= 8;
  const overrideRelation = removalSchema
    ? 'catalog_product_effective_classification_overrides'
    : 'catalog_product_classification_overrides';
  const globalRemoval = globalRemovalEventSql(context);
  const publicLeak = (expression) => `(
    lower(COALESCE(${expression},'')) LIKE '%x.yupoo.com%'
    OR lower(COALESCE(${expression},'')) LIKE '%photo.yupoo.com%'
    OR lower(COALESCE(${expression},'')) LIKE '%http://%'
    OR lower(COALESCE(${expression},'')) LIKE '%https://%'
  )`;

  return [
    ['observations', `SELECT COUNT(*) AS total FROM supplier_sync_stage_observations WHERE run_id=?1`, [runId]],
    ['events', `SELECT COUNT(*) AS total FROM supplier_sync_stage_events WHERE run_id=?1`, [runId]],
    ['sourceCategories', `SELECT COUNT(*) AS total FROM supplier_sync_stage_categories WHERE run_id=?1`, [runId]],
    ['detailEvents', `SELECT COUNT(*) AS total FROM supplier_sync_stage_events WHERE run_id=?1 AND needs_detail=1`, [runId]],
    ['details', `SELECT COUNT(*) AS total FROM supplier_sync_stage_product_details WHERE run_id=?1`, [runId]],
    ['completeDetails', `SELECT COUNT(*) AS total FROM supplier_sync_stage_product_details WHERE run_id=?1 AND detail_state='complete'`, [runId]],
    ['classification', `SELECT COUNT(*) AS total FROM supplier_sync_stage_classification_state WHERE run_id=?1`, [runId]],
    ['intelligence', `SELECT COUNT(*) AS total FROM supplier_sync_stage_intelligence_state WHERE run_id=?1`, [runId]],
    ['duplicateObservationProducts', `SELECT COUNT(*) AS total FROM (
       SELECT public_product_id FROM supplier_sync_stage_observations
        WHERE run_id=?1 GROUP BY public_product_id HAVING COUNT(*)>1
     )`, [runId]],
    ['duplicateEventProducts', `SELECT COUNT(*) AS total FROM (
       SELECT public_product_id FROM supplier_sync_stage_events
        WHERE run_id=?1 GROUP BY public_product_id HAVING COUNT(*)>1
     )`, [runId]],
    ['observedEventMissingObservation', `SELECT COUNT(*) AS total
       FROM supplier_sync_stage_events e
       LEFT JOIN supplier_sync_stage_observations o
         ON o.run_id=e.run_id AND o.album_source_id=e.album_source_id
        AND o.public_product_id=e.public_product_id
      WHERE e.run_id=?1
        AND e.event_type IN ('NEW','CHANGED','CHANGED_MOVED','MOVED','RESTORED')
        AND o.album_source_id IS NULL`, [runId]],
    ['absenceHasObservation', `SELECT COUNT(*) AS total
       FROM supplier_sync_stage_events e
      WHERE e.run_id=?1 AND e.event_type IN ('MISSING','REMOVED')
        AND EXISTS (
          SELECT 1 FROM supplier_sync_stage_observations o
           WHERE o.run_id=e.run_id AND o.album_source_id=e.album_source_id
        )`, [runId]],
    ['newIdentityConflict', `SELECT COUNT(*) AS total
       FROM supplier_sync_stage_events e
      WHERE e.run_id=?1 AND e.event_type='NEW'
        AND EXISTS (
          SELECT 1 FROM supplier_album_index i
           WHERE i.tenant_id=?2 AND i.source_key=?3 AND i.album_source_id=e.album_source_id
        )`, [runId, tenantId, sourceKey]],
    ['existingIdentityMissing', `SELECT COUNT(*) AS total
       FROM supplier_sync_stage_events e
      WHERE e.run_id=?1
        AND e.event_type IN ('CHANGED','CHANGED_MOVED','MOVED','RESTORED','MISSING','REMOVED')
        AND NOT EXISTS (
          SELECT 1 FROM supplier_album_index i
           WHERE i.tenant_id=?2 AND i.source_key=?3
             AND i.album_source_id=e.album_source_id
             AND i.public_product_id=e.public_product_id
        )`, [runId, tenantId, sourceKey]],
    ['observationIdentityMismatch', `SELECT COUNT(*) AS total
       FROM supplier_sync_stage_observations o
      WHERE o.run_id=?1 AND (
        EXISTS (
          SELECT 1 FROM supplier_album_index i
           WHERE i.tenant_id=?2 AND i.source_key=?3
             AND i.album_source_id=o.album_source_id
             AND i.public_product_id<>o.public_product_id
        ) OR (
          NOT EXISTS (
            SELECT 1 FROM supplier_album_index i
             WHERE i.tenant_id=?2 AND i.source_key=?3 AND i.album_source_id=o.album_source_id
          ) AND NOT EXISTS (
            SELECT 1 FROM supplier_sync_stage_events e
             WHERE e.run_id=o.run_id AND e.album_source_id=o.album_source_id
               AND e.public_product_id=o.public_product_id AND e.event_type='NEW'
          )
        )
      )`, [runId, tenantId, sourceKey]],
    ['eventDetailSemantics', `SELECT COUNT(*) AS total
       FROM supplier_sync_stage_events
      WHERE run_id=?1
        AND needs_detail<>CASE
          WHEN event_type IN ('NEW','CHANGED','CHANGED_MOVED','RESTORED') THEN 1 ELSE 0 END`, [runId]],
    ['absenceSemantics', `SELECT COUNT(*) AS total
       FROM supplier_sync_stage_events
      WHERE run_id=?1 AND event_type IN ('MISSING','REMOVED')
        AND (needs_detail<>0 OR next_miss_count IS NULL OR next_miss_count<1
             OR COALESCE(reason_code,'')<>'sync_not_observed_authoritative')`, [runId]],
    ...(removalSchema ? [
      ['removalPolicyValid', `SELECT COUNT(*) AS total
         FROM supplier_sync_stage_removal_policy p
         JOIN supplier_sync_stage_runs r ON r.run_id=p.run_id
        WHERE p.run_id=?1 AND p.tenant_id=?2 AND p.source_key=?3
          AND p.scope_id=r.scope_id AND p.scope_kind=r.scope_kind
          AND p.contract_version=1 AND p.policy_version=1 AND p.removal_threshold>=2`,
        [runId, tenantId, sourceKey]],
      ['removalSemantics', `SELECT COUNT(*) AS total
         FROM supplier_sync_stage_events e
         JOIN supplier_sync_stage_removal_policy p ON p.run_id=e.run_id
        WHERE e.run_id=?1 AND e.event_type IN ('MISSING','REMOVED') AND (
          (e.event_type='MISSING' AND e.next_miss_count>=p.removal_threshold)
          OR (e.event_type='REMOVED' AND e.next_miss_count<p.removal_threshold)
        )`, [runId]]
    ] : []),
    ['extraneousDetails', `SELECT COUNT(*) AS total
       FROM supplier_sync_stage_product_details d
      WHERE d.run_id=?1 AND NOT EXISTS (
        SELECT 1 FROM supplier_sync_stage_events e
         WHERE e.run_id=d.run_id AND e.public_product_id=d.public_product_id
           AND e.album_source_id=d.album_source_id AND e.needs_detail=1
      )`, [runId]],
    ['missingDetails', `SELECT COUNT(*) AS total
       FROM supplier_sync_stage_events e
      WHERE e.run_id=?1 AND e.needs_detail=1 AND NOT EXISTS (
        SELECT 1 FROM supplier_sync_stage_product_details d
         WHERE d.run_id=e.run_id AND d.public_product_id=e.public_product_id
           AND d.album_source_id=e.album_source_id AND d.detail_state='complete'
      )`, [runId]],
    ['invalidProductIds', `SELECT COUNT(*) AS total
       FROM supplier_sync_stage_observations o
      WHERE o.run_id=?1 AND (
        length(o.public_product_id)<>22 OR substr(o.public_product_id,1,2)<>'p_'
        OR substr(o.public_product_id,3) GLOB '*[^0-9a-f]*'
      )`, [runId]],
    ['invalidCategoryIds', `SELECT COUNT(*) AS total
       FROM supplier_sync_stage_catalog_categories c
      WHERE c.run_id=?1 AND (
        length(c.category_id)<>22 OR substr(c.category_id,1,2)<>'c_'
        OR substr(c.category_id,3) GLOB '*[^0-9a-f]*'
      )`, [runId]],
    ['invalidMediaIds', `SELECT COUNT(*) AS total
       FROM supplier_sync_stage_media_sources m
      WHERE m.run_id=?1 AND (
        length(m.media_id)<>22 OR substr(m.media_id,1,2)<>'m_'
        OR substr(m.media_id,3) GLOB '*[^0-9a-f]*'
      )`, [runId]],
    ['candidatePublicLeaks', `SELECT COUNT(*) AS total
       FROM supplier_sync_stage_product_details d
      WHERE d.run_id=?1 AND (
        ${publicLeak('d.name')} OR ${publicLeak('d.display_name')}
        OR ${publicLeak('d.description')} OR ${publicLeak('d.search_text')}
        OR ${publicLeak('d.category_name')} OR ${publicLeak('d.display_category_name')}
      )`, [runId]],
    ['candidateTaxonomyLeaks', `SELECT
       (SELECT COUNT(*) FROM supplier_sync_stage_catalog_categories c
         WHERE c.run_id=?1 AND ${publicLeak('c.name')})
       + (SELECT COUNT(*) FROM supplier_sync_stage_teams t
         WHERE t.run_id=?1 AND (${publicLeak('t.name')} OR ${publicLeak('t.short_name')}))
       + (SELECT COUNT(*) FROM supplier_sync_stage_leagues l
         WHERE l.run_id=?1 AND ${publicLeak('l.name')})
       + (SELECT COUNT(*) FROM supplier_sync_stage_facets f
         WHERE f.run_id=?1 AND ${publicLeak('f.name')}) AS total`, [runId]],
    ['mediaCountMismatch', `SELECT COUNT(*) AS total
       FROM supplier_sync_stage_product_details d
      WHERE d.run_id=?1 AND d.detail_state='complete'
        AND d.image_count<>(
          SELECT COUNT(*) FROM supplier_sync_stage_product_media pm
           WHERE pm.run_id=d.run_id AND pm.public_product_id=d.public_product_id
        )`, [runId]],
    ['primaryMediaMissing', `SELECT COUNT(*) AS total
       FROM supplier_sync_stage_product_details d
       LEFT JOIN supplier_sync_stage_media_sources m
         ON m.run_id=d.run_id AND m.media_id=d.primary_media_id AND m.active=1
      WHERE d.run_id=?1 AND d.detail_state='complete' AND d.image_count>0
        AND (d.primary_media_id IS NULL OR m.media_id IS NULL)`, [runId]],
    ['leafMembershipMissing', `SELECT COUNT(*) AS total
       FROM supplier_sync_stage_product_details d
      WHERE d.run_id=?1 AND d.detail_state='complete'
        AND NOT EXISTS (
          SELECT 1 FROM supplier_sync_stage_product_categories pc
           WHERE pc.run_id=d.run_id AND pc.public_product_id=d.public_product_id
             AND pc.category_id=d.category_id
        )`, [runId]],
    ['categoryCountMismatch', `SELECT COUNT(*) AS total
       FROM supplier_sync_stage_catalog_categories c
      WHERE c.run_id=?1 AND c.product_count<>(
        SELECT COUNT(*) FROM supplier_sync_stage_product_categories pc
         WHERE pc.run_id=c.run_id AND pc.category_id=c.category_id
      )`, [runId]],
    ['teamCountMismatch', `SELECT COUNT(*) AS total
       FROM supplier_sync_stage_teams t
      WHERE t.run_id=?1 AND t.product_count<>(
        SELECT COUNT(*) FROM supplier_sync_stage_product_details d
         WHERE d.run_id=t.run_id AND d.detail_state='complete' AND d.team_id=t.team_id
      )`, [runId]],
    ['leagueCountMismatch', `SELECT COUNT(*) AS total
       FROM supplier_sync_stage_leagues l
      WHERE l.run_id=?1 AND l.product_count<>(
        SELECT COUNT(*) FROM supplier_sync_stage_product_details d
         WHERE d.run_id=l.run_id AND d.detail_state='complete' AND d.league_id=l.league_id
      )`, [runId]],
    ['facetCountMismatch', `SELECT COUNT(*) AS total
       FROM supplier_sync_stage_facets f
      WHERE f.run_id=?1 AND f.product_count<>(
        SELECT COUNT(*) FROM supplier_sync_stage_product_facets pf
         WHERE pf.run_id=f.run_id AND pf.facet_id=f.facet_id
      )`, [runId]],
    ['classificationInvalid', `SELECT COUNT(*) AS total
       FROM supplier_sync_stage_classification_state c
       JOIN supplier_sync_stage_product_details d
         ON d.run_id=c.run_id AND d.public_product_id=c.public_product_id
      WHERE c.run_id=?1 AND (
        c.classifier_version<>CAST(?2 AS INTEGER) OR c.classifier_key<>?3
        OR d.detail_state<>'complete' OR d.classification_status IS NULL
        OR d.classification_confidence IS NULL
      )`, [runId, CATALOG_CLASSIFIER_VERSION, CATALOG_CLASSIFIER_KEY]],
    ['overrideMismatch', `SELECT COUNT(*) AS total
       FROM supplier_sync_stage_classification_state c
       LEFT JOIN ${overrideRelation} o ON o.product_id=c.public_product_id
       LEFT JOIN supplier_sync_stage_intelligence_state i
         ON i.run_id=c.run_id AND i.public_product_id=c.public_product_id
      WHERE c.run_id=?1 AND (
        c.override_applied<>CASE WHEN o.product_id IS NULL THEN 0 ELSE 1 END
        OR COALESCE(i.override_applied,-1)<>c.override_applied
        OR (o.product_id IS NOT NULL AND (
          COALESCE(c.merchant_override_version,0)<>o.override_version
          OR COALESCE(c.merchant_override_updated_at,'')<>COALESCE(o.updated_at,'')
        ))
        OR (o.product_id IS NULL AND c.merchant_override_version IS NOT NULL)
      )`, [runId]],
    ['intelligenceInvalid', `SELECT COUNT(*) AS total
       FROM supplier_sync_stage_intelligence_state i
       JOIN supplier_sync_stage_classification_state c
         ON c.run_id=i.run_id AND c.public_product_id=i.public_product_id
       JOIN supplier_sync_stage_product_details d
         ON d.run_id=i.run_id AND d.public_product_id=i.public_product_id
      WHERE i.run_id=?1 AND (
        i.contract_version<>CAST(?2 AS INTEGER)
        OR i.classifier_version<>CAST(?3 AS INTEGER)
        OR i.classifier_key<>?4
        OR json_valid(i.state_json)<>1
        OR json_type(i.state_json,'$.automatic.claims')<>'object'
        OR json_type(i.state_json,'$.effective.claims')<>'object'
        OR json_type(i.state_json,'$.effective.conflicts')<>'array'
        OR json_type(i.state_json,'$.research')<>'object'
        OR CAST(json_extract(i.state_json,'$.contractVersion') AS INTEGER)<>i.contract_version
        OR CAST(json_extract(i.state_json,'$.evidenceSchemaVersion') AS INTEGER)<>i.evidence_schema_version
        OR CAST(json_extract(i.state_json,'$.classifierVersion') AS INTEGER)<>i.classifier_version
        OR COALESCE(json_extract(i.state_json,'$.classifierKey'),'')<>i.classifier_key
        OR COALESCE(json_extract(i.state_json,'$.knowledgePackKey'),'')<>COALESCE(i.knowledge_pack_key,'')
        OR COALESCE(CAST(json_extract(i.state_json,'$.knowledgePackVersion') AS INTEGER),0)<>COALESCE(i.knowledge_pack_version,0)
        OR COALESCE(json_extract(i.state_json,'$.domain.id'),'')<>i.domain_id
        OR ABS(COALESCE(CAST(json_extract(i.state_json,'$.domain.confidence') AS REAL),-1)-i.domain_confidence)>0.000001
        OR COALESCE(json_extract(i.state_json,'$.domain.knowledgeState'),'')<>i.domain_knowledge_state
        OR CAST(json_extract(i.state_json,'$.overrideApplied') AS INTEGER)<>i.override_applied
        OR CAST(json_extract(i.state_json,'$.effective.reviewRequired') AS INTEGER)<>i.review_required
        OR CAST(json_extract(i.state_json,'$.research.required') AS INTEGER)<>i.research_required
        OR json_array_length(json_extract(i.state_json,'$.effective.conflicts'))<>i.conflict_count
        OR COALESCE(json_extract(i.state_json,'$.effective.status'),'')<>COALESCE(d.classification_status,'')
        OR ABS(COALESCE(CAST(json_extract(i.state_json,'$.effective.confidence') AS REAL),-1)-COALESCE(d.classification_confidence,-1))>0.000001
        OR lower(i.state_json) LIKE '%x.yupoo.com%'
        OR lower(i.state_json) LIKE '%photo.yupoo.com%'
        OR lower(i.state_json) LIKE '%http://%'
        OR lower(i.state_json) LIKE '%https://%'
      )`, [runId, CEI_INTELLIGENCE_STATE_CONTRACT_VERSION, CATALOG_CLASSIFIER_VERSION, CATALOG_CLASSIFIER_KEY]],
    ['classificationMetaValid', `SELECT COUNT(*) AS total
       FROM supplier_sync_stage_catalog_meta m
       JOIN supplier_sync_stage_runs r ON r.run_id=m.run_id
      WHERE m.run_id=?1 AND m.key='classification' AND json_valid(m.value_json)=1
        AND json_extract(m.value_json,'$.mode')='affected-only'
        AND CAST(json_extract(m.value_json,'$.classifierVersion') AS INTEGER)=CAST(?2 AS INTEGER)
        AND json_extract(m.value_json,'$.classifierKey')=?3
        AND CAST(json_extract(m.value_json,'$.expectedAffectedProducts') AS INTEGER)=r.expected_detail_count`, [runId, CATALOG_CLASSIFIER_VERSION, CATALOG_CLASSIFIER_KEY]],
    ['navigationMetaValid', `SELECT COUNT(*) AS total
       FROM supplier_sync_stage_catalog_meta
      WHERE run_id=?1 AND key='navigation' AND json_valid(value_json)=1
        AND json_type(value_json)='array' AND json_array_length(value_json)>0`, [runId]],
    ['merchandisingMetaValid', `SELECT COUNT(*) AS total
       FROM supplier_sync_stage_catalog_meta m
       JOIN supplier_sync_stage_catalog_meta n ON n.run_id=m.run_id AND n.key='navigation'
      WHERE m.run_id=?1 AND m.key='merchandising' AND json_valid(m.value_json)=1
        AND CAST(json_extract(m.value_json,'$.contractVersion') AS INTEGER)=CAST(?2 AS INTEGER)
        AND json_extract(m.value_json,'$.knowledgePackKey')=?3
        AND CAST(json_extract(m.value_json,'$.knowledgePackVersion') AS INTEGER)=CAST(?4 AS INTEGER)
        AND json_extract(m.value_json,'$.domain')=?5
        AND json_extract(m.value_json,'$.projection')='candidate-composed-v1'
        AND CAST(json_extract(m.value_json,'$.navigationItems') AS INTEGER)=json_array_length(n.value_json)`, [
          runId,
          CEI_MERCHANDISING_CONTRACT_VERSION,
          SPORTS_KNOWLEDGE_PACK.key,
          SPORTS_KNOWLEDGE_PACK.version,
          SPORTS_KNOWLEDGE_PACK.domain
        ]],
    ['unchangedCanonicalPublicLeaks', `SELECT COUNT(*) AS total
       FROM catalog_products p
      WHERE NOT EXISTS (
        SELECT 1 FROM supplier_sync_stage_events e
         WHERE e.run_id=?1 AND e.public_product_id=p.product_id
           AND (e.needs_detail=1 OR ${globalRemoval})
      ) AND (
        ${publicLeak('p.name')} OR ${publicLeak('p.display_name')}
        OR ${publicLeak('p.description')} OR ${publicLeak('p.search_text')}
        OR ${publicLeak('p.category_name')} OR ${publicLeak('p.display_category_name')}
      )`, [runId]],
    ['proposedProducts', `SELECT
       (SELECT COUNT(*) FROM catalog_products)
       - (SELECT COUNT(*) FROM catalog_products p WHERE EXISTS (
           SELECT 1 FROM supplier_sync_stage_events e
            WHERE e.run_id=?1 AND e.public_product_id=p.product_id AND e.needs_detail=1
         ))
       - (SELECT COUNT(*) FROM catalog_products p WHERE EXISTS (
           SELECT 1 FROM supplier_sync_stage_events e
            WHERE e.run_id=?1 AND e.public_product_id=p.product_id AND ${globalRemoval}
              AND e.needs_detail=0
         ))
       + (SELECT COUNT(*) FROM supplier_sync_stage_product_details d
           WHERE d.run_id=?1 AND d.detail_state='complete') AS total`, [runId]],
    ['reviewRequired', `SELECT COUNT(*) AS total FROM supplier_sync_stage_intelligence_state WHERE run_id=?1 AND review_required=1`, [runId]],
    ['researchRequired', `SELECT COUNT(*) AS total FROM supplier_sync_stage_intelligence_state WHERE run_id=?1 AND research_required=1`, [runId]],
    ['conflicts', `SELECT COALESCE(SUM(conflict_count),0) AS total FROM supplier_sync_stage_intelligence_state WHERE run_id=?1`, [runId]],
    ['foreignKeyFindings', 'PRAGMA foreign_key_check', []]
  ];
}

async function loadVerificationMetrics(context, platform, queryBatch, fetchImpl) {
  const specs = metricSpecs(context);
  const result = await tenantRequest(
    context,
    platform,
    specs.map(([, sql, params]) => ({ sql, params })),
    queryBatch,
    fetchImpl
  );
  const metrics = {};
  for (let index = 0; index < specs.length; index += 1) {
    const key = specs[index][0];
    if (key === 'foreignKeyFindings') {
      metrics[key] = (result[index]?.results || []).length;
    } else {
      metrics[key] = Number(result[index]?.results?.[0]?.total || 0);
    }
  }
  return metrics;
}

export function incrementalVerificationFindings(run, metrics) {
  const findings = [];
  const expectedDetail = Number(run?.expected_detail_count || 0);
  if (String(run?.safety_outcome || '') !== 'proceed') findings.push('safety_not_proceed');
  if (Number(run?.scan_complete || 0) !== 1) findings.push('scan_not_complete');
  if (Number(run?.disqualifying_failure_count || 0) !== 0) findings.push('scan_disqualified');
  if (metrics.observations !== Number(run?.observed_count || 0)) findings.push('observation_count_mismatch');
  if (metrics.observations !== Number(run?.staged_observation_count || 0)) findings.push('staged_observation_count_mismatch');
  if (metrics.events !== Number(run?.expected_event_count || 0)) findings.push('event_count_mismatch');
  if (metrics.events !== Number(run?.staged_event_count || 0)) findings.push('staged_event_count_mismatch');
  if (metrics.sourceCategories !== Number(run?.staged_category_count || 0)) findings.push('source_category_count_mismatch');
  if (metrics.detailEvents !== expectedDetail) findings.push('detail_event_count_mismatch');
  if (metrics.details !== expectedDetail || metrics.completeDetails !== expectedDetail) findings.push('candidate_detail_incomplete');
  if (metrics.classification !== expectedDetail) findings.push('candidate_classification_incomplete');
  if (metrics.intelligence !== expectedDetail) findings.push('candidate_intelligence_incomplete');

  const blockingMetricCodes = [
    ['duplicateObservationProducts', 'observation_identity_duplicate'],
    ['duplicateEventProducts', 'event_identity_duplicate'],
    ['observedEventMissingObservation', 'event_observation_identity_mismatch'],
    ['absenceHasObservation', 'absence_observation_conflict'],
    ['newIdentityConflict', 'new_identity_conflict'],
    ['existingIdentityMissing', 'existing_identity_missing'],
    ['observationIdentityMismatch', 'observation_identity_mismatch'],
    ['eventDetailSemantics', 'event_detail_semantics_invalid'],
    ['absenceSemantics', 'absence_semantics_invalid'],
    ['removalSemantics', 'removal_semantics_invalid'],
    ['extraneousDetails', 'candidate_detail_extraneous'],
    ['missingDetails', 'candidate_detail_missing'],
    ['invalidProductIds', 'public_product_identity_invalid'],
    ['invalidCategoryIds', 'public_category_identity_invalid'],
    ['invalidMediaIds', 'public_media_identity_invalid'],
    ['candidatePublicLeaks', 'candidate_public_source_leak'],
    ['candidateTaxonomyLeaks', 'candidate_taxonomy_source_leak'],
    ['mediaCountMismatch', 'candidate_media_count_mismatch'],
    ['primaryMediaMissing', 'candidate_primary_media_missing'],
    ['leafMembershipMissing', 'candidate_category_membership_missing'],
    ['categoryCountMismatch', 'candidate_category_count_mismatch'],
    ['teamCountMismatch', 'candidate_team_count_mismatch'],
    ['leagueCountMismatch', 'candidate_league_count_mismatch'],
    ['facetCountMismatch', 'candidate_facet_count_mismatch'],
    ['classificationInvalid', 'candidate_classification_invalid'],
    ['overrideMismatch', 'merchant_override_provenance_stale'],
    ['intelligenceInvalid', 'candidate_intelligence_invalid'],
    ['unchangedCanonicalPublicLeaks', 'unchanged_lkg_public_source_leak'],
    ['foreignKeyFindings', 'candidate_foreign_key_findings']
  ];
  for (const [metric, code] of blockingMetricCodes) {
    if (Number(metrics[metric] || 0) > 0) findings.push(code);
  }
  if (Object.hasOwn(metrics, 'removalPolicyValid') && Number(metrics.removalPolicyValid || 0) !== 1) {
    findings.push('removal_policy_invalid');
  }
  if (expectedDetail > 0 && Number(metrics.classificationMetaValid || 0) !== 1) {
    findings.push('candidate_classification_meta_invalid');
  }
  if (Number(metrics.navigationMetaValid || 0) !== 1) findings.push('candidate_navigation_invalid');
  if (Number(metrics.merchandisingMetaValid || 0) !== 1) findings.push('candidate_merchandising_invalid');
  if (Number(metrics.proposedProducts || 0) < 1) findings.push('proposed_catalog_empty');
  return [...new Set(findings)].slice(0, MAX_FINDINGS);
}

async function markVerified(context, platform, queryBatch, fetchImpl) {
  const removalPolicyGate = Number(context.schemaVersion || 0) >= 8
    ? `AND EXISTS (
         SELECT 1 FROM supplier_sync_stage_removal_policy p
         JOIN supplier_sync_stage_runs rr ON rr.run_id=p.run_id
        WHERE p.run_id=?1 AND p.tenant_id=?2 AND p.source_key=?3
          AND p.scope_id=rr.scope_id AND p.scope_kind=rr.scope_kind
          AND p.contract_version=1 AND p.policy_version=1 AND p.removal_threshold>=2
       )`
    : '';
  const result = await tenantRequest(
    context,
    platform,
    [
      {
        sql: `UPDATE supplier_sync_stage_runs
                 SET state='verified', verification_code=?4,
                     verified_at=COALESCE(verified_at,CURRENT_TIMESTAMP),
                     last_error_code=NULL, updated_at=CURRENT_TIMESTAMP
               WHERE run_id=?1 AND tenant_id=?2 AND source_key=?3
                 AND state IN ('planned','details_complete','verified')
                 AND safety_outcome='proceed' AND scan_complete=1
                 AND disqualifying_failure_count=0
                 AND staged_observation_count=observed_count
                 AND staged_event_count=expected_event_count
                 ${removalPolicyGate}
                 AND (SELECT COUNT(*) FROM supplier_sync_stage_observations o WHERE o.run_id=?1)=observed_count
                 AND (SELECT COUNT(*) FROM supplier_sync_stage_events e WHERE e.run_id=?1)=expected_event_count
                 AND (SELECT COUNT(*) FROM supplier_sync_stage_events e WHERE e.run_id=?1 AND e.needs_detail=1)=expected_detail_count
                 AND (SELECT COUNT(*) FROM supplier_sync_stage_product_details d WHERE d.run_id=?1 AND d.detail_state='complete')=expected_detail_count
                 AND (SELECT COUNT(*) FROM supplier_sync_stage_classification_state c
                       WHERE c.run_id=?1 AND c.classifier_version=CAST(?5 AS INTEGER) AND c.classifier_key=?6)=expected_detail_count
                 AND (SELECT COUNT(*) FROM supplier_sync_stage_intelligence_state i
                       WHERE i.run_id=?1 AND i.contract_version=CAST(?7 AS INTEGER)
                         AND i.classifier_version=CAST(?5 AS INTEGER) AND i.classifier_key=?6
                         AND json_valid(i.state_json)=1)=expected_detail_count`,
        params: [
          context.importId,
          context.tenantId,
          context.sourceKey,
          VERIFICATION_CODE,
          CATALOG_CLASSIFIER_VERSION,
          CATALOG_CLASSIFIER_KEY,
          CEI_INTELLIGENCE_STATE_CONTRACT_VERSION
        ]
      },
      {
        sql: `SELECT state, verification_code, verified_at, last_error_code
                FROM supplier_sync_stage_runs
               WHERE run_id=?1 AND tenant_id=?2 AND source_key=?3 LIMIT 1`,
        params: [context.importId, context.tenantId, context.sourceKey]
      }
    ],
    queryBatch,
    fetchImpl
  );
  const row = result[1]?.results?.[0] || null;
  if (!row || row.state !== 'verified' || row.verification_code !== VERIFICATION_CODE) {
    throw new Error('sync_candidate_verification_state_conflict');
  }
  return row;
}

async function markPrivateFailure(context, platform, safeCode, queryBatch, fetchImpl) {
  await tenantRequest(
    context,
    platform,
    [
      {
        sql: `UPDATE supplier_sync_stage_runs
                 SET state='failed', verification_code='sync_candidate_verification_v1',
                     last_error_code=?4, updated_at=CURRENT_TIMESTAMP
               WHERE run_id=?1 AND tenant_id=?2 AND source_key=?3
                 AND state IN ('planned','details_complete')`,
        params: [context.importId, context.tenantId, context.sourceKey, safeCode]
      },
      {
        sql: `UPDATE supplier_sync_runs
                 SET status='failed', finished_at=CURRENT_TIMESTAMP,
                     error_text=?4
               WHERE run_id=?1 AND tenant_id=?2 AND source_key=?3
                 AND status='running'`,
        params: [context.importId, context.tenantId, context.sourceKey, safeCode]
      }
    ],
    queryBatch,
    fetchImpl
  ).catch(() => {});
}

async function markControlVerified(db, context, ownership) {
  const result = await db
    .prepare(
      `UPDATE tenant_import_jobs
          SET status='finalizing', phase='finalize',
              next_attempt_at=NULL, last_error_code=NULL,
              recovery_attempt_count=0,last_failure_phase=NULL,
              phase_lease_kind=NULL,phase_lease_token=NULL,phase_lease_until=NULL,
              state_revision=state_revision+1,
              updated_at=CURRENT_TIMESTAMP
        WHERE import_id=?1 AND tenant_id=?2 AND source_key=?3
          AND mode='incremental' AND status='details' AND phase='details'
          AND candidate_classified_at IS NOT NULL
          AND phase_lease_kind='verification' AND phase_lease_token=?4
          AND state_revision=CAST(?5 AS INTEGER)`
    )
    .bind(
      context.importId,
      context.tenantId,
      context.sourceKey,
      ownership.token,
      ownership.revision
    )
    .run();
  return Number(result?.meta?.changes || 0) === 1;
}

export async function processTenantIncrementalVerification(
  env,
  context,
  { queryBatch = queryD1Batch, fetchImpl = fetch } = {}
) {
  if (context.mode !== 'incremental') throw new Error('tenant_sync_incremental_context_required');
  if (context.schemaVersion < 6) throw new Error('tenant_schema_not_ready');
  if (!['details','finalize'].includes(context.phase)) return { outcome: 'busy' };

  const platform = {
    ...ingestionPlatformConfig(env, context.dataPlane.dispatchNamespace),
    tenantId: context.tenantId
  };
  const readiness = await loadReadiness(context, platform, queryBatch, fetchImpl);
  if (!readiness.run) throw new Error('tenant_sync_stage_missing');
  if (
    readiness.run.state === 'verified' &&
    readiness.run.verification_code === VERIFICATION_CODE
  ) {
    return { outcome: 'success', alreadyComplete: true, verificationCode: VERIFICATION_CODE };
  }
  if (!['planned','details_complete'].includes(String(readiness.run.state || ''))) {
    return { outcome: 'busy', stageState: String(readiness.run.state || '') };
  }

  const expected = Number(readiness.run.expected_detail_count || 0);
  if (readiness.run.state === 'planned' && expected !== 0) {
    const code = 'sync_candidate_verification_stage_invalid';
    await markPrivateFailure(context, platform, code, queryBatch, fetchImpl);
    return { outcome: 'failed', error: code, findings: ['planned_stage_has_detail_work'] };
  }
  if (
    expected > 0 &&
    (readiness.completeDetails < expected ||
      readiness.currentClassification < expected ||
      readiness.currentIntelligence < expected)
  ) {
    return {
      outcome: 'busy',
      stageState: readiness.run.state,
      expected,
      completeDetails: readiness.completeDetails,
      classification: readiness.currentClassification,
      intelligence: readiness.currentIntelligence
    };
  }

  try {
    await refreshCandidateDerivedCounts(context, platform, queryBatch, fetchImpl);
    const merchandising = await persistProposedMerchandising(
      context,
      platform,
      queryBatch,
      fetchImpl
    );
    const metrics = await loadVerificationMetrics(context, platform, queryBatch, fetchImpl);
    const findings = incrementalVerificationFindings(readiness.run, metrics);
    if (findings.length) {
      const code = verificationFailureCode(findings);
      await markPrivateFailure(context, platform, code, queryBatch, fetchImpl);
      return {
        outcome: 'failed',
        error: code,
        findings,
        expected,
        proposedProducts: metrics.proposedProducts,
        reviewRequired: metrics.reviewRequired,
        researchRequired: metrics.researchRequired,
        conflicts: metrics.conflicts
      };
    }
    const verified = await markVerified(context, platform, queryBatch, fetchImpl);
    return {
      outcome: 'success',
      verificationCode: verified.verification_code,
      stageState: verified.state,
      expected,
      proposedProducts: metrics.proposedProducts,
      reviewRequired: metrics.reviewRequired,
      researchRequired: metrics.researchRequired,
      conflicts: metrics.conflicts,
      merchandising
    };
  } catch (error) {
    const code = safeVerificationError(error);
    await markPrivateFailure(context, platform, code, queryBatch, fetchImpl);
    return { outcome: 'failed', error: code };
  }
}

export async function runDueTenantIncrementalVerifications(
  env,
  { limit = DEFAULT_LIMIT, queryBatch = queryD1Batch, fetchImpl = fetch } = {}
) {
  if (!env?.CATALOG_DB) return { enabled: false, reason: 'database_unbound', processed: 0 };
  if (!platformRuntimeConfigured(env)) {
    return { enabled: false, reason: 'tenant_ingestion_platform_unconfigured', processed: 0 };
  }

  const jobLimit = boundedLimit(limit);
  const due = await discoverCandidateJobs(env.CATALOG_DB, jobLimit);
  const outcomes = [];
  let succeeded = 0;
  let failed = 0;
  let busy = 0;

  for (const job of due) {
    let context = null;
    const ownership = await claimTenantSyncPhaseLease(
      env.CATALOG_DB,
      job,
      'verification'
    );
    if (!ownership) {
      busy += 1;
      outcomes.push({ importId: job.import_id, outcome: 'busy' });
      continue;
    }
    try {
      context = await loadTenantImportContext(
        env.CATALOG_DB,
        {
          importId: job.import_id,
          tenantId: job.tenant_id,
          sourceKey: job.source_key
        },
        { allowedModes: ['incremental'] }
      );
      const result = await processTenantIncrementalVerification(env, context, {
        queryBatch,
        fetchImpl
      });
      if (result.outcome === 'success') {
        const committed = await markControlVerified(
          env.CATALOG_DB,
          context,
          ownership
        );
        if (committed) succeeded += 1;
        else busy += 1;
      } else if (result.outcome === 'failed') {
        failed += 1;
        await failTenantSyncPhaseLease(
          env.CATALOG_DB,
          job,
          ownership,
          result.error || 'sync_candidate_verification_failed'
        );
      } else {
        busy += 1;
        await releaseTenantSyncPhaseLease(env.CATALOG_DB, job, ownership);
      }
      outcomes.push({ importId: job.import_id, ...result });
    } catch (error) {
      const code = safeVerificationError(error);
      await failTenantSyncPhaseLease(env.CATALOG_DB, job, ownership, code);
      failed += 1;
      outcomes.push({ importId: job.import_id, outcome: 'failed', error: code });
    }
  }

  return {
    enabled: true,
    discovered: due.length,
    selected: due.length,
    processed: outcomes.length,
    succeeded,
    failed,
    busy,
    outcomes
  };
}
