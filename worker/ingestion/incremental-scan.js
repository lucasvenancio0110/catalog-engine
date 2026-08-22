import { assertCatalogProviderScanObservation } from '../../src/catalog-provider/provider-contract.js';
import { queryD1Batch } from '../cloudflare-platform.js';
import { stableOpaqueId } from '../runtime-identity.js';
import { planTenantIncrementalScan } from './incremental-plan.js';
import { buildIncrementalScanBatch } from './incremental-persistence.js';

function disqualifyingFailureCount(scan) {
  const value = Number(
    scan.disqualifyingFailureCount ?? scan.stats?.disqualifyingFailureCount ?? 0
  );
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
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

async function loadPreviousRows(context, platform, fetchImpl, queryBatch) {
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
                 WHERE tenant_id=?1 AND source_key=?2
                 ORDER BY album_source_id ASC`,
          params: [context.tenantId, context.sourceKey]
        }
      ]
    },
    { fetchImpl }
  );
  return result[0]?.results || [];
}

export async function runTenantIncrementalScan(
  { context, provider, platform },
  { fetchImpl = fetch, queryBatch = queryD1Batch } = {}
) {
  if (context?.mode !== 'incremental') {
    throw new Error('tenant_sync_incremental_context_required');
  }
  if (!provider || typeof provider.scanListingIndex !== 'function') {
    throw new Error('tenant_sync_provider_scan_unavailable');
  }

  const previousRows = await loadPreviousRows(context, platform, fetchImpl, queryBatch);
  const scan = assertCatalogProviderScanObservation(
    await provider.scanListingIndex(context.privateSource.url, { fetchImpl })
  );
  const plan = planTenantIncrementalScan({
    previousRows,
    scan,
    scope: await sourceScope(context),
    removalMissThreshold: context.privateSource.removalMissThreshold,
    disqualifyingFailureCount: disqualifyingFailureCount(scan)
  });
  const batch = buildIncrementalScanBatch({ context, scan, plan });
  await queryBatch(
    {
      ...platform,
      databaseId: context.dataPlane.databaseId,
      batch
    },
    { fetchImpl }
  );

  if (!plan.mutationsAllowed) {
    return {
      outcome: plan.decision.outcome,
      reason: plan.decision.reasons[0] || 'sync_safety_blocked',
      detailIds: [],
      counts: plan.counts,
      decision: plan.decision
    };
  }

  return {
    outcome: 'planned',
    reason: null,
    detailIds: [...plan.detailQueue],
    counts: plan.counts,
    decision: plan.decision
  };
}
