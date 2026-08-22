import { describe, expect, it, vi } from 'vitest';
import { runTenantIncrementalScan } from '../worker/ingestion/incremental-scan.js';

const context = {
  importId: 'imp_0123456789abcdefabcd',
  tenantId: 't_0123456789abcdefabcd',
  sourceKey: 'primary',
  mode: 'incremental',
  privateSource: {
    url: 'https://supplier.x.yupoo.com/albums/',
    removalMissThreshold: 3
  },
  dataPlane: {
    databaseId: '12ac414c-4aef-4668-a8f9-dc63d57d449f'
  }
};
const platform = { dispatchNamespace: 'catalog-engine-production' };

function previous(id, overrides = {}) {
  return {
    album_source_id: id,
    public_product_id: `p_${id}`,
    source_category_id: '10',
    source_category_path_json: '["1","10"]',
    listing_fingerprint: `fp-${id}`,
    detail_fingerprint: `detail-${id}`,
    status: 'active',
    miss_count: 0,
    ...overrides
  };
}

function item(id, overrides = {}) {
  return {
    albumSourceId: id,
    publicProductId: `p_${id}`,
    sourceUrl: `https://supplier.x.yupoo.com/albums/${id}`,
    sourceTitle: `Product ${id}`,
    sourceCategoryId: '10',
    sourceCategoryPath: ['1', '10'],
    coverSourceUrl: null,
    imageCountHint: null,
    listingFingerprint: `fp-${id}`,
    ...overrides
  };
}

describe('isolated tenant incremental scan runner', () => {
  it('reads the prior tenant snapshot, persists the safe plan and returns only affected detail ids', async () => {
    const queryBatch = vi
      .fn()
      .mockResolvedValueOnce([{ results: [previous('100'), previous('101')] }])
      .mockResolvedValueOnce([]);
    const provider = {
      scanListingIndex: vi.fn(async () => ({
        complete: true,
        taxonomy: [],
        items: [item('100', { listingFingerprint: 'fp-new' }), item('101')],
        stats: {}
      }))
    };

    const result = await runTenantIncrementalScan(
      { context, provider, platform },
      { queryBatch, fetchImpl: vi.fn() }
    );

    expect(result.outcome).toBe('planned');
    expect(result.detailIds).toEqual(['100']);
    expect(result.counts.changedCount).toBe(1);
    expect(queryBatch).toHaveBeenCalledTimes(2);
    const writeCall = queryBatch.mock.calls[1][0];
    expect(writeCall.databaseId).toBe(context.dataPlane.databaseId);
    expect(writeCall.batch.map((entry) => entry.sql).join('\n')).not.toMatch(
      /DELETE\s+FROM\s+supplier_album_index|DELETE\s+FROM\s+catalog_products/i
    );
  });

  it('persists only the blocked-run diagnostic and returns no detail ids after catastrophic quarantine', async () => {
    const prior = Array.from({ length: 220 }, (_, index) => previous(String(1000 + index)));
    const observed = Array.from({ length: 20 }, (_, index) => item(String(1000 + index)));
    const queryBatch = vi
      .fn()
      .mockResolvedValueOnce([{ results: prior }])
      .mockResolvedValueOnce([]);
    const provider = {
      scanListingIndex: vi.fn(async () => ({
        complete: true,
        taxonomy: [],
        items: observed,
        stats: {}
      }))
    };

    const result = await runTenantIncrementalScan(
      { context, provider, platform },
      { queryBatch, fetchImpl: vi.fn() }
    );

    expect(result.outcome).toBe('quarantine');
    expect(result.reason).toBe('sync_catastrophic_volume_drop');
    expect(result.detailIds).toEqual([]);
    const batch = queryBatch.mock.calls[1][0].batch;
    expect(batch).toHaveLength(1);
    expect(batch[0].sql).toContain('supplier_sync_runs');
    expect(batch[0].sql).not.toMatch(/supplier_album_index|catalog_products|supplier_album_detail_state/);
  });

  it('does not persist any tenant mutation when the provider scan itself fails', async () => {
    const queryBatch = vi.fn().mockResolvedValueOnce([{ results: [previous('100')] }]);
    const provider = {
      scanListingIndex: vi.fn(async () => {
        throw new Error('supplier_transient_500');
      })
    };

    await expect(
      runTenantIncrementalScan(
        { context, provider, platform },
        { queryBatch, fetchImpl: vi.fn() }
      )
    ).rejects.toThrow('supplier_transient_500');
    expect(queryBatch).toHaveBeenCalledTimes(1);
  });

  it('accepts an explicit incomplete provider observation only to preserve LKG with no fan-out', async () => {
    const queryBatch = vi
      .fn()
      .mockResolvedValueOnce([{ results: [previous('100'), previous('101')] }])
      .mockResolvedValueOnce([]);
    const provider = {
      scanListingIndex: vi.fn(async () => ({
        complete: false,
        taxonomy: [],
        items: [item('100', { listingFingerprint: 'fp-new' })],
        stats: {}
      }))
    };

    const result = await runTenantIncrementalScan(
      { context, provider, platform },
      { queryBatch, fetchImpl: vi.fn() }
    );
    expect(result.outcome).toBe('preserve_last_known_good');
    expect(result.detailIds).toEqual([]);
    expect(queryBatch.mock.calls[1][0].batch).toHaveLength(1);
  });

  it('fails closed when called with the initial-import context', async () => {
    await expect(
      runTenantIncrementalScan({
        context: { ...context, mode: 'initial' },
        provider: { scanListingIndex: vi.fn() },
        platform
      })
    ).rejects.toThrow('tenant_sync_incremental_context_required');
  });
});
