import { describe, expect, it, vi } from 'vitest';
import {
  loadTenantIncrementalPreviousRows,
  planTenantIncrementalScanFromProvider
} from '../worker/ingestion/incremental-scan.js';

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

function expectReadOnlyCalls(queryBatch) {
  expect(queryBatch).toHaveBeenCalled();
  for (const [request] of queryBatch.mock.calls) {
    expect(request.databaseId).toBe(context.dataPlane.databaseId);
    for (const entry of request.batch) {
      expect(entry.sql.trim()).toMatch(/^SELECT\b/i);
    }
  }
}

describe('isolated tenant incremental scan planning runner', () => {
  it('reads the prior tenant snapshot and returns only affected detail ids without persisting anything', async () => {
    const queryBatch = vi.fn().mockResolvedValueOnce([
      { results: [previous('100'), previous('101')] }
    ]);
    const provider = {
      scanListingIndex: vi.fn(async () => ({
        complete: true,
        taxonomy: [],
        items: [item('100', { listingFingerprint: 'fp-new' }), item('101')],
        stats: {}
      }))
    };

    const result = await planTenantIncrementalScanFromProvider(
      { context, provider, platform },
      { queryBatch, fetchImpl: vi.fn() }
    );

    expect(result.outcome).toBe('planned');
    expect(result.detailIds).toEqual(['100']);
    expect(result.counts.changedCount).toBe(1);
    expect(queryBatch).toHaveBeenCalledTimes(1);
    expectReadOnlyCalls(queryBatch);
  });

  it('returns quarantine with no detail ids and still performs no tenant mutation', async () => {
    const prior = Array.from({ length: 220 }, (_, index) => previous(String(1000 + index)));
    const observed = Array.from({ length: 20 }, (_, index) => item(String(1000 + index)));
    const queryBatch = vi.fn().mockResolvedValueOnce([{ results: prior }]);
    const provider = {
      scanListingIndex: vi.fn(async () => ({
        complete: true,
        taxonomy: [],
        items: observed,
        stats: {}
      }))
    };

    const result = await planTenantIncrementalScanFromProvider(
      { context, provider, platform },
      { queryBatch, fetchImpl: vi.fn() }
    );

    expect(result.outcome).toBe('quarantine');
    expect(result.reason).toBe('sync_catastrophic_volume_drop');
    expect(result.detailIds).toEqual([]);
    expectReadOnlyCalls(queryBatch);
  });

  it('does not persist any tenant mutation when the provider scan itself fails', async () => {
    const queryBatch = vi.fn().mockResolvedValueOnce([{ results: [previous('100')] }]);
    const provider = {
      scanListingIndex: vi.fn(async () => {
        throw new Error('supplier_transient_500');
      })
    };

    await expect(
      planTenantIncrementalScanFromProvider(
        { context, provider, platform },
        { queryBatch, fetchImpl: vi.fn() }
      )
    ).rejects.toThrow('supplier_transient_500');
    expect(queryBatch).toHaveBeenCalledTimes(1);
    expectReadOnlyCalls(queryBatch);
  });

  it('accepts a validated incomplete provider observation only to preserve LKG with no fan-out', async () => {
    const queryBatch = vi.fn().mockResolvedValueOnce([
      { results: [previous('100'), previous('101')] }
    ]);
    const provider = {
      scanListingIndex: vi.fn(async () => ({
        complete: false,
        taxonomy: [],
        items: [item('100', { listingFingerprint: 'fp-new' })],
        stats: {}
      }))
    };

    const result = await planTenantIncrementalScanFromProvider(
      { context, provider, platform },
      { queryBatch, fetchImpl: vi.fn() }
    );
    expect(result.outcome).toBe('preserve_last_known_good');
    expect(result.detailIds).toEqual([]);
    expect(result.plan.events.some((event) => ['MISSING', 'REMOVED'].includes(event.type))).toBe(false);
    expectReadOnlyCalls(queryBatch);
  });

  it('pages the previous LKG snapshot by source-id cursor instead of requesting the full catalog in one response', async () => {
    const queryBatch = vi
      .fn()
      .mockResolvedValueOnce([{ results: [previous('100'), previous('101')] }])
      .mockResolvedValueOnce([{ results: [previous('102')] }]);

    const rows = await loadTenantIncrementalPreviousRows(context, platform, {
      queryBatch,
      fetchImpl: vi.fn(),
      pageSize: 2
    });

    expect(rows.map((row) => row.album_source_id)).toEqual(['100', '101', '102']);
    expect(queryBatch).toHaveBeenCalledTimes(2);
    expect(queryBatch.mock.calls[0][0].batch[0].params).toEqual([
      context.tenantId,
      context.sourceKey,
      '',
      2
    ]);
    expect(queryBatch.mock.calls[1][0].batch[0].params).toEqual([
      context.tenantId,
      context.sourceKey,
      '101',
      2
    ]);
    expectReadOnlyCalls(queryBatch);
  });

  it('fails closed when called with the initial-import context before reading tenant D1', async () => {
    const queryBatch = vi.fn();
    await expect(
      planTenantIncrementalScanFromProvider(
        {
          context: { ...context, mode: 'initial' },
          provider: { scanListingIndex: vi.fn() },
          platform
        },
        { queryBatch }
      )
    ).rejects.toThrow('tenant_sync_incremental_context_required');
    expect(queryBatch).not.toHaveBeenCalled();
  });
});
