function text(value) {
  return String(value ?? '').trim();
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function eventProductId(event) {
  return text(event?.current?.publicProductId || event?.previous?.publicProductId);
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
      text(category.id),
      text(category.name) || `Categoria ${text(category.id)}`,
      category.parentId ? text(category.parentId) : null,
      Math.max(0, Number(category.depth || 0)),
      sortOrder
    ]
  };
}

function observedIndexUpsert(item, context, needsDetail) {
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
        detail_fingerprint=CASE WHEN ?12=1 THEN NULL ELSE supplier_album_index.detail_fingerprint END,
        status='active',
        miss_count=0,
        detail_retry_count=CASE WHEN ?12=1 THEN 0 ELSE supplier_album_index.detail_retry_count END,
        detail_retry_after=CASE WHEN ?12=1 THEN NULL ELSE supplier_album_index.detail_retry_after END,
        detail_last_error=CASE WHEN ?12=1 THEN NULL ELSE supplier_album_index.detail_last_error END,
        last_seen_at=CURRENT_TIMESTAMP,
        last_changed_at=CASE
          WHEN supplier_album_index.listing_fingerprint != excluded.listing_fingerprint
            OR supplier_album_index.status != 'active'
            OR supplier_album_index.source_category_id IS NOT excluded.source_category_id
            OR supplier_album_index.source_category_path_json != excluded.source_category_path_json
          THEN CURRENT_TIMESTAMP
          ELSE supplier_album_index.last_changed_at
        END,
        listing_fingerprint=excluded.listing_fingerprint,
        updated_at=CURRENT_TIMESTAMP`,
    params: [
      context.tenantId,
      context.sourceKey,
      text(item.albumSourceId),
      text(item.publicProductId),
      text(item.sourceUrl),
      text(item.sourceTitle),
      item.sourceCategoryId ? text(item.sourceCategoryId) : null,
      JSON.stringify(item.sourceCategoryPath || []),
      item.coverSourceUrl || null,
      nullableNumber(item.imageCountHint),
      text(item.listingFingerprint),
      needsDetail ? 1 : 0
    ]
  };
}

function absenceUpdate(event, context) {
  const status = event.type === 'REMOVED' ? 'deleted' : 'missing';
  return {
    sql: `UPDATE supplier_album_index
             SET status=?4, miss_count=?5, updated_at=CURRENT_TIMESTAMP
           WHERE tenant_id=?1 AND source_key=?2 AND album_source_id=?3
             AND status!='deleted'`,
    params: [
      context.tenantId,
      context.sourceKey,
      event.sourceId,
      status,
      Math.max(0, Number(event.missCount || 0))
    ]
  };
}

function syncEventInsert(event, context) {
  return {
    sql: `INSERT INTO supplier_sync_events
      (run_id, tenant_id, source_key, album_source_id, public_product_id,
       event_type, needs_detail, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, CURRENT_TIMESTAMP)`,
    params: [
      context.importId,
      context.tenantId,
      context.sourceKey,
      event.sourceId,
      eventProductId(event),
      event.type,
      event.needsDetail ? 1 : 0
    ]
  };
}

function resetDetailState(albumSourceId, context) {
  return {
    sql: `INSERT INTO supplier_album_detail_state
      (tenant_id, source_key, album_source_id, import_id, state, attempt_count, updated_at)
      VALUES (?1, ?2, ?3, ?4, 'pending', 0, CURRENT_TIMESTAMP)
      ON CONFLICT(tenant_id, source_key, album_source_id) DO UPDATE SET
        import_id=excluded.import_id,
        state='pending',
        claim_token=NULL,
        lease_until=NULL,
        attempt_count=0,
        outcome_code=NULL,
        last_error_code=NULL,
        detail_fingerprint=NULL,
        processed_at=NULL,
        updated_at=CURRENT_TIMESTAMP`,
    params: [context.tenantId, context.sourceKey, albumSourceId, context.importId]
  };
}

function syncRunStatement(context, scan, plan, { status, errorText = null }) {
  const counts = plan.counts;
  return {
    sql: `INSERT INTO supplier_sync_runs
      (run_id, tenant_id, source_key, mode, status, complete_scan, scanned_albums,
       new_count, changed_count, moved_count, restored_count, missing_count, removed_count,
       detail_fetch_count, started_at, finished_at, error_text)
      VALUES (?1, ?2, ?3, 'incremental', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
              CURRENT_TIMESTAMP, CASE WHEN ?4='failed' THEN CURRENT_TIMESTAMP ELSE NULL END, ?14)
      ON CONFLICT(run_id) DO UPDATE SET
        status=excluded.status,
        complete_scan=excluded.complete_scan,
        scanned_albums=excluded.scanned_albums,
        new_count=excluded.new_count,
        changed_count=excluded.changed_count,
        moved_count=excluded.moved_count,
        restored_count=excluded.restored_count,
        missing_count=excluded.missing_count,
        removed_count=excluded.removed_count,
        detail_fetch_count=excluded.detail_fetch_count,
        finished_at=excluded.finished_at,
        error_text=excluded.error_text`,
    params: [
      context.importId,
      context.tenantId,
      context.sourceKey,
      status,
      scan.complete ? 1 : 0,
      counts.scannedAlbums,
      counts.newCount,
      counts.changedCount,
      counts.movedCount,
      counts.restoredCount,
      counts.missingCount,
      counts.removedCount,
      counts.detailFetchCount,
      errorText
    ]
  };
}

export function buildBlockedIncrementalScanBatch({ context, scan, plan }) {
  if (plan.mutationsAllowed) throw new Error('tenant_sync_blocked_plan_required');
  const reason = plan.decision.reasons[0] || 'sync_safety_blocked';
  return [syncRunStatement(context, scan, plan, { status: 'failed', errorText: reason })];
}

export function buildIncrementalScanBatch({ context, scan, plan }) {
  if (context?.mode !== 'incremental') throw new Error('tenant_sync_incremental_context_required');
  if (!plan?.mutationsAllowed) return buildBlockedIncrementalScanBatch({ context, scan, plan });

  const detailIds = new Set(plan.detailQueue);
  const eventById = new Map(plan.events.map((event) => [event.sourceId, event]));
  const batch = [
    syncRunStatement(context, scan, plan, { status: 'running' }),
    {
      sql: 'DELETE FROM supplier_sync_events WHERE run_id=?1 AND tenant_id=?2 AND source_key=?3',
      params: [context.importId, context.tenantId, context.sourceKey]
    }
  ];

  for (let index = 0; index < (scan.taxonomy || []).length; index += 1) {
    batch.push(categoryInsert(scan.taxonomy[index], context, index));
  }

  for (const item of scan.items || []) {
    batch.push(observedIndexUpsert(item, context, detailIds.has(text(item.albumSourceId))));
  }

  for (const event of plan.events) {
    if (event.type === 'MISSING' || event.type === 'REMOVED') {
      batch.push(absenceUpdate(event, context));
    }
    batch.push(syncEventInsert(event, context));
  }

  for (const albumSourceId of plan.detailQueue) {
    batch.push(resetDetailState(albumSourceId, context));
  }

  batch.push({
    sql: `UPDATE supplier_sources
             SET last_scan_at=CURRENT_TIMESTAMP, last_error=NULL, updated_at=CURRENT_TIMESTAMP
           WHERE tenant_id=?1 AND source_key=?2`,
    params: [context.tenantId, context.sourceKey]
  });

  // A scan may legitimately have no product changes. The control-plane job can
  // advance straight to finalize without fabricating detail Queue work.
  batch.push({
    sql: `SELECT COUNT(*) AS affected_detail_count
            FROM supplier_sync_events
           WHERE run_id=?1 AND tenant_id=?2 AND source_key=?3 AND needs_detail=1`,
    params: [context.importId, context.tenantId, context.sourceKey]
  });

  // Keep the lookup available to future resume/fan-out wiring without rescanning the supplier.
  // This SELECT is intentionally part of the same D1 batch output, not public catalog state.
  batch.push({
    sql: `SELECT album_source_id
            FROM supplier_sync_events
           WHERE run_id=?1 AND tenant_id=?2 AND source_key=?3 AND needs_detail=1
           ORDER BY event_id ASC`,
    params: [context.importId, context.tenantId, context.sourceKey]
  });

  if (eventById.size !== plan.events.length) {
    throw new Error('tenant_sync_event_identity_conflict');
  }
  return batch;
}
