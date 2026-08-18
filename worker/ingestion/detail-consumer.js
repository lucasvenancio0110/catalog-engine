import { FACETS, LEAGUES, TEAMS, normalizeCatalogProduct } from '../../src/domain/catalog-normalization.js';
import { queryD1Batch } from '../cloudflare-platform.js';
import { sha256Hex } from '../runtime-identity.js';
import { parseTenantImportMessage } from '../tenant-import-queue.js';
import {
  TenantImportContextError,
  ingestionPlatformConfig,
  loadTenantImportContext
} from './context.js';
import { fetchYupooAlbumDetailWorker, mediaId } from './yupoo-detail.js';

const PUBLIC_ID_NAMESPACE = 'catalog-engine:public-id:v1';
const MAX_DETAIL_ATTEMPTS = 4;
const DETAIL_LEASE_MINUTES = 5;
const RETRY_DELAY_SECONDS = 120;
const TERMINAL_STATES = new Set(['success', 'skipped', 'deferred']);
const UNCATEGORIZED_SOURCE_ID = '__catalog_engine_uncategorized__';

function safeDetailError(error) {
  if (error instanceof TenantImportContextError) return error.code;
  const message = String(error?.message || error);
  if (/^supplier_[a-z0-9_]+$/i.test(message)) return message.slice(0, 120);
  if (/^tenant_[a-z0-9_]+$/i.test(message)) return message.slice(0, 120);
  return 'tenant_import_detail_failed';
}

async function publicCategoryId(sourceId) {
  const digest = await sha256Hex(`${PUBLIC_ID_NAMESPACE}|yupoo|${String(sourceId)}`);
  return `c_${digest.slice(0, 20)}`;
}

async function loadAlbumEvidence(context, platform, albumSourceId, fetchImpl) {
  const result = await queryD1Batch(
    {
      ...platform,
      databaseId: context.dataPlane.databaseId,
      batch: [
        {
          sql: `SELECT a.album_source_id, a.public_product_id, a.source_url, a.source_title,
                       a.source_category_id, a.source_category_path_json, a.listing_fingerprint,
                       p.key AS path_position,
                       c.category_source_id, c.name AS category_name,
                       c.parent_source_id, c.depth AS category_depth
                  FROM supplier_album_index a
                  LEFT JOIN json_each(a.source_category_path_json) p ON TRUE
                  LEFT JOIN supplier_category_index c
                    ON c.tenant_id=a.tenant_id AND c.source_key=a.source_key
                   AND c.category_source_id=CAST(p.value AS TEXT)
                 WHERE a.tenant_id=?1 AND a.source_key=?2 AND a.album_source_id=?3
                   AND a.status='active'
                 ORDER BY CAST(p.key AS INTEGER) ASC`,
          params: [context.tenantId, context.sourceKey, albumSourceId]
        }
      ]
    },
    { fetchImpl }
  );
  const rows = result[0]?.results || [];
  if (!rows.length) return null;
  const first = rows[0];
  const path = rows
    .filter((row) => row.category_source_id)
    .map((row) => ({
      sourceId: String(row.category_source_id),
      name: String(row.category_name || '').trim() || 'Outros',
      parentSourceId: row.parent_source_id ? String(row.parent_source_id) : null,
      depth: Number(row.category_depth || 0)
    }));
  return {
    albumSourceId: String(first.album_source_id),
    publicProductId: String(first.public_product_id),
    sourceUrl: String(first.source_url),
    sourceTitle: String(first.source_title || ''),
    sourceCategoryId: first.source_category_id ? String(first.source_category_id) : null,
    listingFingerprint: String(first.listing_fingerprint || ''),
    categoryPath: path
  };
}

async function claimAlbum(context, platform, albumSourceId, fetchImpl) {
  const token = crypto.randomUUID();
  const lease = `+${DETAIL_LEASE_MINUTES} minutes`;
  const result = await queryD1Batch(
    {
      ...platform,
      databaseId: context.dataPlane.databaseId,
      batch: [
        {
          sql: `INSERT INTO supplier_album_detail_state
                  (tenant_id, source_key, album_source_id, import_id, state, attempt_count, updated_at)
                VALUES (?1, ?2, ?3, ?4, 'pending', 0, CURRENT_TIMESTAMP)
                ON CONFLICT(tenant_id, source_key, album_source_id) DO NOTHING`,
          params: [context.tenantId, context.sourceKey, albumSourceId, context.importId]
        },
        {
          sql: `UPDATE supplier_album_detail_state
                   SET state='processing', claim_token=?5,
                       lease_until=datetime(CURRENT_TIMESTAMP, ?6),
                       attempt_count=attempt_count+1,
                       outcome_code=NULL, last_error_code=NULL,
                       updated_at=CURRENT_TIMESTAMP
                 WHERE tenant_id=?1 AND source_key=?2 AND album_source_id=?3 AND import_id=?4
                   AND (
                     state IN ('pending','failed') OR
                     (state='processing' AND (lease_until IS NULL OR lease_until <= CURRENT_TIMESTAMP))
                   )`,
          params: [context.tenantId, context.sourceKey, albumSourceId, context.importId, token, lease]
        },
        {
          sql: `SELECT state, claim_token, attempt_count, outcome_code
                  FROM supplier_album_detail_state
                 WHERE tenant_id=?1 AND source_key=?2 AND album_source_id=?3 AND import_id=?4
                 LIMIT 1`,
          params: [context.tenantId, context.sourceKey, albumSourceId, context.importId]
        }
      ]
    },
    { fetchImpl }
  );
  const row = result[2]?.results?.[0];
  if (!row) return { outcome: 'missing' };
  if (TERMINAL_STATES.has(row.state)) {
    return { outcome: 'complete', state: row.state, attemptCount: Number(row.attempt_count || 0) };
  }
  if (row.state === 'processing' && row.claim_token === token) {
    return { outcome: 'claimed', token, attemptCount: Number(row.attempt_count || 1) };
  }
  return { outcome: 'busy', attemptCount: Number(row.attempt_count || 0) };
}

async function categoryDescriptors(evidence) {
  const path = evidence.categoryPath.length
    ? evidence.categoryPath
    : [{ sourceId: UNCATEGORIZED_SOURCE_ID, name: 'Outros', parentSourceId: null, depth: 0 }];
  const descriptors = [];
  for (let index = 0; index < path.length; index += 1) {
    const category = path[index];
    descriptors.push({
      sourceId: category.sourceId,
      publicId: await publicCategoryId(category.sourceId),
      name: category.name || 'Outros',
      parentPublicId: index > 0 ? await publicCategoryId(path[index - 1].sourceId) : null,
      depth: Math.max(0, Number(category.depth ?? index)),
      sortOrder: index
    });
  }
  return descriptors;
}

function entityDefinitionById(collection, id) {
  return id ? collection.find((entry) => entry.id === id) || null : null;
}

async function mediaDescriptors(detail) {
  const output = [];
  for (const image of detail.images || []) {
    output.push({
      id: await mediaId(image.sourceUrl),
      sourceUrl: image.sourceUrl,
      displaySourceUrl: image.displaySourceUrl || image.sourceUrl,
      thumbnailSourceUrl: image.thumbnailSourceUrl || image.displaySourceUrl || image.sourceUrl
    });
  }
  return output;
}

export async function buildTenantProductWriteBatch({ context, evidence, detail, claimToken }) {
  const categories = await categoryDescriptors(evidence);
  const leaf = categories.at(-1);
  const categoryPathNames = categories.map((category) => category.name);
  const normalized = normalizeCatalogProduct(
    {
      name: detail.name,
      sourceName: detail.name,
      category: leaf.name,
      sourceCategoryName: leaf.name,
      description: detail.description
    },
    categoryPathNames
  );
  const media = await mediaDescriptors(detail);
  const league = entityDefinitionById(LEAGUES, normalized.league?.id);
  const team = entityDefinitionById(TEAMS, normalized.team?.id);
  const facets = normalized.facets
    .map((facet) => entityDefinitionById(FACETS, facet.id))
    .filter(Boolean);
  const p = evidence.publicProductId;
  const t = context.tenantId;
  const s = context.sourceKey;
  const a = evidence.albumSourceId;
  const batch = [];

  for (const category of categories) {
    batch.push({
      sql: `INSERT INTO catalog_categories
              (category_id, name, parent_id, depth, sort_order, product_count, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, 0, CURRENT_TIMESTAMP)
            ON CONFLICT(category_id) DO UPDATE SET
              name=excluded.name, parent_id=excluded.parent_id, depth=excluded.depth,
              sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP`,
      params: [category.publicId, category.name, category.parentPublicId, category.depth, category.sortOrder]
    });
  }

  if (league) {
    batch.push({
      sql: `INSERT INTO catalog_leagues
              (league_id, name, country_code, country_name, entity_type, logo_url, sort_order, product_count, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, CURRENT_TIMESTAMP)
            ON CONFLICT(league_id) DO UPDATE SET
              name=excluded.name, country_code=excluded.country_code, country_name=excluded.country_name,
              entity_type=excluded.entity_type, logo_url=excluded.logo_url,
              sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP`,
      params: [
        league.id,
        league.name,
        league.countryCode,
        league.countryName,
        league.entityType,
        league.logoUrl || null,
        Number(league.sortOrder || 0)
      ]
    });
  }
  if (team) {
    batch.push({
      sql: `INSERT INTO catalog_teams
              (team_id, name, short_name, league_id, country_code, entity_type, logo_url, initials, sort_order, product_count, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, CURRENT_TIMESTAMP)
            ON CONFLICT(team_id) DO UPDATE SET
              name=excluded.name, short_name=excluded.short_name, league_id=excluded.league_id,
              country_code=excluded.country_code, entity_type=excluded.entity_type,
              logo_url=excluded.logo_url, initials=excluded.initials,
              sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP`,
      params: [
        team.id,
        team.name,
        team.shortName,
        team.leagueId || null,
        team.countryCode || null,
        team.entityType,
        team.logoUrl || null,
        team.initials,
        Number(team.sortOrder || 0)
      ]
    });
  }
  for (const facet of facets) {
    batch.push({
      sql: `INSERT INTO catalog_facets
              (facet_id, facet_type, name, sort_order, product_count, updated_at)
            VALUES (?1, ?2, ?3, ?4, 0, CURRENT_TIMESTAMP)
            ON CONFLICT(facet_id) DO UPDATE SET
              facet_type=excluded.facet_type, name=excluded.name,
              sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP`,
      params: [facet.id, facet.type, facet.name, Number(facet.sortOrder || 0)]
    });
  }

  batch.push(
    { sql: 'DELETE FROM catalog_product_facets WHERE product_id=?1', params: [p] },
    { sql: 'DELETE FROM catalog_product_categories WHERE product_id=?1', params: [p] },
    { sql: 'DELETE FROM product_media WHERE product_id=?1', params: [p] }
  );

  for (const item of media) {
    batch.push({
      sql: `INSERT INTO media_sources
              (media_id, provider, source_url, display_source_url, thumbnail_source_url,
               referer_url, active, updated_at)
            VALUES (?1, 'yupoo', ?2, ?3, ?4, ?5, 1, CURRENT_TIMESTAMP)
            ON CONFLICT(media_id) DO UPDATE SET
              source_url=excluded.source_url, display_source_url=excluded.display_source_url,
              thumbnail_source_url=excluded.thumbnail_source_url, referer_url=excluded.referer_url,
              active=1, updated_at=CURRENT_TIMESTAMP`,
      params: [
        item.id,
        item.sourceUrl,
        item.displaySourceUrl,
        item.thumbnailSourceUrl,
        evidence.sourceUrl
      ]
    });
  }

  batch.push({
    sql: `INSERT INTO catalog_products
            (product_id, name, search_text, category_id, category_name, description,
             image_count, primary_media_id, sort_order, source_name, display_name,
             source_category_name, display_category_name, team_id, league_id,
             classification_status, classification_confidence, updated_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, CURRENT_TIMESTAMP)
          ON CONFLICT(product_id) DO UPDATE SET
            name=excluded.name, search_text=excluded.search_text,
            category_id=excluded.category_id, category_name=excluded.category_name,
            description=excluded.description, image_count=excluded.image_count,
            primary_media_id=excluded.primary_media_id, source_name=excluded.source_name,
            display_name=excluded.display_name, source_category_name=excluded.source_category_name,
            display_category_name=excluded.display_category_name, team_id=excluded.team_id,
            league_id=excluded.league_id, classification_status=excluded.classification_status,
            classification_confidence=excluded.classification_confidence, updated_at=CURRENT_TIMESTAMP`,
    params: [
      p,
      normalized.displayName,
      normalized.searchText,
      leaf.publicId,
      normalized.displayCategoryName,
      detail.description || '',
      media.length,
      media[0]?.id || null,
      normalized.sourceName,
      normalized.displayName,
      normalized.sourceCategoryName,
      normalized.displayCategoryName,
      normalized.team?.id || null,
      normalized.league?.id || null,
      normalized.classificationStatus,
      normalized.classificationConfidence
    ]
  });

  for (const category of categories) {
    batch.push({
      sql: `INSERT OR IGNORE INTO catalog_product_categories (product_id, category_id) VALUES (?1, ?2)`,
      params: [p, category.publicId]
    });
  }
  for (let position = 0; position < media.length; position += 1) {
    batch.push({
      sql: `INSERT INTO product_media (product_id, media_id, position, updated_at)
            VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)
            ON CONFLICT(product_id, position) DO UPDATE SET
              media_id=excluded.media_id, updated_at=CURRENT_TIMESTAMP`,
      params: [p, media[position].id, position]
    });
  }
  for (const facet of facets) {
    batch.push({
      sql: `INSERT OR IGNORE INTO catalog_product_facets (product_id, facet_id) VALUES (?1, ?2)`,
      params: [p, facet.id]
    });
  }

  batch.push(
    {
      sql: `UPDATE supplier_album_index
               SET detail_fingerprint=?4, last_detail_at=CURRENT_TIMESTAMP,
                   detail_retry_count=0, detail_retry_after=NULL, detail_last_error=NULL,
                   updated_at=CURRENT_TIMESTAMP
             WHERE tenant_id=?1 AND source_key=?2 AND album_source_id=?3`,
      params: [t, s, a, detail.detailFingerprint]
    },
    {
      sql: `UPDATE supplier_album_detail_state
               SET state='success', claim_token=NULL, lease_until=NULL,
                   outcome_code='published', last_error_code=NULL,
                   detail_fingerprint=?5, processed_at=CURRENT_TIMESTAMP,
                   updated_at=CURRENT_TIMESTAMP
             WHERE tenant_id=?1 AND source_key=?2 AND album_source_id=?3
               AND import_id=?4 AND claim_token=?6 AND state='processing'`,
      params: [t, s, a, context.importId, detail.detailFingerprint, claimToken]
    }
  );

  return { batch, normalized, media, categories };
}

async function buildSkipBatch({ context, evidence, detail, claimToken }) {
  return [
    { sql: 'DELETE FROM product_media WHERE product_id=?1', params: [evidence.publicProductId] },
    { sql: 'DELETE FROM catalog_products WHERE product_id=?1', params: [evidence.publicProductId] },
    {
      sql: `UPDATE supplier_album_index
               SET detail_fingerprint=?4, last_detail_at=CURRENT_TIMESTAMP,
                   detail_retry_count=0, detail_retry_after=NULL, detail_last_error=NULL,
                   updated_at=CURRENT_TIMESTAMP
             WHERE tenant_id=?1 AND source_key=?2 AND album_source_id=?3`,
      params: [context.tenantId, context.sourceKey, evidence.albumSourceId, detail.detailFingerprint]
    },
    {
      sql: `UPDATE supplier_album_detail_state
               SET state='skipped', claim_token=NULL, lease_until=NULL,
                   outcome_code=?5, last_error_code=NULL, detail_fingerprint=?6,
                   processed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
             WHERE tenant_id=?1 AND source_key=?2 AND album_source_id=?3
               AND import_id=?4 AND claim_token=?7 AND state='processing'`,
      params: [
        context.tenantId,
        context.sourceKey,
        evidence.albumSourceId,
        context.importId,
        detail.classification.entityType,
        detail.detailFingerprint,
        claimToken
      ]
    }
  ];
}

async function markAttemptFailure(context, platform, evidence, claim, safeCode, fetchImpl) {
  const terminal = claim.attemptCount >= MAX_DETAIL_ATTEMPTS;
  await queryD1Batch(
    {
      ...platform,
      databaseId: context.dataPlane.databaseId,
      batch: [
        {
          sql: `UPDATE supplier_album_detail_state
                   SET state=?6, claim_token=NULL, lease_until=NULL,
                       outcome_code=?7, last_error_code=?5,
                       processed_at=CASE WHEN ?6='deferred' THEN CURRENT_TIMESTAMP ELSE processed_at END,
                       updated_at=CURRENT_TIMESTAMP
                 WHERE tenant_id=?1 AND source_key=?2 AND album_source_id=?3
                   AND import_id=?4 AND claim_token=?8 AND state='processing'`,
          params: [
            context.tenantId,
            context.sourceKey,
            evidence.albumSourceId,
            context.importId,
            safeCode,
            terminal ? 'deferred' : 'failed',
            terminal ? 'retry_exhausted' : 'retry_scheduled',
            claim.token
          ]
        },
        {
          sql: `UPDATE supplier_album_index
                   SET detail_retry_count=?4,
                       detail_retry_after=CASE WHEN ?5=1 THEN NULL ELSE datetime(CURRENT_TIMESTAMP,'+2 minutes') END,
                       detail_last_error=?6,
                       updated_at=CURRENT_TIMESTAMP
                 WHERE tenant_id=?1 AND source_key=?2 AND album_source_id=?3`,
          params: [
            context.tenantId,
            context.sourceKey,
            evidence.albumSourceId,
            claim.attemptCount,
            terminal ? 1 : 0,
            safeCode
          ]
        }
      ]
    },
    { fetchImpl }
  );
  return terminal
    ? { outcome: 'deferred', error: safeCode }
    : { outcome: 'retry', error: safeCode, delaySeconds: RETRY_DELAY_SECONDS };
}

export async function handleTenantImportDetailMessage(
  messageValue,
  env,
  { fetchImpl = fetch } = {}
) {
  const message = parseTenantImportMessage(messageValue);
  if (message.type !== 'detail') return { outcome: 'unsupported', type: message.type };
  if (!env.CATALOG_DB) return { outcome: 'failed', error: 'database_unbound' };

  try {
    const context = await loadTenantImportContext(env.CATALOG_DB, message);
    if (context.phase !== 'details') return { outcome: 'busy', delaySeconds: 60 };
    const platform = ingestionPlatformConfig(env, context.dataPlane.dispatchNamespace);
    const evidence = await loadAlbumEvidence(context, platform, message.albumSourceId, fetchImpl);
    if (!evidence) return { outcome: 'skipped', reason: 'album_not_found' };
    const claim = await claimAlbum(context, platform, evidence.albumSourceId, fetchImpl);
    if (claim.outcome === 'complete') return { outcome: 'success', alreadyComplete: true, state: claim.state };
    if (claim.outcome !== 'claimed') return { outcome: 'busy', delaySeconds: 60 };

    let detail;
    try {
      detail = await fetchYupooAlbumDetailWorker(evidence.sourceUrl, context.privateSource.url, {
        fetchImpl
      });
    } catch (error) {
      return markAttemptFailure(
        context,
        platform,
        evidence,
        claim,
        safeDetailError(error),
        fetchImpl
      );
    }

    if (detail.classification.entityType !== 'product') {
      const batch = await buildSkipBatch({ context, evidence, detail, claimToken: claim.token });
      await queryD1Batch(
        { ...platform, databaseId: context.dataPlane.databaseId, batch },
        { fetchImpl }
      );
      return { outcome: 'success', state: 'skipped' };
    }

    if (!detail.name || !detail.images.length) {
      return markAttemptFailure(
        context,
        platform,
        evidence,
        claim,
        'supplier_album_incomplete',
        fetchImpl
      );
    }

    const write = await buildTenantProductWriteBatch({
      context,
      evidence,
      detail,
      claimToken: claim.token
    });
    await queryD1Batch(
      { ...platform, databaseId: context.dataPlane.databaseId, batch: write.batch },
      { fetchImpl }
    );
    return {
      outcome: 'success',
      state: 'published',
      classificationStatus: write.normalized.classificationStatus
    };
  } catch (error) {
    return { outcome: 'failed', error: safeDetailError(error) };
  }
}
