import { describe, expect, it } from 'vitest';
import { planTenantIncrementalScan } from '../worker/ingestion/incremental-plan.js';
import {
  buildBlockedIncrementalScanBatch,
  buildIncrementalScanBatch
} from '../worker/ingestion/incremental-persistence.js';

const scope = { id: 's_0123456789abcdefabcd', kind: 'source' };
const context = {
  importId: 'imp_0123456789abcdefabcd',
  tenantId: 't_0123456789abcdefabcd',
  sourceKey: 'primary',
  mode: 'incremental'
};

function previous(id, overrides = {}) {
  return {
    album_source_id: id,
    public_product_id: `p_${id}`,
    source_url: `https://supplier.x.yupoo.com/albums/${id}`,
    source_title: `Product ${id}`,
    source_category_id: '10',
    source_category_path_json: '["1","10"]',
    cover_source_url: null,
    image_count_hint: null,
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

function healthyPlan(previousRows, scan, removalMissThreshold = 3) {
  return planTenantIncrementalScan({
    previousRows,
    scan,
    scope,
    removalMissThreshold
  });
}

describe('tenant incremental scan persistence', () => {
  it('never emits full-index or public-product deletes during a healthy incremental scan', () => {
    const scan = {
      complete: true,
      taxonomy: [{ id: '10', name: 'Team A', parentId: null, depth: 0 }],
      items: [item('100', { listingFingerprint: 'fp-100-new' }), item('101')]
    };
    const plan = healthyPlan([previous('100'), previous('101')], scan);
    const batch = buildIncrementalScanBatch({ context, scan, plan });
    const sql = batch.map((entry) => entry.sql).join('\n');

    expect(plan.detailQueue).toEqual(['100']);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+supplier_album_index/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+catalog_products/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+product_media/i);
    expect(sql).toMatch(/INSERT INTO supplier_sync_runs/);
    expect(sql).toMatch(/INSERT INTO supplier_sync_events/);
  });

  it('resets detail state only for albums selected by the shared affected-only planner', () => {
    const scan = {
      complete: true,
      taxonomy: [],
      items: [
        item('100', { listingFingerprint: 'fp-100-new' }),
        item('101'),
        item('102', { sourceCategoryId: '20', sourceCategoryPath: ['2', '20'] })
      ]
    };
    const plan = healthyPlan([previous('100'), previous('101'), previous('102')], scan);
    expect(plan.detailQueue).toEqual(['100']);
    expect(plan.summary.MOVED).toBe(1);

    const batch = buildIncrementalScanBatch({ context, scan, plan });
    const resets = batch.filter((entry) =>
      entry.sql.includes('INSERT INTO supplier_album_detail_state')
    );
    expect(resets).toHaveLength(1);
    expect(resets[0].params).toEqual([
      context.tenantId,
      context.sourceKey,
      '100',
      context.importId
    ]);
    expect(resets[0].sql).toContain('import_id=excluded.import_id');
    expect(resets[0].sql).toContain("state='pending'");
  });

  it('records repeated absence in the private index without deleting public catalog state in scan phase', () => {
    const scan = {
      complete: true,
      taxonomy: [],
      items: [item('999')]
    };
    const plan = healthyPlan([
      previous('100', { status: 'missing', miss_count: 2 })
    ], scan, 3);
    expect(plan.events.find((event) => event.sourceId === '100')?.type).toBe('REMOVED');

    const batch = buildIncrementalScanBatch({ context, scan, plan });
    const removal = batch.find(
      (entry) => entry.sql.startsWith('UPDATE supplier_album_index') && entry.params?.[2] === '100'
    );
    expect(removal.params[3]).toBe('deleted');
    expect(removal.params[4]).toBe(3);
    expect(batch.map((entry) => entry.sql).join('\n')).not.toMatch(/DELETE\s+FROM\s+catalog_products/i);
  });

  it('persists only a failed private sync-run diagnostic when safety blocks the scan', () => {
    const previousRows = Array.from({ length: 220 }, (_, index) => previous(String(1000 + index)));
    const scan = {
      complete: true,
      taxonomy: [],
      items: Array.from({ length: 20 }, (_, index) => item(String(1000 + index)))
    };
    const plan = healthyPlan(previousRows, scan);
    expect(plan.mutationsAllowed).toBe(false);
    expect(plan.decision.outcome).toBe('quarantine');

    const batch = buildBlockedIncrementalScanBatch({ context, scan, plan });
    expect(batch).toHaveLength(1);
    expect(batch[0].sql).toContain('INSERT INTO supplier_sync_runs');
    expect(batch[0].params[3]).toBe('failed');
    expect(batch[0].params.at(-1)).toBe('sync_catastrophic_volume_drop');
    expect(batch[0].sql).not.toMatch(/supplier_album_index|catalog_products|supplier_album_detail_state/);
  });

  it('fails closed if the persistence layer is called with an initial-import context', () => {
    const scan = { complete: true, taxonomy: [], items: [item('100')] };
    const plan = healthyPlan([], scan);
    expect(() =>
      buildIncrementalScanBatch({
        context: { ...context, mode: 'initial' },
        scan,
        plan
      })
    ).toThrow('tenant_sync_incremental_context_required');
  });
});
