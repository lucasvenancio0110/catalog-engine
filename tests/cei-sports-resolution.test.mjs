import { describe, expect, it } from 'vitest';
import { createCatalogEvidence } from '../src/catalog-intelligence/core/evidence.js';
import {
  CATALOG_CLASSIFIER_KEY,
  CATALOG_CLASSIFIER_VERSION,
  classifyCatalogEvidence
} from '../src/domain/catalog-classifier.js';

function evidence({
  title,
  sourceCategoryName = '',
  categoryPathNames = [],
  structuredAttributes = {}
}) {
  return createCatalogEvidence({
    recordId: 'fixture-product',
    title,
    description: '',
    sourceCategoryName,
    categoryPathNames,
    structuredAttributes,
    provenance: {
      providerKey: 'fixture-provider',
      sourceKey: 'fixture-source',
      sourceLocalId: 'fixture-local-id'
    }
  });
}

describe('CEI Sports v1 evidence resolution', () => {
  it('adds domain, field confidence and a reliable two-year season without changing a clear classification', () => {
    const result = classifyCatalogEvidence(
      evidence({
        title: 'Barcelona 26/27 Home Player Version Jersey',
        sourceCategoryName: 'Barcelona',
        categoryPathNames: ['⚽ La Liga', 'Barcelona']
      })
    );

    expect(CATALOG_CLASSIFIER_VERSION).toBe(2);
    expect(CATALOG_CLASSIFIER_KEY).toBe('professional-v2');
    expect(result.team?.id).toBe('barcelona');
    expect(result.league?.id).toBe('la-liga');
    expect(result.domain).toMatchObject({
      id: 'sports',
      knowledgePackKey: 'sports-v1',
      knowledgePackVersion: 1
    });
    expect(result.domain.confidence).toBeGreaterThanOrEqual(0.96);
    expect(result.fieldConfidence.team).toBeGreaterThanOrEqual(0.9);
    expect(result.fieldConfidence.league).toBeGreaterThanOrEqual(0.9);
    expect(result.season).toMatchObject({
      label: '2026/27',
      startYear: 2026,
      endYear: 2027
    });
    expect(result.season.confidence).toBeGreaterThanOrEqual(0.96);
    expect(result.conflicts).toEqual([]);
    expect(result.reviewRequired).toBe(false);
    expect(result.classificationStatus).toBe('automatic');
  });

  it('does not manufacture a season from a single retro year', () => {
    const result = classifyCatalogEvidence(
      evidence({
        title: 'Barcelona Retro 1999 Jersey',
        sourceCategoryName: 'Barcelona',
        categoryPathNames: ['⚽ La Liga', 'Barcelona']
      })
    );

    expect(result.season).toBeNull();
    expect(result.fieldConfidence.season).toBe(0);
    expect(result.conflicts.some((item) => item.field === 'season')).toBe(false);
  });

  it('accepts an explicit structured season as stronger evidence', () => {
    const result = classifyCatalogEvidence(
      evidence({
        title: 'Barcelona Home Jersey',
        sourceCategoryName: 'Barcelona',
        categoryPathNames: ['⚽ La Liga', 'Barcelona'],
        structuredAttributes: { season: '2025/26' }
      })
    );

    expect(result.season).toMatchObject({
      label: '2025/26',
      startYear: 2025,
      endYear: 2026,
      confidence: 0.99
    });
  });

  it('surfaces conflicting teams instead of silently choosing one', () => {
    const fixture = evidence({
      title: 'Barcelona Real Madrid 26/27 Home Jersey',
      sourceCategoryName: '⚽ La Liga',
      categoryPathNames: ['⚽ La Liga']
    });
    const result = classifyCatalogEvidence(fixture);

    expect(result.reviewRequired).toBe(true);
    expect(result.classificationStatus).toBe('needs_review');
    expect(result.classificationConfidence).toBeLessThanOrEqual(0.5);
    expect(result.fieldConfidence.team).toBe(0.45);
    expect(result.conflicts).toContainEqual({
      code: 'sports_team_conflict',
      field: 'team',
      candidateIds: ['barcelona', 'real-madrid']
    });
  });

  it('lets an explicit merchant team override resolve the team conflict on rerun', () => {
    const fixture = evidence({
      title: 'Barcelona Real Madrid 26/27 Home Jersey',
      sourceCategoryName: '⚽ La Liga',
      categoryPathNames: ['⚽ La Liga']
    });
    const result = classifyCatalogEvidence(fixture, { teamId: 'barcelona' });

    expect(result.team?.id).toBe('barcelona');
    expect(result.fieldConfidence.team).toBe(1);
    expect(result.conflicts).toEqual([]);
    expect(result.reviewRequired).toBe(false);
    expect(result.classificationStatus).toBe('automatic');
    expect(result.overrideApplied).toBe(true);
  });

  it('detects a team-to-competition contradiction even when the legacy resolver suppresses the team', () => {
    const result = classifyCatalogEvidence(
      evidence({
        title: 'Barcelona 26/27 Home Jersey',
        sourceCategoryName: 'Premier League',
        categoryPathNames: ['Premier League']
      })
    );

    expect(result.reviewRequired).toBe(true);
    expect(result.classificationStatus).toBe('needs_review');
    expect(result.conflicts).toContainEqual({
      code: 'sports_league_conflict',
      field: 'league',
      candidateIds: ['la-liga', 'premier-league']
    });
  });

  it('withholds season when strong evidence disagrees', () => {
    const result = classifyCatalogEvidence(
      evidence({
        title: 'Barcelona 26/27 Home Jersey',
        sourceCategoryName: 'Barcelona 25/26',
        categoryPathNames: ['⚽ La Liga', 'Barcelona']
      })
    );

    expect(result.season).toBeNull();
    expect(result.fieldConfidence.season).toBe(0);
    expect(result.conflicts).toContainEqual({
      code: 'sports_season_conflict',
      field: 'season',
      candidateIds: ['2025/26', '2026/27']
    });
    expect(result.classificationStatus).toBe('needs_review');
  });

  it('detects mutually exclusive player/fan version evidence', () => {
    const result = classifyCatalogEvidence(
      evidence({
        title: 'Barcelona Player Version Fan Version Jersey',
        sourceCategoryName: 'Barcelona',
        categoryPathNames: ['⚽ La Liga', 'Barcelona']
      })
    );

    expect(result.conflicts).toContainEqual({
      code: 'sports_version_conflict',
      field: 'version',
      candidateIds: ['fan-version', 'player-version']
    });
    expect(result.classificationStatus).toBe('needs_review');
  });

  it('keeps unknown-domain evidence explicit instead of forcing sports', () => {
    const result = classifyCatalogEvidence(
      evidence({
        title: 'Generic Product X',
        sourceCategoryName: 'Miscellaneous'
      })
    );

    expect(result.domain.id).toBe('unknown');
    expect(result.domain.confidence).toBeLessThan(0.51);
  });

  it('normalizes a classic 99/00 season without interpreting it as 2099', () => {
    const result = classifyCatalogEvidence(
      evidence({
        title: 'Barcelona 99/00 Retro Jersey',
        sourceCategoryName: 'Barcelona',
        categoryPathNames: ['⚽ La Liga', 'Barcelona']
      })
    );

    expect(result.season).toMatchObject({
      label: '1999/00',
      startYear: 1999,
      endYear: 2000
    });
  });
});
