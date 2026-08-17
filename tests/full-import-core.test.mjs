import { describe, expect, it } from 'vitest';
import { publicCategoryId } from '../scripts/catalog-sync.mjs';
import {
  buildUsedPublicTaxonomy,
  categoryPathFor,
  chooseCategoryAssignment,
  classifyCatalogItem
} from '../scripts/full-import-core.mjs';

describe('full import core', () => {
  it('prefers the most specific category assignment for duplicate album discovery', () => {
    const parent = { id: '100', name: 'Brasil', depth: 0 };
    const child = { id: '101', name: 'Flamengo', depth: 1 };
    expect(chooseCategoryAssignment(parent, child)).toBe(child);
    expect(chooseCategoryAssignment(child, parent)).toBe(child);
  });

  it('classifies commercial products separately from navigation and information albums', () => {
    expect(classifyCatalogItem({ name: 'Flamengo 26/27 Home Player Version Jersey', sourceImageCount: 4 }).entityType).toBe('product');
    expect(classifyCatalogItem({ name: 'Premier League', sourceImageCount: 1 }).entityType).toBe('navigation');
    expect(classifyCatalogItem({ name: 'Purchase Tutorial', sourceImageCount: 1 }).entityType).toBe('information');
  });

  it('publishes only used branches and preserves the audited hierarchy', () => {
    const rawTaxonomy = [
      { id: '100', name: 'Brasil', parentId: null, childIds: ['101'], depth: 0 },
      { id: '101', name: 'Flamengo', parentId: '100', childIds: [], depth: 1 },
      { id: '200', name: 'Sem produtos', parentId: null, childIds: [], depth: 0 }
    ];
    const result = buildUsedPublicTaxonomy({ rawTaxonomy, usedSourceCategoryIds: ['101'] });
    const brasilId = publicCategoryId('yupoo', '100');
    const flamengoId = publicCategoryId('yupoo', '101');

    expect(result.taxonomy.map((category) => category.id)).toEqual([brasilId, flamengoId]);
    expect(result.taxonomy[0].childIds).toEqual([flamengoId]);
    expect(result.taxonomy[1].parentId).toBe(brasilId);
    expect(categoryPathFor('101', result.rawById)).toEqual([brasilId, flamengoId]);
  });
});
