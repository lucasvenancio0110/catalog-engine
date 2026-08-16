import { describe, expect, it } from 'vitest';
import {
  contentFingerprint,
  publicCategoryId,
  publicProductId,
  reconcileSyncState
} from '../scripts/catalog-sync.mjs';

const t1 = '2026-08-16T10:00:00.000Z';
const t2 = '2026-08-16T11:00:00.000Z';

function observed(sourceId, overrides = {}) {
  const sourceProduct = {
    name: 'Real Madrid 26/27 Home Jersey',
    category: 'Football',
    description: 'Home jersey',
    sourceImages: ['https://photo.example/a.jpg', 'https://photo.example/b.jpg'],
    ...overrides
  };
  return {
    publicId: publicProductId('yupoo', sourceId),
    contentHash: contentFingerprint(sourceProduct)
  };
}

describe('public identities', () => {
  it('creates deterministic product IDs without exposing the raw source ID', () => {
    const id = publicProductId('yupoo', '248222525');
    expect(id).toMatch(/^p_[a-f0-9]{20}$/);
    expect(id).toBe(publicProductId('yupoo', '248222525'));
    expect(id).not.toContain('248222525');
  });

  it('uses a distinct namespace for category IDs', () => {
    const category = publicCategoryId('yupoo', '490727');
    expect(category).toMatch(/^c_[a-f0-9]{20}$/);
    expect(category).not.toContain('490727');
  });
});

describe('content fingerprint', () => {
  it('is stable for equivalent data and changes when commercial content changes', () => {
    const a = contentFingerprint({ name: '  Real   Madrid ', category: 'La Liga', description: '', sourceImages: ['a', 'b'] });
    const b = contentFingerprint({ name: 'Real Madrid', category: 'La Liga', description: '', sourceImages: ['a', 'b'] });
    const c = contentFingerprint({ name: 'Real Madrid Away', category: 'La Liga', description: '', sourceImages: ['a', 'b'] });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('reconcileSyncState', () => {
  it('marks unseen source products as NEW', () => {
    const item = observed('1');
    const next = reconcileSyncState(null, [item], { complete: false, now: t1 });
    expect(next.changes.new).toEqual([item.publicId]);
    expect(next.products[item.publicId].status).toBe('active');
  });

  it('marks changed observed products as UPDATED', () => {
    const first = observed('1');
    const initial = reconcileSyncState(null, [first], { complete: false, now: t1 });
    const changed = observed('1', { name: 'Real Madrid 26/27 Away Jersey' });
    const next = reconcileSyncState(initial, [changed], { complete: false, now: t2 });
    expect(next.changes.updated).toEqual([first.publicId]);
    expect(next.changes.new).toEqual([]);
  });

  it('never marks an unobserved active product removed during a partial scan', () => {
    const first = observed('1');
    const second = observed('2');
    const initial = reconcileSyncState(null, [first, second], { complete: false, now: t1 });
    const next = reconcileSyncState(initial, [first], { complete: false, now: t2 });
    expect(next.changes.removed).toEqual([]);
    expect(next.changes.unobserved).toEqual([second.publicId]);
    expect(next.products[second.publicId].status).toBe('active');
    expect(next.products[second.publicId].lastSeenAt).toBe(t1);
  });

  it('marks missing active products REMOVED only when the scope is complete', () => {
    const first = observed('1');
    const second = observed('2');
    const initial = reconcileSyncState(null, [first, second], { complete: false, now: t1 });
    const next = reconcileSyncState(initial, [first], { complete: true, now: t2 });
    expect(next.changes.removed).toEqual([second.publicId]);
    expect(next.products[second.publicId].status).toBe('removed');
    expect(next.products[second.publicId].removedAt).toBe(t2);
  });

  it('marks a previously removed product RESTORED when observed again', () => {
    const item = observed('1');
    const initial = reconcileSyncState(null, [item], { complete: false, now: t1 });
    const removed = reconcileSyncState(initial, [], { complete: true, now: t2 });
    const restored = reconcileSyncState(removed, [item], { complete: false, now: '2026-08-16T12:00:00.000Z' });
    expect(restored.changes.restored).toEqual([item.publicId]);
    expect(restored.products[item.publicId].status).toBe('active');
    expect(restored.products[item.publicId].removedAt).toBeNull();
  });
});
