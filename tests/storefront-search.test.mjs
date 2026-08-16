import { describe, expect, it } from 'vitest';
import { createProductSearch } from '../src/catalog/search.js';

const products = [
  { id: '1', name: 'Real Madrid 26/27 Home Jersey', category: 'Real Madrid', description: 'Camisa branca' },
  { id: '2', name: 'Barcelona Away Jersey', category: 'Barcelona', description: 'Camisa visitante' },
  { id: '3', name: 'Flamengo Home Jersey', category: 'Flamengo', description: 'Camisa rubro-negra' }
];

describe('storefront fuzzy search', () => {
  it('finds a product even with a realistic typo', () => {
    const search = createProductSearch(products);
    expect(search('real madri')[0]?.id).toBe('1');
  });

  it('searches category names', () => {
    const search = createProductSearch(products);
    expect(search('flamengo')[0]?.id).toBe('3');
  });

  it('returns the original collection for an empty query', () => {
    const search = createProductSearch(products);
    expect(search('')).toEqual(products);
  });
});
