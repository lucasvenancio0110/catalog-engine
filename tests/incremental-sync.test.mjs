import { describe, expect, it } from 'vitest';
import { listingFingerprint, planIncrementalDelta } from '../scripts/incremental-sync-core.mjs';

function entry(sourceId, overrides = {}) {
  const value = {
    sourceId,
    sourceUrl: `https://supplier.example/albums/${sourceId}`,
    title: `Produto ${sourceId}`,
    categoryId: '10',
    categoryPathIds: ['1', '10'],
    coverUrl: `https://img.example/${sourceId}.jpg`,
    listingSignal: `Produto ${sourceId}`,
    imageCountHint: 4,
    ...overrides
  };
  return { ...value, listingFingerprint: listingFingerprint(value) };
}

function previous(current, overrides = {}) {
  return {
    album_source_id: current.sourceId,
    public_product_id: `p_${current.sourceId.padStart(20, '0').slice(-20)}`,
    source_title: current.title,
    source_category_id: current.categoryId,
    source_category_path_json: JSON.stringify(current.categoryPathIds),
    cover_source_url: current.coverUrl,
    image_count_hint: current.imageCountHint,
    listing_fingerprint: current.listingFingerprint,
    status: 'active',
    miss_count: 0,
    ...overrides
  };
}

describe('incremental supplier delta', () => {
  it('queues only a genuinely new album for detail', () => {
    const current = entry('101');
    const plan = planIncrementalDelta([], [current]);
    expect(plan.summary.NEW).toBe(1);
    expect(plan.detailQueue).toEqual(['101']);
  });

  it('does not re-read an unchanged album', () => {
    const current = entry('102');
    const plan = planIncrementalDelta([previous(current)], [current]);
    expect(plan.events).toEqual([]);
    expect(plan.detailQueue).toEqual([]);
  });

  it('detects title/cover/listing changes and requests detail', () => {
    const before = entry('103');
    const after = entry('103', { title: 'Produto 103 Player Version' });
    const plan = planIncrementalDelta([previous(before)], [after]);
    expect(plan.events[0].type).toBe('CHANGED');
    expect(plan.events[0].needsDetail).toBe(true);
  });

  it('detects a pure category move without opening the album detail', () => {
    const before = entry('104');
    const afterBase = { ...before, categoryId: '20', categoryPathIds: ['2', '20'] };
    const after = { ...afterBase, listingFingerprint: before.listingFingerprint };
    const plan = planIncrementalDelta([previous(before)], [after]);
    expect(plan.events[0].type).toBe('MOVED');
    expect(plan.detailQueue).toEqual([]);
  });

  it('requires repeated complete misses before confirmed removal', () => {
    const current = entry('105');
    const firstMiss = planIncrementalDelta([previous(current)], [], { removalMissThreshold: 3 });
    expect(firstMiss.events[0].type).toBe('MISSING');
    expect(firstMiss.events[0].missCount).toBe(1);

    const thirdMiss = planIncrementalDelta([
      previous(current, { status: 'missing', miss_count: 2 })
    ], [], { removalMissThreshold: 3 });
    expect(thirdMiss.events[0].type).toBe('REMOVED');
    expect(thirdMiss.events[0].missCount).toBe(3);
  });

  it('restores a previously missing album and re-reads its detail', () => {
    const current = entry('106');
    const plan = planIncrementalDelta([
      previous(current, { status: 'missing', miss_count: 1 })
    ], [current]);
    expect(plan.events[0].type).toBe('RESTORED');
    expect(plan.detailQueue).toEqual(['106']);
  });
});
