import { createTenantCatalogEvidence } from '../../src/catalog-intelligence/core/runtime-evidence.js';
import {
  CATALOG_CLASSIFIER_KEY,
  CATALOG_CLASSIFIER_VERSION,
  classifyCatalogEvidence
} from '../../src/domain/catalog-classifier.js';
import { candidateIntelligenceStateStatement } from '../cei-intelligence-persistence.js';
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

function safeClassificationError(error) {
  if (error instanceof TenantImportContextError) return error.code;
  const value = String(error?.code || error?.message || error || '').trim();
  if (/^(tenant|sync|cei|catalog_provider)_[a-z0-9_]+$/i.test(value)) return value.slice(0, 120);
  return 'sync_candidate_classification_failed';
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
          AND j.discovered_count > 0
          AND j.completed_detail_count=j.discovered_count
          AND j.failed_detail_count=0
          AND j.deferred_detail_count=0
          AND j.candidate_classified_at IS NULL
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

async function loadCandidateState(context, platform, queryBatch, fetchImpl) {
  const overrideRelation = Number(context.schemaVersion || 0) >= 8
    ? 'catalog_product_effective_classification_overrides'
    : 'catalog_product_classification_overrides';
  const result = await tenantRequest(
    context,
    platform,
    [
      {
        sql: `SELECT state, safety_outcome, expected_detail_count, last_error_code
                FROM supplier_sync_stage_runs
               WHERE run_id=?1 AND tenant_id=?2 AND source_key=?3
               LIMIT 1`,
        params: [context.importId, context.tenantId, context.sourceKey]
      },
      {
        sql: `SELECT d.album_source_id, d.public_product_id, d.name, d.description,
                     d.source_name, d.source_category_name, d.category_name,
                     d.display_name, d.display_category_name, d.search_text,
                     o.source_category_path_json,
                     override.override_json, override.override_version,
                     override.updated_at AS override_updated_at,
                     candidate.classifier_version AS candidate_classifier_version,
                     candidate.classifier_key AS candidate_classifier_key,
                     candidate.override_applied AS candidate_override_applied,
                     candidate.merchant_override_version AS candidate_override_version,
                     candidate.merchant_override_updated_at AS candidate_override_updated_at,
                     intelligence.public_product_id AS intelligence_product_id
                FROM supplier_sync_stage_product_details d
                JOIN supplier_sync_stage_runs r ON r.run_id=d.run_id
                JOIN supplier_sync_stage_events e
                  ON e.run_id=d.run_id AND e.public_product_id=d.public_product_id
                 AND e.album_source_id=d.album_source_id
                JOIN supplier_sync_stage_observations o
                  ON o.run_id=d.run_id AND o.public_product_id=d.public_product_id
                 AND o.album_source_id=d.album_source_id
                LEFT JOIN ${overrideRelation} override
                  ON override.product_id=d.public_product_id
                LEFT JOIN supplier_sync_stage_classification_state candidate
                  ON candidate.run_id=d.run_id AND candidate.public_product_id=d.public_product_id
                LEFT JOIN supplier_sync_stage_intelligence_state intelligence
                  ON intelligence.run_id=d.run_id AND intelligence.public_product_id=d.public_product_id
               WHERE d.run_id=?1
                 AND r.tenant_id=?2 AND r.source_key=?3
                 AND r.state='details_complete' AND r.safety_outcome='proceed'
                 AND d.detail_state='complete'
                 AND e.needs_detail=1
               ORDER BY d.public_product_id ASC`,
        params: [context.importId, context.tenantId, context.sourceKey]
      },
      {
        sql: `SELECT category_source_id, name
                FROM supplier_sync_stage_categories
               WHERE run_id=?1
               ORDER BY depth ASC, sort_order ASC, category_source_id ASC`,
        params: [context.importId]
      }
    ],
    queryBatch,
    fetchImpl
  );
  const categories = new Map(
    (result[2]?.results || []).map((row) => [String(row.category_source_id), String(row.name || '')])
  );
  return {
    run: result[0]?.results?.[0] || null,
    products: result[1]?.results || [],
    categories
  };
}

function categoryPathNames(row, categories) {
  let ids = [];
  try {
    const parsed = JSON.parse(String(row.source_category_path_json || '[]'));
    if (Array.isArray(parsed)) ids = parsed.map(String);
  } catch {
    throw new Error('sync_candidate_category_path_invalid');
  }
  const names = ids.map((id) => categories.get(id)).filter(Boolean);
  if (!names.length) {
    const fallback = String(row.source_category_name || row.category_name || '').trim();
    if (fallback) names.push(fallback);
  }
  return names;
}

function currentOverrideMatches(row) {
  const hasOverride = row.override_version !== null && row.override_version !== undefined;
  if (hasOverride) {
    return (
      Number(row.candidate_override_applied || 0) === 1 &&
      Number(row.candidate_override_version || 0) === Number(row.override_version || 0) &&
      String(row.candidate_override_updated_at || '') === String(row.override_updated_at || '')
    );
  }
  return (
    Number(row.candidate_override_applied || 0) === 0 &&
    (row.candidate_override_version === null || row.candidate_override_version === undefined)
  );
}

function candidateAlreadyCurrent(row) {
  return (
    Number(row.candidate_classifier_version || 0) === CATALOG_CLASSIFIER_VERSION &&
    String(row.candidate_classifier_key || '') === CATALOG_CLASSIFIER_KEY &&
    Boolean(row.intelligence_product_id) &&
    currentOverrideMatches(row)
  );
}

function leagueStatement(runId, league) {
  if (!league) return null;
  return {
    sql: `INSERT INTO supplier_sync_stage_leagues
            (run_id, league_id, name, country_code, country_name, entity_type,
             logo_url, sort_order, product_count, updated_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, CURRENT_TIMESTAMP)
          ON CONFLICT(run_id, league_id) DO UPDATE SET
            name=excluded.name, country_code=excluded.country_code,
            country_name=excluded.country_name, entity_type=excluded.entity_type,
            logo_url=excluded.logo_url, sort_order=excluded.sort_order,
            updated_at=CURRENT_TIMESTAMP`,
    params: [
      runId,
      league.id,
      league.name,
      league.countryCode,
      league.countryName,
      league.entityType || 'club',
      league.logoUrl || null,
      Number(league.sortOrder || 0)
    ]
  };
}

function teamStatement(runId, team) {
  if (!team) return null;
  return {
    sql: `INSERT INTO supplier_sync_stage_teams
            (run_id, team_id, name, short_name, league_id, country_code,
             entity_type, logo_url, initials, sort_order, product_count, updated_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, CURRENT_TIMESTAMP)
          ON CONFLICT(run_id, team_id) DO UPDATE SET
            name=excluded.name, short_name=excluded.short_name,
            league_id=excluded.league_id, country_code=excluded.country_code,
            entity_type=excluded.entity_type, logo_url=excluded.logo_url,
            initials=excluded.initials, sort_order=excluded.sort_order,
            updated_at=CURRENT_TIMESTAMP`,
    params: [
      runId,
      team.id,
      team.name,
      team.shortName || team.name,
      team.leagueId || null,
      team.countryCode || null,
      team.entityType || 'club',
      team.logoUrl || null,
      team.initials || team.shortName || team.name.slice(0, 3).toUpperCase(),
      Number(team.sortOrder || 0)
    ]
  };
}

function facetStatement(runId, facet) {
  return {
    sql: `INSERT INTO supplier_sync_stage_facets
            (run_id, facet_id, facet_type, name, sort_order, product_count, updated_at)
          VALUES (?1, ?2, ?3, ?4, ?5, 0, CURRENT_TIMESTAMP)
          ON CONFLICT(run_id, facet_id) DO UPDATE SET
            facet_type=excluded.facet_type, name=excluded.name,
            sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP`,
    params: [runId, facet.id, facet.type, facet.name, Number(facet.sortOrder || 0)]
  };
}

export function buildIncrementalCandidateClassificationBatch({
  context,
  row,
  classified
}) {
  const runId = context.importId;
  const productId = String(row.public_product_id);
  const overrideApplied = Boolean(classified.overrideApplied);
  const overrideVersion = overrideApplied ? Number(row.override_version || 0) : null;
  const overrideUpdatedAt = overrideApplied ? String(row.override_updated_at || '') : null;
  if (overrideApplied && (!overrideVersion || !overrideUpdatedAt)) {
    throw new Error('sync_candidate_override_provenance_missing');
  }

  const batch = [];
  const league = classified.league || null;
  const team = classified.team || null;
  const facets = Array.isArray(classified.facets) ? classified.facets : [];
  const leagueWrite = leagueStatement(runId, league);
  if (leagueWrite) batch.push(leagueWrite);
  const teamWrite = teamStatement(runId, team);
  if (teamWrite) batch.push(teamWrite);
  for (const facet of facets) batch.push(facetStatement(runId, facet));

  batch.push(
    {
      sql: `DELETE FROM supplier_sync_stage_product_facets
             WHERE run_id=?1 AND public_product_id=?2`,
      params: [runId, productId]
    },
    {
      sql: `UPDATE supplier_sync_stage_product_details
               SET display_name=?3, display_category_name=?4, search_text=?5,
                   team_id=?6, league_id=?7,
                   classification_status=?8, classification_confidence=?9,
                   updated_at=CURRENT_TIMESTAMP
             WHERE run_id=?1 AND public_product_id=?2 AND detail_state='complete'`,
      params: [
        runId,
        productId,
        classified.displayName,
        classified.displayCategoryName,
        classified.searchText,
        team?.id || null,
        league?.id || null,
        classified.classificationStatus,
        Number(classified.classificationConfidence || 0)
      ]
    }
  );

  for (const facet of facets) {
    batch.push({
      sql: `INSERT OR IGNORE INTO supplier_sync_stage_product_facets
              (run_id, public_product_id, facet_id)
            VALUES (?1, ?2, ?3)`,
      params: [runId, productId, facet.id]
    });
  }

  batch.push({
    sql: `INSERT INTO supplier_sync_stage_classification_state
            (run_id, public_product_id, classifier_version, classifier_key,
             override_applied, merchant_override_version, merchant_override_updated_at,
             classified_at, updated_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT(run_id, public_product_id) DO UPDATE SET
            classifier_version=excluded.classifier_version,
            classifier_key=excluded.classifier_key,
            override_applied=excluded.override_applied,
            merchant_override_version=excluded.merchant_override_version,
            merchant_override_updated_at=excluded.merchant_override_updated_at,
            classified_at=CURRENT_TIMESTAMP,
            updated_at=CURRENT_TIMESTAMP`,
    params: [
      runId,
      productId,
      CATALOG_CLASSIFIER_VERSION,
      CATALOG_CLASSIFIER_KEY,
      overrideApplied ? 1 : 0,
      overrideVersion,
      overrideUpdatedAt
    ]
  });
  batch.push(candidateIntelligenceStateStatement(runId, productId, classified));
  return batch;
}

function buildEvidence(row, context, categories) {
  return createTenantCatalogEvidence(
    {
      product_id: row.public_product_id,
      album_source_id: row.album_source_id,
      name: row.name,
      source_name: row.source_name || row.name,
      description: row.description || '',
      category_name: row.category_name,
      source_category_name: row.source_category_name || row.category_name
    },
    {
      provider: context.privateSource.provider,
      source_key: context.sourceKey
    },
    categoryPathNames(row, categories)
  );
}

async function refreshCandidateCounts(context, platform, expected, queryBatch, fetchImpl) {
  const classificationMeta = JSON.stringify({
    contractVersion: 1,
    mode: 'affected-only',
    classifierVersion: CATALOG_CLASSIFIER_VERSION,
    classifierKey: CATALOG_CLASSIFIER_KEY,
    expectedAffectedProducts: expected
  });
  const result = await tenantRequest(
    context,
    platform,
    [
      {
        sql: `UPDATE supplier_sync_stage_leagues
                 SET product_count=(
                   SELECT COUNT(*) FROM supplier_sync_stage_product_details d
                    WHERE d.run_id=?1 AND d.league_id=supplier_sync_stage_leagues.league_id
                 ), updated_at=CURRENT_TIMESTAMP
               WHERE run_id=?1`,
        params: [context.importId]
      },
      {
        sql: `UPDATE supplier_sync_stage_teams
                 SET product_count=(
                   SELECT COUNT(*) FROM supplier_sync_stage_product_details d
                    WHERE d.run_id=?1 AND d.team_id=supplier_sync_stage_teams.team_id
                 ), updated_at=CURRENT_TIMESTAMP
               WHERE run_id=?1`,
        params: [context.importId]
      },
      {
        sql: `UPDATE supplier_sync_stage_facets
                 SET product_count=(
                   SELECT COUNT(*) FROM supplier_sync_stage_product_facets pf
                    WHERE pf.run_id=?1 AND pf.facet_id=supplier_sync_stage_facets.facet_id
                 ), updated_at=CURRENT_TIMESTAMP
               WHERE run_id=?1`,
        params: [context.importId]
      },
      {
        sql: `INSERT INTO supplier_sync_stage_catalog_meta (run_id, key, value_json, updated_at)
              VALUES (?1, 'classification', ?2, CURRENT_TIMESTAMP)
              ON CONFLICT(run_id, key) DO UPDATE SET
                value_json=excluded.value_json, updated_at=CURRENT_TIMESTAMP`,
        params: [context.importId, classificationMeta]
      },
      {
        sql: `SELECT
                (SELECT COUNT(*) FROM supplier_sync_stage_product_details d
                  WHERE d.run_id=?1 AND d.detail_state='complete') AS detail_count,
                (SELECT COUNT(*) FROM supplier_sync_stage_classification_state c
                  WHERE c.run_id=?1 AND c.classifier_version=?2 AND c.classifier_key=?3) AS classification_count,
                (SELECT COUNT(*) FROM supplier_sync_stage_intelligence_state i
                  WHERE i.run_id=?1 AND i.classifier_version=?2 AND i.classifier_key=?3) AS intelligence_count`,
        params: [context.importId, CATALOG_CLASSIFIER_VERSION, CATALOG_CLASSIFIER_KEY]
      }
    ],
    queryBatch,
    fetchImpl
  );
  const counts = result[4]?.results?.[0] || {};
  return {
    detail: Number(counts.detail_count || 0),
    classification: Number(counts.classification_count || 0),
    intelligence: Number(counts.intelligence_count || 0)
  };
}

async function recordPrivateFailure(context, platform, safeCode, queryBatch, fetchImpl) {
  await tenantRequest(
    context,
    platform,
    [
      {
        sql: `UPDATE supplier_sync_stage_runs
                 SET last_error_code=?4, updated_at=CURRENT_TIMESTAMP
               WHERE run_id=?1 AND tenant_id=?2 AND source_key=?3
                 AND state='details_complete'`,
        params: [context.importId, context.tenantId, context.sourceKey, safeCode]
      }
    ],
    queryBatch,
    fetchImpl
  ).catch(() => {});
}

async function clearCandidateError(context, platform, queryBatch, fetchImpl) {
  await tenantRequest(
    context,
    platform,
    [
      {
        sql: `UPDATE supplier_sync_stage_runs
                 SET last_error_code=NULL, updated_at=CURRENT_TIMESTAMP
               WHERE run_id=?1 AND tenant_id=?2 AND source_key=?3
                 AND state='details_complete' AND safety_outcome='proceed'`,
        params: [context.importId, context.tenantId, context.sourceKey]
      }
    ],
    queryBatch,
    fetchImpl
  );
}

export async function processTenantIncrementalClassification(
  env,
  context,
  { queryBatch = queryD1Batch, fetchImpl = fetch } = {}
) {
  if (context.mode !== 'incremental') throw new Error('tenant_sync_incremental_context_required');
  if (context.schemaVersion < 6) throw new Error('tenant_schema_not_ready');
  if (context.importStatus !== 'details' || context.phase !== 'details') {
    return { outcome: 'busy' };
  }

  const platform = {
    ...ingestionPlatformConfig(env, context.dataPlane.dispatchNamespace),
    tenantId: context.tenantId
  };
  const state = await loadCandidateState(context, platform, queryBatch, fetchImpl);
  if (!state.run) throw new Error('tenant_sync_stage_missing');
  if (state.run.safety_outcome !== 'proceed') throw new Error('sync_candidate_safety_blocked');
  if (state.run.state !== 'details_complete') return { outcome: 'busy' };

  const expected = Number(state.run.expected_detail_count || 0);
  if (expected < 1) return { outcome: 'success', alreadyComplete: true, expected: 0 };
  if (state.products.length !== expected) throw new Error('sync_candidate_detail_count_mismatch');

  let processed = 0;
  let reused = 0;
  for (const row of state.products) {
    if (candidateAlreadyCurrent(row)) {
      reused += 1;
      continue;
    }
    const evidence = buildEvidence(row, context, state.categories);
    const classified = classifyCatalogEvidence(evidence, row.override_json || null);
    const batch = buildIncrementalCandidateClassificationBatch({ context, row, classified });
    const writes = await tenantRequest(context, platform, batch, queryBatch, fetchImpl);
    const detailUpdateIndex = batch.findIndex((entry) =>
      String(entry.sql || '').includes('UPDATE supplier_sync_stage_product_details')
    );
    if (detailUpdateIndex < 0 || Number(writes[detailUpdateIndex]?.meta?.changes || 0) !== 1) {
      throw new Error('sync_candidate_detail_write_lost');
    }
    processed += 1;
  }

  const counts = await refreshCandidateCounts(
    context,
    platform,
    expected,
    queryBatch,
    fetchImpl
  );
  if (
    counts.detail !== expected ||
    counts.classification !== expected ||
    counts.intelligence !== expected
  ) {
    throw new Error('sync_candidate_cei_count_mismatch');
  }
  await clearCandidateError(context, platform, queryBatch, fetchImpl);
  return {
    outcome: 'success',
    expected,
    processed,
    reused,
    classificationCount: counts.classification,
    intelligenceCount: counts.intelligence
  };
}

export async function runDueTenantIncrementalClassifications(
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
  let processed = 0;

  for (const job of due) {
    let context = null;
    const ownership = await claimTenantSyncPhaseLease(
      env.CATALOG_DB,
      job,
      'classification'
    );
    if (!ownership) {
      busy += 1;
      outcomes.push({ importId: job.import_id, outcome: 'busy' });
      continue;
    }
    try {
      context = await loadTenantImportContext(env.CATALOG_DB, {
        importId: job.import_id,
        tenantId: job.tenant_id,
        sourceKey: job.source_key
      }, { allowedModes: ['incremental'] });
      const result = await processTenantIncrementalClassification(env, context, {
        queryBatch,
        fetchImpl
      });
      if (result.outcome === 'success') {
        const committed = await releaseTenantSyncPhaseLease(env.CATALOG_DB, job, ownership, {
          resetRecovery: true,
          markClassified: true
        });
        if (committed) succeeded += 1;
        else busy += 1;
      } else {
        busy += 1;
        await releaseTenantSyncPhaseLease(env.CATALOG_DB, job, ownership);
      }
      processed += Number(result.processed || 0);
      outcomes.push({ importId: job.import_id, outcome: result.outcome, ...result });
    } catch (error) {
      const safeCode = safeClassificationError(error);
      if (context) {
        const platform = {
          ...ingestionPlatformConfig(env, context.dataPlane.dispatchNamespace),
          tenantId: context.tenantId
        };
        await recordPrivateFailure(context, platform, safeCode, queryBatch, fetchImpl);
      }
      await failTenantSyncPhaseLease(env.CATALOG_DB, job, ownership, safeCode);
      failed += 1;
      outcomes.push({ importId: job.import_id, outcome: 'failed', error: safeCode });
    }
  }

  return {
    enabled: true,
    discovered: due.length,
    selected: due.length,
    processed,
    succeeded,
    failed,
    busy,
    outcomes
  };
}
