import { describe, expect, it } from 'vitest';
import {
  knownGoodListingCount,
  planTenantIncrementalScan,
  providerScanItemsToListingObservations,
  tenantIncrementalEventCounts,
  tenantIndexRowsToListingPrevious
} from '../worker/ingestion/incremental-plan.js';

const scope = { id: 's_0123456789abcdefabcd', kind: 'source' };

function previous(overrides = {}) {
  return {
    album_source_id: '100',
    public_product_id: 'p_100',
    source_category_id: '10',
    source_category_path_json: '["1","10"]',
    listing_fingerprint: 'fp-old',
    detail_fingerprint: 'detail-old',
    status: 'active',
    miss_count: 0,
    ...overrides
  };
}

function current(overrides = {}) {
  return {
    albumSourceId: '100',
    publicProductId: 'p_100',
    sourceCategoryId: '10',
    sourceCategoryPath: ['1', '10'],
    listingFingerprint: 'fp-old',
    ...overrides
  };
}

describe('tenant incremental scan plan adapter', () => {
  it('maps tenant D1 rows and provider observations into the shared listing contract', () => {
    expect(tenantIndexRowsToListingPrevious([previous()])).toEqual([
      expect.objectContaining({
        sourceId: '100',
        publicProductId: 'p_100',
        categoryId: '10',
        categoryPathIds: ['1', '10'],
        listingFingerprint: 'fp-old',
        detailFingerprint: 'detail-old',
        status: 'active',
        missCount: 0
      })
    ]);
    expect(providerScanItemsToListingObservations([current()])).toEqual([
      expect.objectContaining({
        sourceId: '100',
        categoryId: '10',
        categoryPathIds: ['1', '10'],
        listingFingerprint: 'fp-old'
      })
    ]);
  });

  it('counts active and missing rows as last-known-good while excluding deleted rows', () => {
    const rows = tenantIndexRowsToListingPrevious([
      previous(),
      previous({ album_source_id: '101', status: 'missing' }),
      previous({ album_source_id: '102', status: 'deleted' })
    ]);
    expect(knownGoodListingCount(rows)).toBe(2);
  });

  it('selects detail only for affected products on an authoritative healthy scan', () => {
    const plan = planTenantIncrementalScan({
      previousRows: [
        previous(),
        previous({ album_source_id: '101', public_product_id: 'p_101', listing_fingerprint: 'fp-101' })
      ],
      scan: {
        complete: true,
        items: [
          current({ listingFingerprint: 'fp-new' }),
          current({ albumSourceId: '101', publicProductId: 'p_101', listingFingerprint: 'fp-101' }),
          current({ albumSourceId: '102', publicProductId: 'p_102', listingFingerprint: 'fp-102' })
        ]
      },
      scope
    });

    expect(plan.decision.outcome).toBe('proceed');
    expect(plan.mutationsAllowed).toBe(true);
    expect(plan.detailQueue).toEqual(['102', '100']);
    expect(plan.summary).toEqual({ NEW: 1, CHANGED: 1 });
    expect(plan.counts).toEqual({
      scannedAlbums: 3,
      newCount: 1,
      changedCount: 1,
      movedCount: 0,
      restoredCount: 0,
      missingCount: 0,
      removedCount: 0,
      detailFetchCount: 2
    });
  });

  it('tracks moved-with-change in both changed and moved aggregate counts', () => {
    const plan = planTenantIncrementalScan({
      previousRows: [previous()],
      scan: {
        complete: true,
        items: [
          current({
            sourceCategoryId: '20',
            sourceCategoryPath: ['2', '20'],
            listingFingerprint: 'fp-new'
          })
        ]
      },
      scope
    });
    expect(plan.summary.CHANGED_MOVED).toBe(1);
    expect(tenantIncrementalEventCounts(plan)).toMatchObject({
      changedCount: 1,
      movedCount: 1,
      detailFetchCount: 1
    });
  });

  it('preserves LKG and emits no fan-out for an incomplete scan', () => {
    const plan = planTenantIncrementalScan({
      previousRows: [previous(), previous({ album_source_id: '101', public_product_id: 'p_101' })],
      scan: { complete: false, items: [current({ listingFingerprint: 'fp-new' })] },
      scope
    });

    expect(plan.decision.outcome).toBe('preserve_last_known_good');
    expect(plan.decision.allowMissingInference).toBe(false);
    expect(plan.mutationsAllowed).toBe(false);
    expect(plan.detailQueue).toEqual([]);
    expect(plan.events.some((event) => ['MISSING', 'REMOVED'].includes(event.type))).toBe(false);
  });

  it('quarantines a catastrophic complete drop and suppresses all mutation fan-out', () => {
    const previousRows = Array.from({ length: 240 }, (_, index) =>
      previous({
        album_source_id: String(1000 + index),
        public_product_id: `p_${index}`,
        listing_fingerprint: `fp_${index}`
      })
    );
    const items = Array.from({ length: 40 }, (_, index) =>
      current({
        albumSourceId: String(1000 + index),
        publicProductId: `p_${index}`,
        listingFingerprint: `fp_${index}`
      })
    );
    const plan = planTenantIncrementalScan({
      previousRows,
      scan: { complete: true, items },
      scope
    });

    expect(plan.decision.outcome).toBe('quarantine');
    expect(plan.decision.reasons).toContain('sync_catastrophic_volume_drop');
    expect(plan.mutationsAllowed).toBe(false);
    expect(plan.detailQueue).toEqual([]);
  });

  it('progresses absence only after the configured repeated-miss threshold', () => {
    const first = planTenantIncrementalScan({
      previousRows: [previous({ miss_count: 1 })],
      scan: {
        complete: true,
        items: [current({ albumSourceId: '999', publicProductId: 'p_999', listingFingerprint: 'fp-999' })]
      },
      scope,
      removalMissThreshold: 3
    });
    expect(first.events.find((event) => event.sourceId === '100')?.type).toBe('MISSING');

    const second = planTenantIncrementalScan({
      previousRows: [previous({ miss_count: 2, status: 'missing' })],
      scan: {
        complete: true,
        items: [current({ albumSourceId: '999', publicProductId: 'p_999', listingFingerprint: 'fp-999' })]
      },
      scope,
      removalMissThreshold: 3
    });
    expect(second.events.find((event) => event.sourceId === '100')?.type).toBe('REMOVED');
  });

  it('fails closed on malformed persisted category paths', () => {
    expect(() =>
      tenantIndexRowsToListingPrevious([
        previous({ source_category_path_json: '{not-json' })
      ])
    ).toThrow('tenant_sync_category_path_invalid');
  });
});
