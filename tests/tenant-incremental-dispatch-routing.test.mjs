import { describe, expect, it, vi } from 'vitest';
import { handleTenantIncrementalScan } from '../worker/ingestion/incremental-scan-consumer.js';

const context = {
  importId: 'imp_0123456789abcdefabcd',
  tenantId: 't_0123456789abcdefabcd',
  sourceKey: 'primary',
  mode: 'incremental',
  importStatus: 'queued',
  phase: 'scan',
  schemaVersion: 7,
  discoveredCount: 0,
  detailEnqueueCursor: 0,
  privateSource: {
    provider: 'yupoo',
    url: 'https://supplier.x.yupoo.com/categories/10',
    syncStrategy: 'incremental',
    removalMissThreshold: 3
  },
  dataPlane: {
    databaseId: '11111111-2222-3333-4444-555555555555',
    dispatchNamespace: 'catalog-engine-production'
  }
};

function controlDb() {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        run: vi.fn(async () => ({ meta: { changes: 1 } }))
      }))
    }))
  };
}

function batchTenantIds(request) {
  const ids = new Set();
  for (const query of request.batch || []) {
    for (const value of query.params || []) {
      const candidate = String(value || '');
      if (/^t_[a-f0-9]{20}$/.test(candidate)) ids.add(candidate);
    }
  }
  return ids;
}

function tenantDispatchLikeQuery() {
  const calls = [];
  const queryBatch = vi.fn(async (request) => {
    calls.push(request);
    const ids = batchTenantIds(request);
    const explicit = String(request.tenantId || '');
    const resolved = explicit || (ids.size === 1 ? [...ids][0] : '');
    if (resolved !== context.tenantId) throw new Error('tenant_data_plane_tenant_unresolved');
    if (ids.size > 0 && (ids.size !== 1 || !ids.has(resolved))) {
      throw new Error('tenant_data_plane_tenant_mismatch');
    }

    const sql = String(request.batch?.[0]?.sql || '');
    if (/FROM supplier_album_index/i.test(sql)) {
      return [
        {
          results: [
            {
              album_source_id: '100',
              public_product_id: 'p_100',
              source_category_id: '10',
              source_category_path_json: '["10"]',
              listing_fingerprint: 'old-listing',
              detail_fingerprint: 'detail-100',
              status: 'active',
              miss_count: 0
            }
          ]
        }
      ];
    }
    if (/SELECT e\.album_source_id/i.test(sql)) {
      return [{ results: [{ album_source_id: '100' }] }];
    }
    if (/SELECT state, safety_outcome, observed_count/i.test(sql)) {
      return [
        {
          results: [
            {
              state: 'details_pending',
              safety_outcome: 'proceed',
              observed_count: 1,
              staged_observation_count: 1,
              expected_event_count: 1,
              staged_event_count: 1,
              expected_detail_count: 1,
              staged_category_count: 1,
              last_error_code: null
            }
          ]
        }
      ];
    }
    return (request.batch || []).map(() => ({ results: [], meta: { changes: 1 } }));
  });
  return { queryBatch, calls };
}

describe('M7D4 TENANT_DISPATCH routing', () => {
  it('keeps exact server-resolved tenant identity on the opaque affected-detail read', async () => {
    const { queryBatch, calls } = tenantDispatchLikeQuery();
    const provider = {
      scanListingIndex: vi.fn(async () => ({
        complete: true,
        taxonomy: [{ id: '10', name: 'Club Shirts', parentId: null, depth: 0 }],
        items: [
          {
            albumSourceId: '100',
            publicProductId: 'p_100',
            sourceUrl: 'https://supplier.x.yupoo.com/albums/100',
            sourceTitle: 'Product 100',
            sourceCategoryId: '10',
            sourceCategoryPath: ['10'],
            coverSourceUrl: null,
            imageCountHint: 1,
            listingFingerprint: 'new-listing'
          }
        ],
        stats: {}
      }))
    };
    const detailQueue = { sendBatch: vi.fn(async () => undefined) };

    const result = await handleTenantIncrementalScan(
      {
        db: controlDb(),
        context,
        provider,
        platform: { tenantDispatch: { get: vi.fn() } },
        detailQueue
      },
      { queryBatch, fetchImpl: vi.fn() }
    );

    expect(result).toMatchObject({ outcome: 'success', detailCount: 1, queued: 1 });
    expect(detailQueue.sendBatch).toHaveBeenCalledTimes(1);
    const opaqueRead = calls.find((request) =>
      String(request.batch?.[0]?.sql || '').includes('SELECT e.album_source_id')
    );
    expect(opaqueRead).toBeTruthy();
    expect(opaqueRead.tenantId).toBe(context.tenantId);
    expect(opaqueRead.batch[0].params).toContain(context.tenantId);
    expect(opaqueRead.batch[0].params).toContain(context.sourceKey);
  });
});
