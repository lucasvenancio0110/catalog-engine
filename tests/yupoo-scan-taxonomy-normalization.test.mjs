import { describe, expect, it } from 'vitest';
import { normalizeYupooScanTaxonomy } from '../worker/ingestion/providers/yupoo.js';

describe('Yupoo scan taxonomy normalization', () => {
  it('deduplicates repeated category identities without changing item observations', () => {
    const items = [{ albumSourceId: '100' }];
    const scan = {
      complete: true,
      items,
      taxonomy: [
        { id: '10', name: 'Team', parentId: '1', depth: 1 },
        { id: '10', name: 'Team duplicate', parentId: '1', depth: 1 },
        { id: '20', name: 'League', parentId: null, depth: 0 }
      ]
    };

    const normalized = normalizeYupooScanTaxonomy(scan);

    expect(normalized.items).toBe(items);
    expect(normalized.taxonomy).toEqual([
      { id: '10', name: 'Team', parentId: '1', depth: 1 },
      { id: '20', name: 'League', parentId: null, depth: 0 }
    ]);
  });

  it('preserves the original scan object when taxonomy identities are already unique', () => {
    const scan = {
      complete: true,
      items: [],
      taxonomy: [
        { id: '10', name: 'Team' },
        { id: '20', name: 'League' }
      ]
    };

    expect(normalizeYupooScanTaxonomy(scan)).toBe(scan);
  });
});
