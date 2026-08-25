import { describe, expect, it } from 'vitest';
import { normalizeIncrementalScanTaxonomy } from '../worker/ingestion/incremental-scan.js';

function baseScan(taxonomy) {
  return {
    complete: true,
    items: [
      {
        albumSourceId: '100',
        publicProductId: 'p_100',
        sourceUrl: 'https://supplier.example/albums/100',
        listingFingerprint: 'fp-100'
      }
    ],
    taxonomy,
    stats: { disqualifyingFailureCount: 0 }
  };
}

describe('incremental scan taxonomy normalization', () => {
  it('keeps one persistable category per normalized identity and drops blank identities', () => {
    const first = { id: 10, name: 'First', parentId: null, depth: 0 };
    const scan = baseScan([
      first,
      { id: '10', name: 'Duplicate', parentId: '1', depth: 1 },
      { categorySourceId: ' 20 ', name: 'Second', parentSourceId: null, depth: 0 },
      { id: '   ', name: 'Blank', parentId: null, depth: 0 },
      { name: 'Missing', parentId: null, depth: 0 }
    ]);

    const normalized = normalizeIncrementalScanTaxonomy(scan);

    expect(normalized.taxonomy).toEqual([
      { ...first, id: '10' },
      { categorySourceId: ' 20 ', name: 'Second', parentSourceId: null, depth: 0, id: '20' }
    ]);
    expect(normalized.items).toBe(scan.items);
    expect(normalized.complete).toBe(true);
    expect(normalized.stats).toBe(scan.stats);
  });

  it('does not mutate the provider scan object or taxonomy records', () => {
    const category = { categorySourceId: '30', name: 'Third', depth: 0 };
    const scan = baseScan([category]);
    const normalized = normalizeIncrementalScanTaxonomy(scan);

    expect(normalized).not.toBe(scan);
    expect(normalized.taxonomy[0]).not.toBe(category);
    expect(scan.taxonomy).toEqual([category]);
    expect(normalized.taxonomy[0].id).toBe('30');
  });
});
