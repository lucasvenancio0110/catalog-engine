import { describe, expect, it } from 'vitest';
import { defineKnowledgePack } from '../src/catalog-intelligence/core/knowledge-pack.js';
import {
  CEI_MERCHANDISING_CONTRACT_VERSION,
  defineMerchandising,
  materializeMerchandisingNavigation
} from '../src/catalog-intelligence/core/merchandising.js';
import {
  SPORTS_KNOWLEDGE_PACK,
  SPORTS_MERCHANDISING
} from '../src/catalog-intelligence/domains/sports/knowledge-pack.js';
import { buildSportsMerchandisingState } from '../worker/cei-merchandising-persistence.js';

function wheelPack() {
  return defineKnowledgePack({
    key: 'test-wheels-v1',
    domain: 'automotive',
    version: 1,
    facets: [
      { id: 'wheels', type: 'product_type', name: 'Rodas' },
      { id: 'diameter-18', type: 'diameter', name: 'Aro 18' }
    ],
    merchandising: {
      navigation: [
        { id: 'facet:wheels', name: 'Rodas', kind: 'facet', facetId: 'wheels', sortOrder: 10 },
        { id: 'facet:diameter-18', name: 'Aro 18', kind: 'facet', facetId: 'diameter-18', sortOrder: 20 }
      ]
    }
  });
}

describe('CEI merchandising contract v1', () => {
  it('materializes a non-Sports Knowledge Pack without changing the CEI core', () => {
    const pack = wheelPack();
    expect(pack.domain).toBe('automotive');
    expect(pack.merchandising.contractVersion).toBe(CEI_MERCHANDISING_CONTRACT_VERSION);
    expect(pack.merchandising.navigation.map((item) => item.name)).toEqual(['Rodas', 'Aro 18']);

    const counts = new Map([
      ['wheels', 8],
      ['diameter-18', 3]
    ]);
    const navigation = materializeMerchandisingNavigation(
      pack,
      (item) => counts.get(item.facetId) || 0
    );
    expect(navigation).toEqual([
      expect.objectContaining({ id: 'facet:wheels', facetId: 'wheels', count: 8 }),
      expect.objectContaining({ id: 'facet:diameter-18', facetId: 'diameter-18', count: 3 })
    ]);
  });

  it('keeps Sports merchandising versioned and owned by the Sports Pack', () => {
    expect(SPORTS_KNOWLEDGE_PACK.merchandising).toEqual(SPORTS_MERCHANDISING);
    expect(SPORTS_KNOWLEDGE_PACK.merchandising.navigation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'teams', kind: 'teams', entityType: 'club' }),
        expect.objectContaining({ id: 'national-teams', entityType: 'national_team' }),
        expect.objectContaining({ id: 'facet:shirts', facetId: 'shirts' })
      ])
    );
    expect(Object.isFrozen(SPORTS_KNOWLEDGE_PACK.merchandising)).toBe(true);
    expect(Object.isFrozen(SPORTS_KNOWLEDGE_PACK.merchandising.navigation)).toBe(true);
  });

  it('builds public-safe Sports navigation from actual catalog counts', () => {
    const state = buildSportsMerchandisingState({
      entityTypes: new Map([
        ['club', 5],
        ['national_team', 0]
      ]),
      facets: new Map([
        ['shirts', 4],
        ['kits', 0],
        ['retro', 1]
      ])
    });

    expect(state.fallbackUsed).toBe(false);
    expect(state.navigation.map((item) => item.id)).toEqual(
      expect.arrayContaining(['teams', 'facet:shirts', 'facet:retro'])
    );
    expect(state.navigation.some((item) => item.id === 'national-teams')).toBe(false);
    expect(state.navigation.some((item) => item.count === 0)).toBe(false);
    expect(JSON.stringify(state)).not.toMatch(/https?:\/\/|yupoo|provider|source_url/i);
  });

  it('falls back to a bounded pack-defined navigation when no positive counts exist yet', () => {
    const state = buildSportsMerchandisingState({
      entityTypes: new Map(),
      facets: new Map()
    });
    expect(state.fallbackUsed).toBe(true);
    expect(state.navigation.length).toBeGreaterThan(0);
    expect(state.navigation.length).toBeLessThanOrEqual(64);
    expect(state.navigation.every((item) => item.count === 0)).toBe(true);
  });

  it('fails closed on duplicate ids, unsafe labels and invalid counts', () => {
    expect(() =>
      defineMerchandising({
        navigation: [
          { id: 'same', name: 'A', kind: 'facet', sortOrder: 1 },
          { id: 'same', name: 'B', kind: 'facet', sortOrder: 2 }
        ]
      })
    ).toThrow('cei_merchandising_navigation_duplicate');

    expect(() =>
      defineMerchandising({
        navigation: [{ id: 'bad', name: 'https://supplier.example', kind: 'facet', sortOrder: 1 }]
      })
    ).toThrow('cei_merchandising_item_name_invalid');

    expect(() => materializeMerchandisingNavigation(wheelPack(), () => -1)).toThrow(
      'cei_merchandising_count_invalid'
    );
  });
});
