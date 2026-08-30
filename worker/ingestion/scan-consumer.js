import { assertCatalogProviderScanResult } from '../../src/catalog-provider/provider-contract.js';
import { queryD1Batch } from '../cloudflare-platform.js';
import {
  assertPublicSafeImportMessage,
  buildTenantImportDetailMessage,
  parseTenantImportMessage
} from '../tenant-import-queue.js';
import {
  TenantImportContextError,
  ingestionPlatformConfig,
  loadTenantImportContext
} from './context.js';
import { handleTenantIncrementalScan } from './incremental-scan-consumer.js';
import { resolveCatalogIngestionProvider } from './providers/index.js';
import {
  claimTenantSyncPhaseLease,
  failTenantSyncPhaseLease,
  releaseTenantSyncPhaseLease
} from '../tenant-sync-phase-lease.js';

const INDEX_WRITE_BATCH = 75;
const DETAIL_QUEUE_BATCH = 100;
const SCAN_LEASE_MINUTES = 14;

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function safeScanError(error) {
  if (error instanceof TenantImportContextError) return error.code;
  const message = String(error?.code || error?.message || error);
  if (/^(supplier|tenant_import|tenant_sync|sync|catalog_provider)_[a-z0-9_]+$/i.test(message)) {
    return message.slice(0, 120);
  }
  return 'tenant_import_scan_failed';
}

async function failedScanRetryDue(db, context) {
  if (context.importStatus !== 'failed') return true;
  const row = await db
    .prepare(
      `SELECT CASE
                WHEN next_attempt_at IS NOT NULL AND next_attempt_at<=CURRENT_TIMESTAMP THEN 1
                ELSE 0
              END AS retry_due
         FROM tenant_import_jobs
        WHERE import_id=?1 AND tenant_id=?2 AND source_key=?3
        LIMIT 1`
    )
    .bind(context.importId, context.tenantId, context.sourceKey)
    .first();
  return Number(row?.retry_due || 0) === 1;
}

async function claimScanLease(db, context) {
  if (
    context.phase === 'details' &&
    context.discoveredCount > 0 &&
    context.detailEnqueueCursor >= context.discoveredCount
  ) {
    return { claimed: false, complete: true };
  }

  const ownership = await claimTenantSyncPhaseLease(
    db,
    {
      import_id: context.importId,
      tenant_id: context.tenantId,
      source_key: context.sourceKey,
      mode: context.mode
    },
    'scan'
  );
  if (!ownership) return { claimed: false, complete: false };
  const result = await db
    .prepare(
      `UPDATE tenant_import_jobs
          SET status='scanning',scan_lease_until=phase_lease_until,
              started_at=COALESCE(started_at,CURRENT_TIMESTAMP),
              last_error_code=NULL,
              updated_at=CURRENT_TIMESTAMP
        WHERE import_id=?1
          AND tenant_id=?2 AND source_key=?3
          AND status IN ('queued','scanning','details')
          AND phase_lease_kind='scan' AND phase_lease_token=?4
          AND (?5 IS NULL OR state_revision=CAST(?5 AS INTEGER))`
    )
    .bind(
      context.importId,
      context.tenantId,
      context.sourceKey,
      ownership.token,
      ownership.revision
    )
    .run();
  if (Number(result.meta?.changes || 0) === 1) {
    return { claimed: true, complete: false, ownership };
  }
  await releaseTenantSyncPhaseLease(
    db,
    {
      import_id: context.importId,
      tenant_id: context.tenantId,
      source_key: context.sourceKey
    },
    ownership
  ).catch(() => {});
  return { claimed: false, complete: false };
}

function categoryInsert(category, context, sortOrder) {
  return {
    sql: `INSERT INTO supplier_category_index
      (tenant_id, source_key, category_source_id, name, parent_source_id, depth, sort_order, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, CURRENT_TIMESTAMP)
      ON CONFLICT(tenant_id, source_key, category_source_id) DO UPDATE SET
        name=excluded.name,
        parent_source_id=excluded.parent_source_id,
        depth=excluded.depth,
        sort_order=excluded.sort_order,
        updated_at=CURRENT_TIMESTAMP`,
    params: [
      context.tenantId,
      context.sourceKey,
      String(category.id),
      String(category.name || '').trim() || `Categoria ${category.id}`,
      category.parentId ? String(category.parentId) : null,
      Math.max(0, Number(category.depth || 0)),
      sortOrder
    ]
  };
}

function indexInsert(item, context) {
  return {
    sql: `INSERT INTO supplier_album_index
      (tenant_id, source_key, album_source_id, public_product_id, source_url, source_title,
       source_category_id, source_category_path_json, cover_source_url, image_count_hint,
       listing_fingerprint, detail_fingerprint, status, miss_count,
       first_seen_at, last_seen_at, last_changed_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, NULL,
              'active', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(tenant_id, source_key, album_source_id) DO UPDATE SET
        public_product_id=excluded.public_product_id,
        source_url=excluded.source_url,
        source_title=excluded.source_title,
        source_category_id=excluded.source_category_id,
        source_category_path_json=excluded.source_category_path_json,
        cover_source_url=excluded.cover_source_url,
        image_count_hint=excluded.image_count_hint,
        listing_fingerprint=excluded.listing_fingerprint,
        detail_fingerprint=NULL,
        status='active',
        miss_count=0,
        detail_retry_count=0,
        detail_retry_after=NULL,
        detail_last_error=NULL,
        last_seen_at=CURRENT_TIMESTAMP,
        last_changed_at=CASE
          WHEN supplier_album_index.listing_fingerprint != excluded.listing_fingerprint THEN CURRENT_TIMESTAMP
          ELSE supplier_album_index.last_changed_at
        END,
        updated_at=CURRENT_TIMESTAMP`,
    params: [
      context.tenantId,
      context.sourceKey,
      item.albumSourceId,
      item.publicProductId,
      item.sourceUrl,
      item.sourceTitle,
      item.sourceCategoryId,
      JSON.stringify(item.sourceCategoryPath || []),
      item.coverSourceUrl,
      item.imageCountHint,
      item.listingFingerprint
    ]
  };
}

async function persistCompleteListingScan(context, scan, platform, fetchImpl) {
  await queryD1Batch(
    {
      ...platform,
      databaseId: context.dataPlane.databaseId,
      batch: [
        {
          sql: `DELETE FROM supplier_album_index
                 WHERE tenant_id=?1 AND source_key=?2`,
          params: [context.tenantId, context.sourceKey]
        },
        {
          sql: `DELETE FROM supplier_category_index
                 WHERE tenant_id=?1 AND source_key=?2`,
          params: [context.tenantId, context.sourceKey]
        }
      ]
    },
    { fetchImpl }
  );

  const categories = (scan.taxonomy || []).map((category, index) =>
    categoryInsert(category, context, index)
  );
  for (const group of chunks(categories, INDEX_WRITE_BATCH)) {
    if (!group.length) continue;
    await queryD1Batch(
      { ...platform, databaseId: context.dataPlane.databaseId, batch: group },
      { fetchImpl }
    );
  }

  for (const group of chunks(scan.items, INDEX_WRITE_BATCH)) {
    await queryD1Batch(
      {
        ...platform,
        databaseId: context.dataPlane.databaseId,
        batch: group.map((item) => indexInsert(item, context))
      },
      { fetchImpl }
    );
  }
}

async function markScanPersisted(db, context, scan, ownership) {
  const result = await db
    .prepare(
      `UPDATE tenant_import_jobs
          SET status='scanning', phase='details',
              discovered_count=?2,
              detail_enqueue_cursor=0,
              queued_detail_count=0,
              completed_detail_count=0,
              failed_detail_count=0,
              deferred_detail_count=0,
              scan_completed_at=CURRENT_TIMESTAMP,
              scan_lease_until=datetime(CURRENT_TIMESTAMP, ?3),
              phase_lease_until=datetime(CURRENT_TIMESTAMP, ?3),
              last_error_code=NULL,
              updated_at=CURRENT_TIMESTAMP
        WHERE import_id=?1 AND tenant_id=?4 AND source_key=?5
          AND phase_lease_kind='scan' AND phase_lease_token=?6
          AND (?7 IS NULL OR state_revision=CAST(?7 AS INTEGER))`
    )
    .bind(
      context.importId,
      scan.items.length,
      `+${SCAN_LEASE_MINUTES} minutes`,
      context.tenantId,
      context.sourceKey,
      ownership.token,
      ownership.revision
    )
    .run();
  if (Number(result?.meta?.changes || 0) !== 1) {
    throw new Error('tenant_import_scan_ownership_lost');
  }
}

async function nextAlbumIds(context, platform, cursor, fetchImpl) {
  const result = await queryD1Batch(
    {
      ...platform,
      databaseId: context.dataPlane.databaseId,
      batch: [
        {
          sql: `SELECT album_source_id
                  FROM supplier_album_index
                 WHERE tenant_id=?1 AND source_key=?2 AND status='active'
                 ORDER BY album_source_id ASC
                 LIMIT ?3 OFFSET ?4`,
          params: [context.tenantId, context.sourceKey, DETAIL_QUEUE_BATCH, cursor]
        }
      ]
    },
    { fetchImpl }
  );
  return (result[0]?.results || []).map((row) => String(row.album_source_id)).filter(Boolean);
}

async function updateFanoutCursor(db, context, previousCursor, nextCursor, ownership) {
  const result = await db
    .prepare(
      `UPDATE tenant_import_jobs
          SET detail_enqueue_cursor=?2,
              queued_detail_count=?2,
              scan_lease_until=datetime(CURRENT_TIMESTAMP, ?3),
              phase_lease_until=datetime(CURRENT_TIMESTAMP, ?3),
              updated_at=CURRENT_TIMESTAMP
        WHERE import_id=?1 AND tenant_id=?4
          AND source_key=?5 AND detail_enqueue_cursor=?6
          AND phase_lease_kind='scan' AND phase_lease_token=?7
          AND (?8 IS NULL OR state_revision=CAST(?8 AS INTEGER))`
    )
    .bind(
      context.importId,
      nextCursor,
      `+${SCAN_LEASE_MINUTES} minutes`,
      context.tenantId,
      context.sourceKey,
      previousCursor,
      ownership.token,
      ownership.revision
    )
    .run();
  if (Number(result.meta?.changes || 0) !== 1) throw new Error('tenant_import_fanout_cursor_conflict');
}

async function finishFanout(db, context, discoveredCount, ownership) {
  const result = await db
    .prepare(
      `UPDATE tenant_import_jobs
          SET status='details', phase='details',
              detail_enqueue_cursor=?2,
              queued_detail_count=?2,
              scan_lease_until=NULL,
              next_attempt_at=NULL,
              last_error_code=NULL,
              recovery_attempt_count=0,last_failure_phase=NULL,
              phase_lease_kind=NULL,phase_lease_token=NULL,phase_lease_until=NULL,
              state_revision=state_revision+1,
              updated_at=CURRENT_TIMESTAMP
        WHERE import_id=?1 AND tenant_id=?3 AND source_key=?4
          AND phase_lease_kind='scan' AND phase_lease_token=?5
          AND (?6 IS NULL OR state_revision=CAST(?6 AS INTEGER))`
    )
    .bind(
      context.importId,
      discoveredCount,
      context.tenantId,
      context.sourceKey,
      ownership.token,
      ownership.revision
    )
    .run();
  if (Number(result?.meta?.changes || 0) !== 1) {
    throw new Error('tenant_import_scan_ownership_lost');
  }
}

async function fanOutDetails(db, context, platform, detailQueue, fetchImpl, ownership) {
  let cursor = context.detailEnqueueCursor;
  const discoveredCount = context.discoveredCount;

  while (cursor < discoveredCount) {
    const albumIds = await nextAlbumIds(context, platform, cursor, fetchImpl);
    if (!albumIds.length) throw new Error('tenant_import_listing_index_incomplete');
    const messages = albumIds.map((albumSourceId) => ({
      body: assertPublicSafeImportMessage(
        buildTenantImportDetailMessage({
          importId: context.importId,
          tenantId: context.tenantId,
          sourceKey: context.sourceKey,
          albumSourceId
        })
      ),
      contentType: 'json'
    }));
    await detailQueue.sendBatch(messages);
    const nextCursor = cursor + albumIds.length;
    await updateFanoutCursor(db, context, cursor, nextCursor, ownership);
    cursor = nextCursor;
  }

  await finishFanout(db, context, discoveredCount, ownership);
  return cursor;
}

export async function handleTenantImportScanMessage(
  messageValue,
  env,
  { fetchImpl = fetch } = {}
) {
  const message = parseTenantImportMessage(messageValue);
  if (message.type !== 'scan') return { outcome: 'unsupported', type: message.type };
  if (!env.CATALOG_DB) return { outcome: 'failed', error: 'database_unbound' };
  if (!env.TENANT_IMPORT_DETAIL_QUEUE || typeof env.TENANT_IMPORT_DETAIL_QUEUE.sendBatch !== 'function') {
    return { outcome: 'failed', error: 'tenant_import_detail_queue_unbound' };
  }

  const db = env.CATALOG_DB;
  let leaseOwned = null;
  try {
    let context = await loadTenantImportContext(db, message, {
      allowedModes: ['initial', 'incremental']
    });
    const retryDue = await failedScanRetryDue(db, context);
    if (!retryDue) {
      return { outcome: 'success', alreadyFailed: true };
    }
    context = { ...context, retryDue };
    const provider = resolveCatalogIngestionProvider(context.privateSource.provider);
    const platform = ingestionPlatformConfig(env, context.dataPlane.dispatchNamespace);

    if (context.mode === 'incremental') {
      return await handleTenantIncrementalScan(
        {
          db,
          context,
          provider,
          platform,
          detailQueue: env.TENANT_IMPORT_DETAIL_QUEUE
        },
        { fetchImpl }
      );
    }

    const lease = await claimScanLease(db, context);
    if (lease.complete) return { outcome: 'success', alreadyComplete: true };
    if (!lease.claimed) return { outcome: 'busy' };
    leaseOwned = lease.ownership;

    if (context.phase === 'scan') {
      const scan = assertCatalogProviderScanResult(
        await provider.scanListingIndex(context.privateSource.url, { fetchImpl })
      );
      if (scan.items.length === 0) throw new Error('supplier_listing_empty');
      await persistCompleteListingScan(context, scan, platform, fetchImpl);
      await markScanPersisted(db, context, scan, leaseOwned);
      context = {
        ...context,
        phase: 'details',
        discoveredCount: scan.items.length,
        detailEnqueueCursor: 0
      };
    }

    const queued = await fanOutDetails(
      db,
      context,
      platform,
      env.TENANT_IMPORT_DETAIL_QUEUE,
      fetchImpl,
      leaseOwned
    );
    return { outcome: 'success', discovered: context.discoveredCount, queued };
  } catch (error) {
    const safeCode = safeScanError(error);
    if (leaseOwned) {
      await failTenantSyncPhaseLease(
        db,
        {
          import_id: message.importId,
          tenant_id: message.tenantId,
          source_key: message.sourceKey
        },
        leaseOwned,
        safeCode
      ).catch(() => {});
    }
    return { outcome: 'failed', error: safeCode };
  } finally {
    if (leaseOwned) {
      await releaseTenantSyncPhaseLease(
        db,
        {
          import_id: message.importId,
          tenant_id: message.tenantId,
          source_key: message.sourceKey
        },
        leaseOwned
      ).catch(() => {});
    }
  }
}
