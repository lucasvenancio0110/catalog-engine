import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  LISTING_DELTA_CONTRACT_VERSION,
  planListingDelta,
  planSafeListingDelta
} from '../src/sync/listing-delta.js';
import { planIncrementalDelta } from '../scripts/incremental-sync-core.mjs';

const scope = { id: 's_0123456789abcdefabcd', kind: 'catalog' };

function current(sourceId, overrides = {}) {
  return {
    sourceId,
    publicProductId: `p_${sourceId.padStart(20, '0').slice(-20)}`,
    categoryId: 'cat-a',
    categoryPathIds: ['root', 'cat-a'],
    listingFingerprint: `listing-${sourceId}`,
    ...overrides
  };
}

function previous(sourceId, overrides = {}) {
  const observation = current(sourceId);
  return {
    sourceId,
    publicProductId: observation.publicProductId,
    categoryId: observation.categoryId,
    categoryPathIds: observation.categoryPathIds,
    listingFingerprint: observation.listingFingerprint,
    detailFingerprint: `detail-${sourceId}`,
    status: 'active',
    missCount: 0,
    ...overrides
  };
}

describe('provider-neutral listing delta core', () => {
  it('owns the versioned NEW/CHANGED/MOVED ordering and affected-only detail queue', () => {
    const plan = planListingDelta(
      [previous('1'), previous('2'), previous('3')],
      [
        current('1', { listingFingerprint: 'listing-1-changed' }),
        current('2', { categoryId: 'cat-b', categoryPathIds: ['root', 'cat-b'] }),
        current('3'),
        current('4')
      ],
      { inferMissing: true }
    );

    expect(plan.contractVersion).toBe(LISTING_DELTA_CONTRACT_VERSION);
    expect(plan.events.map((event) => event.type)).toEqual(['NEW', 'CHANGED', 'MOVED']);
    expect(plan.detailQueue).toEqual(['4', '1']);
    expect(plan.summary).toEqual({ NEW: 1, CHANGED: 1, MOVED: 1 });
  });

  it('retries detail-pending observations without treating unchanged listings as changed', () => {
    const plan = planListingDelta(
      [previous('1', { detailFingerprint: null }), previous('2')],
      [current('1'), current('2')]
    );

    expect(plan.events).toHaveLength(1);
    expect(plan.events[0]).toMatchObject({
      type: 'CHANGED',
      sourceId: '1',
      needsDetail: true,
      reason: 'detail-pending'
    });
  });

  it('restores missing/deleted source identity and requires detail again', () => {
    const missing = planListingDelta(
      [previous('8', { status: 'missing', missCount: 1 })],
      [current('8')]
    );
    const deleted = planListingDelta(
      [previous('9', { status: 'deleted', missCount: 3 })],
      [current('9')]
    );

    expect(missing.events[0].type).toBe('RESTORED');
    expect(deleted.events[0].type).toBe('RESTORED');
    expect(missing.detailQueue).toEqual(['8']);
    expect(deleted.detailQueue).toEqual(['9']);
  });

  it('progresses repeated absence only when missing inference is explicitly authorized', () => {
    const blocked = planListingDelta(
      [previous('5', { status: 'missing', missCount: 2 })],
      [],
      { removalMissThreshold: 3, inferMissing: false }
    );
    const authorized = planListingDelta(
      [previous('5', { status: 'missing', missCount: 2 })],
      [],
      { removalMissThreshold: 3, inferMissing: true }
    );

    expect(blocked.events).toEqual([]);
    expect(authorized.events[0]).toMatchObject({ type: 'REMOVED', missCount: 3 });
  });

  it('composes partial scans with the M7 safety decision so absence never advances', () => {
    const plan = planSafeListingDelta(
      [previous('1'), previous('2')],
      [current('1', { listingFingerprint: 'listing-1-new' }), current('3')],
      {
        scope,
        knownGoodCount: 2,
        scanComplete: false,
        disqualifyingFailureCount: 0,
        removalMissThreshold: 3
      }
    );

    expect(plan.decision.outcome).toBe('preserve_last_known_good');
    expect(plan.decision.allowMissingInference).toBe(false);
    expect(plan.events.map((event) => event.type)).toEqual(['NEW', 'CHANGED']);
    expect(plan.events.some((event) => ['MISSING', 'REMOVED'].includes(event.type))).toBe(false);
  });

  it('quarantines a technically complete catastrophic collapse before absence semantics', () => {
    const plan = planSafeListingDelta(
      [previous('1'), previous('2')],
      [current('1')],
      {
        scope,
        knownGoodCount: 17018,
        scanComplete: true,
        disqualifyingFailureCount: 0,
        removalMissThreshold: 3
      }
    );

    expect(plan.decision.outcome).toBe('quarantine');
    expect(plan.decision.reasons).toEqual(['sync_catastrophic_volume_drop']);
    expect(plan.decision.allowMissingInference).toBe(false);
    expect(plan.events.some((event) => ['MISSING', 'REMOVED'].includes(event.type))).toBe(false);
  });

  it('allows healthy authoritative scans to use the existing repeated-miss semantics', () => {
    const observations = Array.from({ length: 100 }, (_, index) => current(String(index + 1)));
    const prior = [
      ...observations.map((entry) => previous(entry.sourceId)),
      previous('gone', { status: 'missing', missCount: 2 })
    ];
    const plan = planSafeListingDelta(prior, observations, {
      scope,
      knownGoodCount: 101,
      scanComplete: true,
      disqualifyingFailureCount: 0,
      removalMissThreshold: 3
    });

    expect(plan.decision.outcome).toBe('proceed');
    expect(plan.decision.allowMissingInference).toBe(true);
    expect(plan.events).toHaveLength(1);
    expect(plan.events[0]).toMatchObject({ type: 'REMOVED', sourceId: 'gone', missCount: 3 });
  });

  it('fails closed on duplicate source identity instead of silently overwriting evidence', () => {
    expect(() => planListingDelta([], [current('1'), current('1')])).toThrow(
      'sync_listing_duplicate_current_source_id'
    );
    expect(() => planListingDelta([previous('1'), previous('1')], [])).toThrow(
      'sync_listing_duplicate_previous_source_id'
    );
  });

  it('keeps the legacy default sync adapter on the same semantic planner', () => {
    const oldRows = [
      {
        album_source_id: '1',
        public_product_id: current('1').publicProductId,
        source_category_id: 'cat-a',
        source_category_path_json: JSON.stringify(['root', 'cat-a']),
        listing_fingerprint: 'listing-1',
        detail_fingerprint: 'detail-1',
        status: 'active',
        miss_count: 0
      }
    ];
    const observations = [
      {
        sourceId: '1',
        categoryId: 'cat-b',
        categoryPathIds: ['root', 'cat-b'],
        listingFingerprint: 'listing-1'
      }
    ];

    const legacy = planIncrementalDelta(oldRows, observations);
    const shared = planListingDelta(
      [previous('1')],
      [current('1', { categoryId: 'cat-b', categoryPathIds: ['root', 'cat-b'] })]
    );

    expect(legacy.events.map(({ type, sourceId, needsDetail }) => ({ type, sourceId, needsDetail }))).toEqual(
      shared.events.map(({ type, sourceId, needsDetail }) => ({ type, sourceId, needsDetail }))
    );
    expect(legacy.detailQueue).toEqual(shared.detailQueue);
  });

  it('keeps the shared Core browser/Worker-safe and free of provider/domain vocabulary', async () => {
    const source = await readFile('src/sync/listing-delta.js', 'utf8');

    expect(source).not.toMatch(/node:crypto|createHash|yupoo|shopify|football|soccer|jersey|albumSourceId/i);
    expect(source).toContain("from './sync-decision.js'");
  });
});
