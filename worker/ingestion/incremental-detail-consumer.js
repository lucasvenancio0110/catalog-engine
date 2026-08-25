import {
  CATALOG_PROVIDER_CONTRACT_VERSION,
  assertCatalogProviderDetailResult
} from '../../src/catalog-provider/provider-contract.js';
import { normalizeCatalogProduct } from '../../src/domain/catalog-normalization.js';
import { queryD1Batch } from '../cloudflare-platform.js';
import { parseTenantImportMessage } from '../tenant-import-queue.js';
import {
  TenantImportContextError,
  ingestionPlatformConfig,
  loadTenantImportContext
} from './context.js';
import { resolveCatalogIngestionProvider } from './providers/index.js';

const MAX_DETAIL_ATTEMPTS = 4;
const DETAIL_LEASE_MINUTES = 5;
const RETRY_DELAY_SECONDS = 120;
const EVIDENCE_SCHEMA_VERSION = 1;
const MAX_EVIDENCE_BYTES = 262_144;
const UNCATEGORIZED_SOURCE_ID = '__catalog_engine_uncategorized__';

function safeDetailError(error) {
  if (error instanceof TenantImportContextError) return error.code;
  const message = String(error?.code || error?.message || error);
  if (/^(supplier|tenant|catalog_provider|sync)_[a-z0-9_]+$/i.test(message)) {
    return message.slice(0, 120);
  }
  return 'sync_detail_failed';
}

function evidenceJson(detail) {
  const value = JSON.stringify({
    name: detail.name,
    description: detail.description,
    images: detail.images,
    classification: detail.classification,
    detailFingerprint: detail.detailFingerprint
  });
  if (new TextEncoder().encode(value).byteLength > MAX_EVIDENCE_BYTES) {
    throw new Error('sync_detail_evidence_too_large');
  }
  return value;
}

async function loadStagedEvidence(context, platform, albumSourceId, fetchImpl) {
  const result = await queryD1Batch(
    {
      ...platform,
      databaseId: context.dataPlane.databaseId,
      batch: [
        {
          sql: `SELECT o.album_source_id, o.public_product_id, o.source_url, o.source_title,
                       o.source_category_id, o.source_category_path_json, o.listing_fingerprint,
                       e.event_type, e.needs_detail,
                       p.key AS path_position,
                       c.category_source_id, c.name AS category_name,
                       c.parent_source_id, c.depth AS category_depth
                  FROM supplier_sync_stage_observations o
                  JOIN supplier_sync_stage_events e
                    ON e.run_id=o.run_id AND e.album_source_id=o.album_source_id
                   AND e.public_product_id=o.public_product_id
                  JOIN supplier_sync_stage_runs r ON r.run_id=o.run_id
                  LEFT JOIN json_each(o.source_category_path_json) p ON TRUE
                  LEFT JOIN supplier_sync_stage_categories c
                    ON c.run_id=o.run_id AND c.category_source_id=CAST(p.value AS TEXT)
                 WHERE o.run_id=?1 AND r.tenant_id=?2 AND r.source_key=?3
                   AND o.album_source_id=?4 AND e.needs_detail=1
                   AND r.safety_outcome='proceed'
                   AND r.state IN ('details_pending','details_complete')
                 ORDER BY CAST(p.key AS INTEGER) ASC`,
          params: [context.importId, context.tenantId, context.sourceKey, albumSourceId]
        }
      ]
    },
    { fetchImpl }
  );
  const rows = result[0]?.results || [];
  if (!rows.length) return null;
  const first = rows[0];
  const categoryPath = rows
    .filter((row) => row.category_source_id)
    .map((row) => ({
      sourceId: String(row.category_source_id),
      name: String(row.category_name || '').trim() || 'Outros',
      parentSourceId: row.parent_source_id ? String(row.parent_source_id) : null,
      depth: Math.max(0, Number(row.category_depth || 0))
    }));
  return {
    albumSourceId: String(first.album_source_id),
    publicProductId: String(first.public_product_id),
    sourceUrl: String(first.source_url),
    sourceTitle: String(first.source_title || ''),
    sourceCategoryId: first.source_category_id ? String(first.source_category_id) : null,
    listingFingerprint: String(first.listing_fingerprint || ''),
    eventType: String(first.event_type || ''),
    categoryPath
  };
}

async function claimCandidateDetail(context, platform, evidence, fetchImpl) {
  const token = crypto.randomUUID();
  const lease = `+${DETAIL_LEASE_MINUTES} minutes`;
  const result = await queryD1Batch(
    {
      ...platform,
      databaseId: context.dataPlane.databaseId,
      batch: [
        {
          sql: `INSERT INTO supplier_sync_stage_product_details
                  (run_id, album_source_id, public_product_id, detail_state, attempt_count, updated_at)
                SELECT ?1, ?4, ?5, 'pending', 0, CURRENT_TIMESTAMP
                 WHERE EXISTS (
                   SELECT 1
                     FROM supplier_sync_stage_runs r
                     JOIN supplier_sync_stage_events e ON e.run_id=r.run_id
                    WHERE r.run_id=?1 AND r.tenant_id=?2 AND r.source_key=?3
                      AND r.state='details_pending' AND r.safety_outcome='proceed'
                      AND e.album_source_id=?4 AND e.public_product_id=?5 AND e.needs_detail=1
                 )
                ON CONFLICT(run_id, public_product_id) DO NOTHING`,
          params: [
            context.importId,
            context.tenantId,
            context.sourceKey,
            evidence.albumSourceId,
            evidence.publicProductId
          ]
        },
        {
          sql: `UPDATE supplier_sync_stage_product_details
                   SET detail_state='processing', claim_token=?6,
                       lease_until=datetime(CURRENT_TIMESTAMP, ?7),
                       attempt_count=attempt_count+1,
                       outcome_code=NULL, last_error_code=NULL,
                       updated_at=CURRENT_TIMESTAMP
                 WHERE run_id=?1 AND album_source_id=?4 AND public_product_id=?5
                   AND attempt_count < CAST(?8 AS INTEGER)
                   AND (
                     detail_state IN ('pending','failed') OR
                     (detail_state='processing' AND (lease_until IS NULL OR lease_until <= CURRENT_TIMESTAMP))
                   )`,
          params: [
            context.importId,
            context.tenantId,
            context.sourceKey,
            evidence.albumSourceId,
            evidence.publicProductId,
            token,
            lease,
            MAX_DETAIL_ATTEMPTS
          ]
        },
        {
          sql: `SELECT detail_state, claim_token, attempt_count, outcome_code, last_error_code
                  FROM supplier_sync_stage_product_details
                 WHERE run_id=?1 AND album_source_id=?4 AND public_product_id=?5
                 LIMIT 1`,
          params: [
            context.importId,
            context.tenantId,
            context.sourceKey,
            evidence.albumSourceId,
            evidence.publicProductId
          ]
        }
      ]
    },
    { fetchImpl }
  );
  const row = result[2]?.results?.[0] || null;
  if (!row) return { outcome: 'missing' };
  const attemptCount = Number(row.attempt_count || 0);
  if (row.detail_state === 'complete') return { outcome: 'complete', attemptCount };
  if (row.detail_state === 'processing' && row.claim_token === token) {
    return { outcome: 'claimed', token, attemptCount };
  }
  if (row.detail_state === 'failed' && attemptCount >= MAX_DETAIL_ATTEMPTS) {
    return { outcome: 'exhausted', attemptCount, error: row.last_error_code || 'sync_detail_retry_exhausted' };
  }
  return { outcome: 'busy', attemptCount };
}

async function categoryDescriptors(evidence, provider) {
  const path = evidence.categoryPath.length
    ? evidence.categoryPath
    : [{ sourceId: UNCATEGORIZED_SOURCE_ID, name: 'Outros', parentSourceId: null, depth: 0 }];
  const descriptors = [];
  for (let index = 0; index < path.length; index += 1) {
    const category = path[index];
    descriptors.push({
      publicId: await provider.publicCategoryId(category.sourceId),
      name: category.name || 'Outros',
      parentPublicId: index > 0 ? await provider.publicCategoryId(path[index - 1].sourceId) : null,
      depth: Math.max(0, Number(category.depth ?? index)),
      sortOrder: index
    });
  }
  return descriptors;
}

async function mediaDescriptors(detail, provider) {
  const output = [];
  for (const image of detail.images || []) {
    output.push({
      id: await provider.mediaId(image.sourceUrl),
      sourceUrl: image.sourceUrl,
      displaySourceUrl: image.displaySourceUrl || image.sourceUrl,
      thumbnailSourceUrl: image.thumbnailSourceUrl || image.displaySourceUrl || image.sourceUrl
    });
  }
  return output;
}

export async function buildIncrementalCandidateDetailBatch({
  context,
  evidence,
  detail,
  claimToken,
  provider
}) {
  const categories = await categoryDescriptors(evidence, provider);
  const leaf = categories.at(-1);
  const normalized = normalizeCatalogProduct(
    {
      name: detail.name,
      sourceName: detail.name,
      category: leaf.name,
      sourceCategoryName: leaf.name,
      description: detail.description
    },
    categories.map((category) => category.name)
  );
  const media = await mediaDescriptors(detail, provider);
  const normalizedEvidenceJson = evidenceJson(detail);
  const runId = context.importId;
  const productId = evidence.publicProductId;
  const batch = [];

  for (const category of categories) {
    batch.push({
      sql: `INSERT INTO supplier_sync_stage_catalog_categories
              (run_id, category_id, name, parent_id, depth, sort_order, product_count, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, CURRENT_TIMESTAMP)
            ON CONFLICT(run_id, category_id) DO UPDATE SET
              name=excluded.name, parent_id=excluded.parent_id, depth=excluded.depth,
              sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP`,
      params: [
        runId,
        category.publicId,
        category.name,
        category.parentPublicId,
        category.depth,
        category.sortOrder
      ]
    });
  }

  batch.push(
    {
      sql: `DELETE FROM supplier_sync_stage_product_media
             WHERE run_id=?1 AND public_product_id=?2`,
      params: [runId, productId]
    },
    {
      sql: `DELETE FROM supplier_sync_stage_product_categories
             WHERE run_id=?1 AND public_product_id=?2`,
      params: [runId, productId]
    }
  );

  for (const item of media) {
    batch.push({
      sql: `INSERT INTO supplier_sync_stage_media_sources
              (run_id, media_id, provider, source_url, display_source_url,
               thumbnail_source_url, referer_url, active, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, CURRENT_TIMESTAMP)
            ON CONFLICT(run_id, media_id) DO UPDATE SET
              provider=excluded.provider, source_url=excluded.source_url,
              display_source_url=excluded.display_source_url,
              thumbnail_source_url=excluded.thumbnail_source_url,
              referer_url=excluded.referer_url, active=1, updated_at=CURRENT_TIMESTAMP`,
      params: [
        runId,
        item.id,
        provider.key,
        item.sourceUrl,
        item.displaySourceUrl,
        item.thumbnailSourceUrl,
        evidence.sourceUrl
      ]
    });
  }

  batch.push({
    sql: `UPDATE supplier_sync_stage_product_details
             SET detail_state='complete', claim_token=NULL, lease_until=NULL,
                 outcome_code='sync_detail_staged', last_error_code=NULL,
                 provider_contract_version=?4, evidence_schema_version=?5,
                 detail_fingerprint=?6, normalized_evidence_json=?7,
                 name=?8, search_text=?9, category_id=?10, category_name=?11,
                 description=?12, image_count=?13, primary_media_id=?14,
                 sort_order=?15, source_name=?16, display_name=?17,
                 source_category_name=?18, display_category_name=?19,
                 team_id=NULL, league_id=NULL,
                 classification_status=NULL, classification_confidence=NULL,
                 processed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
           WHERE run_id=?1 AND public_product_id=?2 AND album_source_id=?3
             AND claim_token=?20 AND detail_state='processing'`,
    params: [
      runId,
      productId,
      evidence.albumSourceId,
      Number(provider.contractVersion || CATALOG_PROVIDER_CONTRACT_VERSION),
      EVIDENCE_SCHEMA_VERSION,
      detail.detailFingerprint,
      normalizedEvidenceJson,
      normalized.displayName,
      normalized.searchText,
      leaf.publicId,
      normalized.displayCategoryName,
      detail.description || '',
      media.length,
      media[0]?.id || null,
      0,
      normalized.sourceName,
      normalized.displayName,
      normalized.sourceCategoryName,
      normalized.displayCategoryName,
      claimToken
    ]
  });

  for (const category of categories) {
    batch.push({
      sql: `INSERT OR IGNORE INTO supplier_sync_stage_product_categories
              (run_id, public_product_id, category_id)
            VALUES (?1, ?2, ?3)`,
      params: [runId, productId, category.publicId]
    });
  }
  for (let position = 0; position < media.length; position += 1) {
    batch.push({
      sql: `INSERT INTO supplier_sync_stage_product_media
              (run_id, public_product_id, media_id, position, updated_at)
            VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP)
            ON CONFLICT(run_id, public_product_id, position) DO UPDATE SET
              media_id=excluded.media_id, updated_at=CURRENT_TIMESTAMP`,
      params: [runId, productId, media[position].id, position]
    });
  }

  return { batch, normalized, media, categories };
}

async function markAttemptFailure(context, platform, evidence, claim, safeCode, fetchImpl, { terminal = false } = {}) {
  const exhausted = terminal || claim.attemptCount >= MAX_DETAIL_ATTEMPTS;
  await queryD1Batch(
    {
      ...platform,
      databaseId: context.dataPlane.databaseId,
      batch: [
        {
          sql: `UPDATE supplier_sync_stage_product_details
                   SET detail_state='failed', claim_token=NULL, lease_until=NULL,
                       outcome_code=?5, last_error_code=?6,
                       processed_at=CASE WHEN ?5='sync_detail_retry_exhausted' THEN CURRENT_TIMESTAMP ELSE processed_at END,
                       updated_at=CURRENT_TIMESTAMP
                 WHERE run_id=?1 AND album_source_id=?2 AND public_product_id=?3
                   AND claim_token=?4 AND detail_state='processing'`,
          params: [
            context.importId,
            evidence.albumSourceId,
            evidence.publicProductId,
            claim.token,
            exhausted ? 'sync_detail_retry_exhausted' : 'sync_detail_retry_scheduled',
            safeCode
          ]
        }
      ]
    },
    { fetchImpl }
  );
  return exhausted
    ? { outcome: 'deferred', error: safeCode }
    : { outcome: 'retry', error: safeCode, delaySeconds: RETRY_DELAY_SECONDS };
}

async function refreshDetailProgress(context, platform, fetchImpl) {
  const result = await queryD1Batch(
    {
      ...platform,
      databaseId: context.dataPlane.databaseId,
      batch: [
        {
          sql: `UPDATE supplier_sync_stage_runs
                   SET state='details_complete', updated_at=CURRENT_TIMESTAMP
                 WHERE run_id=?1 AND tenant_id=?2 AND source_key=?3
                   AND state='details_pending' AND safety_outcome='proceed'
                   AND expected_detail_count > 0
                   AND (SELECT COUNT(*) FROM supplier_sync_stage_product_details d
                         WHERE d.run_id=?1 AND d.detail_state='complete')=expected_detail_count`,
          params: [context.importId, context.tenantId, context.sourceKey]
        },
        {
          sql: `SELECT r.state, r.expected_detail_count,
                       SUM(CASE WHEN d.detail_state='complete' THEN 1 ELSE 0 END) AS complete_count,
                       SUM(CASE WHEN d.detail_state='failed' THEN 1 ELSE 0 END) AS failed_count,
                       SUM(CASE WHEN d.detail_state='failed' AND d.outcome_code='sync_detail_retry_exhausted' THEN 1 ELSE 0 END) AS exhausted_count
                  FROM supplier_sync_stage_runs r
                  LEFT JOIN supplier_sync_stage_product_details d ON d.run_id=r.run_id
                 WHERE r.run_id=?1 AND r.tenant_id=?2 AND r.source_key=?3
                 GROUP BY r.run_id, r.state, r.expected_detail_count`,
          params: [context.importId, context.tenantId, context.sourceKey]
        }
      ]
    },
    { fetchImpl }
  );
  const row = result[1]?.results?.[0] || null;
  if (!row) throw new Error('tenant_sync_stage_missing');
  return {
    state: String(row.state || ''),
    expected: Number(row.expected_detail_count || 0),
    complete: Number(row.complete_count || 0),
    failed: Number(row.failed_count || 0),
    exhausted: Number(row.exhausted_count || 0)
  };
}

async function updateControlProgress(db, context, progress, safeCode = null) {
  const terminalFailure = progress.exhausted > 0;
  await db
    .prepare(
      `UPDATE tenant_import_jobs
          SET status=?2, phase='details',
              completed_detail_count=?3,
              failed_detail_count=?4,
              deferred_detail_count=?5,
              next_attempt_at=NULL,
              last_error_code=?6,
              updated_at=CURRENT_TIMESTAMP
        WHERE import_id=?1 AND tenant_id=?7 AND source_key=?8 AND mode='incremental'`
    )
    .bind(
      context.importId,
      terminalFailure ? 'failed' : 'details',
      progress.complete,
      progress.failed,
      progress.exhausted,
      terminalFailure ? safeCode || 'sync_detail_retry_exhausted' : null,
      context.tenantId,
      context.sourceKey
    )
    .run();
}

export async function handleTenantIncrementalDetailMessage(
  messageValue,
  env,
  { fetchImpl = fetch, queryBatch = queryD1Batch } = {}
) {
  const message = parseTenantImportMessage(messageValue);
  if (message.type !== 'detail') return { outcome: 'unsupported', type: message.type };
  if (!env.CATALOG_DB) return { outcome: 'failed', error: 'database_unbound' };

  try {
    const context = await loadTenantImportContext(env.CATALOG_DB, message, {
      allowedModes: ['incremental']
    });
    if (context.schemaVersion < 6) return { outcome: 'failed', error: 'tenant_schema_not_ready' };
    if (context.phase !== 'details') return { outcome: 'busy', delaySeconds: 60 };
    const provider = resolveCatalogIngestionProvider(context.privateSource.provider);
    const platform = ingestionPlatformConfig(env, context.dataPlane.dispatchNamespace);
    const evidence = await loadStagedEvidence(
      context,
      platform,
      message.albumSourceId,
      fetchImpl
    );
    if (!evidence) return { outcome: 'skipped', reason: 'sync_detail_not_staged' };
    const claim = await claimCandidateDetail(context, platform, evidence, fetchImpl);
    if (claim.outcome === 'complete') {
      const progress = await refreshDetailProgress(context, platform, fetchImpl);
      await updateControlProgress(env.CATALOG_DB, context, progress);
      return { outcome: 'success', alreadyComplete: true, stageState: progress.state };
    }
    if (claim.outcome === 'exhausted') {
      const progress = await refreshDetailProgress(context, platform, fetchImpl);
      await updateControlProgress(env.CATALOG_DB, context, progress, claim.error);
      return { outcome: 'deferred', error: claim.error };
    }
    if (claim.outcome !== 'claimed') return { outcome: 'busy', delaySeconds: 60 };

    let detail;
    try {
      detail = assertCatalogProviderDetailResult(
        await provider.fetchDetail(
          { itemUrl: evidence.sourceUrl, sourceUrl: context.privateSource.url },
          { fetchImpl }
        )
      );
    } catch (error) {
      const safeCode = safeDetailError(error);
      const failure = await markAttemptFailure(
        context,
        platform,
        evidence,
        claim,
        safeCode,
        fetchImpl
      );
      const progress = await refreshDetailProgress(context, platform, fetchImpl);
      await updateControlProgress(env.CATALOG_DB, context, progress, safeCode);
      return failure;
    }

    if (detail.classification.entityType !== 'product') {
      const safeCode = 'sync_detail_not_product';
      const failure = await markAttemptFailure(
        context,
        platform,
        evidence,
        claim,
        safeCode,
        fetchImpl,
        { terminal: true }
      );
      const progress = await refreshDetailProgress(context, platform, fetchImpl);
      await updateControlProgress(env.CATALOG_DB, context, progress, safeCode);
      return failure;
    }
    if (!detail.name || !detail.images.length) {
      const safeCode = 'sync_detail_incomplete';
      const failure = await markAttemptFailure(
        context,
        platform,
        evidence,
        claim,
        safeCode,
        fetchImpl
      );
      const progress = await refreshDetailProgress(context, platform, fetchImpl);
      await updateControlProgress(env.CATALOG_DB, context, progress, safeCode);
      return failure;
    }

    const write = await buildIncrementalCandidateDetailBatch({
      context,
      evidence,
      detail,
      claimToken: claim.token,
      provider
    });
    const written = await queryBatch(
      { ...platform, databaseId: context.dataPlane.databaseId, batch: write.batch },
      { fetchImpl }
    );
    const detailWrite = written.find((row, index) =>
      String(write.batch[index]?.sql || '').includes("SET detail_state='complete'")
    );
    if (Number(detailWrite?.meta?.changes || 0) !== 1) {
      throw new Error('sync_detail_claim_lost');
    }
    const progress = await refreshDetailProgress(context, platform, fetchImpl);
    await updateControlProgress(env.CATALOG_DB, context, progress);
    return {
      outcome: 'success',
      state: 'staged',
      stageState: progress.state,
      completed: progress.complete,
      expected: progress.expected
    };
  } catch (error) {
    return { outcome: 'failed', error: safeDetailError(error) };
  }
}
