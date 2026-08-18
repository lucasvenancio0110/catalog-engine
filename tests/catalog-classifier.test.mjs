import { describe, expect, it } from 'vitest';
import {
  CATALOG_CLASSIFIER_KEY,
  CATALOG_CLASSIFIER_VERSION,
  classifyCatalogRecord,
  parseCatalogClassificationOverride
} from '../src/domain/catalog-classifier.js';

const product = {
  name: 'Manchester City 26/27 Home Player Version Jersey',
  category: 'Manchester City',
  description: 'Home shirt'
};
const path = ['⚽ Premier League', 'Manchester City'];

describe('versioned catalog classifier', () => {
  it('stamps the current classifier identity on normal automatic classification', () => {
    const result = classifyCatalogRecord(product, path);
    expect(result.classifierVersion).toBe(CATALOG_CLASSIFIER_VERSION);
    expect(result.classifierKey).toBe(CATALOG_CLASSIFIER_KEY);
    expect(result.team?.id).toBe('manchester-city');
    expect(result.league?.id).toBe('premier-league');
    expect(result.overrideApplied).toBe(false);
  });

  it('applies a valid manual override after automatic classification and keeps it searchable', () => {
    const result = classifyCatalogRecord(product, path, {
      displayName: 'Camisa City Especial',
      teamId: 'arsenal',
      facetIds: ['shirts', 'retro'],
      classificationStatus: 'automatic',
      classificationConfidence: 1
    });

    expect(result.displayName).toBe('Camisa City Especial');
    expect(result.team?.id).toBe('arsenal');
    expect(result.league?.id).toBe('premier-league');
    expect(result.facets.map((facet) => facet.id)).toEqual(['shirts', 'retro']);
    expect(result.classificationConfidence).toBe(1);
    expect(result.searchText).toContain('camisa city especial');
    expect(result.searchText).toContain('arsenal');
    expect(result.overrideApplied).toBe(true);
  });

  it('allows a manual override to clear an automatically inferred team and league', () => {
    const result = classifyCatalogRecord(product, path, {
      teamId: null,
      leagueId: null,
      classificationStatus: 'needs_review'
    });
    expect(result.team).toBeNull();
    expect(result.league).toBeNull();
    expect(result.classificationStatus).toBe('needs_review');
    expect(result.overrideApplied).toBe(true);
  });

  it('rejects override references outside the controlled dictionaries', () => {
    expect(() => parseCatalogClassificationOverride({ teamId: 'unknown-team' })).toThrow(
      'classification_override_unknown_team'
    );
    expect(() => parseCatalogClassificationOverride({ leagueId: 'unknown-league' })).toThrow(
      'classification_override_unknown_league'
    );
    expect(() => parseCatalogClassificationOverride({ facetIds: ['unknown-facet'] })).toThrow(
      'classification_override_unknown_facet'
    );
  });

  it('rejects supplier/web URLs in public manual labels', () => {
    expect(() =>
      parseCatalogClassificationOverride({
        displayName: 'Veja https://supplier.x.yupoo.com/albums/123'
      })
    ).toThrow();
  });

  it('does not introduce supplier URLs into the public classifier output', () => {
    const result = classifyCatalogRecord(
      {
        ...product,
        description: 'normal public description'
      },
      path
    );
    expect(JSON.stringify(result)).not.toMatch(/x\.yupoo\.com|photo\.yupoo\.com/i);
  });
});
