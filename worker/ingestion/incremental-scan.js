import { assertCatalogProviderScanObservation } from '../../src/catalog-provider/provider-contract.js';
import { queryD1Batch } from '../cloudflare-platform.js';
import { stableOpaqueId } from '../runtime-identity.js';
import { planTenantIncrementalScan } from './incremental-plan.js';

export const TENANT_INCREMENTAL_PREVIOUS_PAGE_SIZE = 500;
const MAX_INCREMENTAL_PREVIOUS_ROWS = 1_000_000;

function disqualifyingFailureCount(scan) {
  const value = Number(
    scan.disqualifyingFailureCount ?? scan.stats?.disqualifyingFailureCount ?? 0
  );
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function categoryIdentity(category) {
  return String(category?.id ?? category?.categorySourceId ?? '').trim();
}

export function normalizeIncrementalScanTaxonomy(scan) {
  if (!scan || !Array.isArray(scan.taxonomy)) return scan;
  const byId = new Map();
  for (const category of scan.taxonomy) {
    const id = categoryIdentity(category);
    if (!id || byId.has(id)) continue;
    byId.set(id, { ...category, id });
  }
  return {
    ...scan,
    taxonomy: [...byId.values()]
  };
}

async function sourceScope(context) {
  return {
    id: await stableOpaqueId(
      's',
      `${context.tenantId}:${context.sourceKey}:incremental-listing:v1`
    ),
    kind: 'source'
  };
}

export async function loadTenantIncrementalPreviousRows(
  context,
  platform,
  { fetchImpl = fetch, queryBatch = queryD1Batch, pageSize = TENANT_INCREMENTAL_PREVIOUS_PAGE_SIZE } = {}
) {
  const boundedPageSize = Math.min(
    Math.max(Number.parseInt(pageSize, 10) || TENANT_INCREMENTAL_PREVIOUS_PAGE_SIZE, 1),
    1000
  );
  const rows = [];
  let afterSourceId = '';

  while (true) {
    const result = await queryBatch(
      {
        ...platform,
        databaseId: context.dataPlane.databaseId,
        batch: [
          {
            sql: `SELECT album_source_id, public_product_id, source_category_id,
                         source_category_path_json, listing_fingerprint, detail_fingerprint,
                         status, miss_count
                    FROM supplier_album_index
                   WHERE tenant_id=?1 AND source_key=?2 AND album_source_id>?3
                   ORDER BY album_source_id ASC
                   LIMIT ?4`,
            params: [context.tenantId, context.sourceKey, afterSourceId, boundedPageSize]
          }
        ]
      },
      { fetchImpl }
    );
    const page = result[0]?.results || [];
    rows.push(...page);
    if (rows.length > MAX_INCREMENTAL_PREVIOUS_ROWS) {
      throw new Error('tenant_sync_previous_snapshot_too_large');
    }
    if (page.length < boundedPageSize) break;
    const nextAfter = String(page.at(-1)?.album_source_id || '').trim();
    if (!nextAfter || nextAfter <= afterSourceId) {
      throw new Error('tenant_sync_previous_snapshot_cursor_invalid');
    }
    afterSourceId = nextAfter;
  }

  return rows;
}

export async function planTenantIncrementalScanFromProvider(
  { context, provider, platform },
  { fetchImpl = fetch, queryBatch = queryD1Batch, pageSize = TENANT_INCREMENTAL_PREVIOUS_PAGE_SIZE } = {}
) {
  if (context?.mode !== 'incremental') {
    throw new Error('tenant_sync_incremental_context_required');
  }
  if (!provider || typeof provider.scanListingIndex !== 'function') {
    throw new Error('tenant_sync_provider_scan_unavailable');
  }

  const previousRows = await loadTenantIncrementalPreviousRows(context, platform, {
    fetchImpl,
    queryBatch,
    pageSize
  });
  const scan = normalizeIncrementalScanTaxonomy(
    assertCatalogProviderScanObservation(
      await provider.scanListingIndex(context.privateSource.url, { fetchImpl })
    )
  );
  const plan = planTenantIncrementalScan({
    previousRows,
    scan,
    scope: await sourceScope(context),
    removalMissThreshold: context.privateSource.removalMissThreshold,
    disqualifyingFailureCount: disqualifyingFailureCount(scan)
  });

  return Object.freeze({
    outcome: plan.mutationsAllowed ? 'planned' : plan.decision.outcome,
    reason: plan.mutationsAllowed ? null : plan.decision.reasons[0] || 'sync_safety_blocked',
    detailIds: Object.freeze(plan.mutationsAllowed ? [...plan.detailQueue] : []),
    counts: plan.counts,
    decision: plan.decision,
    scan,
    plan
  });
}
