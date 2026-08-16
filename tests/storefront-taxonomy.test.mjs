import { describe, expect, it } from 'vitest';
import { createTaxonomyModel } from '../src/catalog/taxonomy.js';

const taxonomy = [
  { id: 'c_root', name: 'Brasil', parentId: null, childIds: ['c_sp', 'c_rj'], depth: 0 },
  { id: 'c_sp', name: 'São Paulo', parentId: 'c_root', childIds: [], depth: 1 },
  { id: 'c_rj', name: 'Rio', parentId: 'c_root', childIds: ['c_fla'], depth: 1 },
  { id: 'c_fla', name: 'Flamengo', parentId: 'c_rj', childIds: [], depth: 2 },
  { id: 'c_empty', name: 'Sem produtos', parentId: null, childIds: [], depth: 0 }
];

const products = [
  { id: 'p1', categoryId: 'c_sp', categoryPathIds: ['c_root', 'c_sp'] },
  { id: 'p2', categoryId: 'c_fla', categoryPathIds: ['c_root', 'c_rj', 'c_fla'] },
  { id: 'p3', categoryId: 'c_fla', categoryPathIds: ['c_root', 'c_rj', 'c_fla'] }
];

describe('createTaxonomyModel', () => {
  it('aggregates product counts through descendants and hides empty roots', () => {
    const model = createTaxonomyModel(taxonomy, products);
    expect(model.count('c_root')).toBe(3);
    expect(model.count('c_rj')).toBe(2);
    expect(model.roots().map((category) => category.id)).toEqual(['c_root']);
  });

  it('returns only children with products and orders them by aggregated count', () => {
    const model = createTaxonomyModel(taxonomy, products);
    expect(model.children('c_root').map((category) => category.id)).toEqual(['c_rj', 'c_sp']);
  });

  it('filters a parent category across all descendants', () => {
    const model = createTaxonomyModel(taxonomy, products);
    expect(products.filter((product) => model.productMatches(product, 'c_rj')).map((product) => product.id)).toEqual(['p2', 'p3']);
    expect(products.filter((product) => model.productMatches(product, 'c_root'))).toHaveLength(3);
  });

  it('builds a stable breadcrumb trail', () => {
    const model = createTaxonomyModel(taxonomy, products);
    expect(model.trail('c_fla').map((category) => category.name)).toEqual(['Brasil', 'Rio', 'Flamengo']);
  });
});
