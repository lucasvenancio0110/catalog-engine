import { describe, expect, it } from 'vitest';
import { publicCategoryId } from '../scripts/catalog-sync.mjs';
import { enrichPublicCatalogTaxonomy } from '../scripts/public-taxonomy.mjs';

const rawTaxonomy = [
  { id: '100', name: 'Brasil', parentId: null, childIds: ['101'], depth: 0 },
  { id: '101', name: 'São Paulo', parentId: '100', childIds: [], depth: 1 }
];

describe('enrichPublicCatalogTaxonomy', () => {
  it('converts raw hierarchy to opaque IDs and attaches the product path', () => {
    const enriched = enrichPublicCatalogTaxonomy({
      catalog: {
        schemaVersion: 4,
        taxonomy: [],
        products: [{ id: 'p_aaaaaaaaaaaaaaaaaaaa', name: 'Camisa São Paulo', category: 'São Paulo', images: ['./a.jpg'] }]
      },
      sourceState: {
        products: [{
          publicId: 'p_aaaaaaaaaaaaaaaaaaaa',
          sourceCategoryId: '101',
          sourceCategoryName: 'São Paulo'
        }]
      },
      rawTaxonomy
    });

    const brazilId = publicCategoryId('yupoo', '100');
    const saoPauloId = publicCategoryId('yupoo', '101');
    const brazil = enriched.taxonomy.find((category) => category.id === brazilId);
    const saoPaulo = enriched.taxonomy.find((category) => category.id === saoPauloId);
    const product = enriched.products[0];

    expect(enriched.schemaVersion).toBe(5);
    expect(brazil.parentId).toBeNull();
    expect(brazil.childIds).toEqual([saoPauloId]);
    expect(saoPaulo.parentId).toBe(brazilId);
    expect(product.categoryId).toBe(saoPauloId);
    expect(product.categoryPathIds).toEqual([brazilId, saoPauloId]);
    expect(JSON.stringify(enriched)).not.toContain('"101"');
  });

  it('matches a unique category name when the source category id is missing', () => {
    const enriched = enrichPublicCatalogTaxonomy({
      catalog: {
        schemaVersion: 4,
        taxonomy: [],
        products: [{ id: 'p_bbbbbbbbbbbbbbbbbbbb', name: 'Camisa', category: 'São Paulo', images: ['./b.jpg'] }]
      },
      sourceState: {
        products: [{ publicId: 'p_bbbbbbbbbbbbbbbbbbbb', sourceCategoryId: null, sourceCategoryName: 'São Paulo' }]
      },
      rawTaxonomy
    });

    expect(enriched.products[0].categoryId).toBe(publicCategoryId('yupoo', '101'));
  });

  it('falls back to a stable opaque Outros category without source leakage', () => {
    const enriched = enrichPublicCatalogTaxonomy({
      catalog: {
        schemaVersion: 4,
        taxonomy: [],
        products: [{ id: 'p_cccccccccccccccccccc', name: 'Item', category: 'Desconhecida', images: ['./c.jpg'] }]
      },
      sourceState: { products: [] },
      rawTaxonomy
    });

    const product = enriched.products[0];
    expect(product.categoryId).toMatch(/^c_[a-f0-9]{20}$/);
    expect(enriched.taxonomy.find((category) => category.id === product.categoryId)?.name).toBe('Outros');
    expect(JSON.stringify(enriched)).not.toContain('sourceCategoryId');
  });
});
