import { describe, expect, it } from 'vitest';
import {
  CEI_NORMALIZED_EVIDENCE_VERSION,
  createCatalogEvidence,
  parseCatalogEvidence
} from '../src/catalog-intelligence/core/evidence.js';
import {
  classifyCatalogEvidence,
  classifyCatalogRecord
} from '../src/domain/catalog-classifier.js';

function evidence(provenance = {}) {
  return createCatalogEvidence({
    recordId: 'p_example',
    title: '  Manchester   City 26/27 Home Player Version Jersey  ',
    description: 'Home shirt',
    sourceCategoryName: 'Manchester City',
    categoryPathNames: ['⚽ Premier League', 'Manchester City'],
    structuredAttributes: { seasonHint: '26/27' },
    provenance
  });
}

describe('CEI normalized evidence v1', () => {
  it('creates a bounded versioned source-neutral record', () => {
    const result = evidence({
      providerKey: 'yupoo',
      sourceKey: 'primary',
      sourceLocalId: '123456'
    });

    expect(result.schemaVersion).toBe(CEI_NORMALIZED_EVIDENCE_VERSION);
    expect(result.title).toBe('Manchester City 26/27 Home Player Version Jersey');
    expect(result.categoryPathNames).toEqual(['⚽ Premier League', 'Manchester City']);
    expect(result.provenance).toEqual({
      providerKey: 'yupoo',
      sourceKey: 'primary',
      sourceLocalId: '123456'
    });
  });

  it('rejects provider-shaped fields outside the normalized evidence contract', () => {
    const valid = evidence();
    expect(() =>
      parseCatalogEvidence({
        ...valid,
        albumSourceId: 'provider-specific-field'
      })
    ).toThrow();
  });

  it('keeps provider provenance from changing classification semantics', () => {
    const yupoo = classifyCatalogEvidence(
      evidence({ providerKey: 'yupoo', sourceKey: 'primary', sourceLocalId: '1' })
    );
    const futureProvider = classifyCatalogEvidence(
      evidence({ providerKey: 'shopify', sourceKey: 'main', sourceLocalId: 'gid-1' })
    );

    expect(futureProvider).toEqual(yupoo);
    expect(yupoo.team?.id).toBe('manchester-city');
    expect(yupoo.league?.id).toBe('premier-league');
    expect(yupoo.facets.map((facet) => facet.id)).toEqual(
      expect.arrayContaining(['shirts', 'player-version'])
    );
  });

  it('preserves legacy classifier behavior through the normalized evidence boundary', () => {
    const legacy = classifyCatalogRecord(
      {
        name: 'Manchester City 26/27 Home Player Version Jersey',
        category: 'Manchester City',
        description: 'Home shirt'
      },
      ['⚽ Premier League', 'Manchester City']
    );
    const normalized = classifyCatalogEvidence(evidence());

    expect(normalized).toEqual(legacy);
  });

  it('rejects unbounded structured attribute bags', () => {
    const structuredAttributes = Object.fromEntries(
      Array.from({ length: 65 }, (_value, index) => [`attribute-${index}`, index])
    );
    expect(() =>
      createCatalogEvidence({
        title: 'Example product',
        structuredAttributes
      })
    ).toThrow('cei_evidence_attributes_too_many');
  });
});
