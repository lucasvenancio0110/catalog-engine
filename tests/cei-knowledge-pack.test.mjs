import { describe, expect, it } from 'vitest';
import {
  CEI_KNOWLEDGE_PACK_CONTRACT_VERSION,
  defineKnowledgePack
} from '../src/catalog-intelligence/core/knowledge-pack.js';
import {
  SPORTS_FACETS,
  SPORTS_KNOWLEDGE_PACK,
  SPORTS_LEAGUES,
  SPORTS_TEAMS
} from '../src/catalog-intelligence/domains/sports/knowledge-pack.js';
import { FACETS, LEAGUES, TEAMS } from '../src/domain/catalog-normalization.js';

describe('CEI Sports Knowledge Pack v1', () => {
  it('is versioned, domain-scoped and exposes controlled sports knowledge', () => {
    expect(SPORTS_KNOWLEDGE_PACK.contractVersion).toBe(CEI_KNOWLEDGE_PACK_CONTRACT_VERSION);
    expect(SPORTS_KNOWLEDGE_PACK.key).toBe('sports-v1');
    expect(SPORTS_KNOWLEDGE_PACK.domain).toBe('sports');
    expect(SPORTS_KNOWLEDGE_PACK.version).toBe(1);
    expect(SPORTS_KNOWLEDGE_PACK.competitions.some((entry) => entry.id === 'premier-league')).toBe(true);
    expect(SPORTS_KNOWLEDGE_PACK.entities.some((entry) => entry.id === 'manchester-city')).toBe(true);
    expect(SPORTS_KNOWLEDGE_PACK.facets.some((entry) => entry.id === 'player-version')).toBe(true);
  });

  it('keeps legacy normalization dictionaries semantically identical to the extracted pack definitions', () => {
    expect(LEAGUES).toEqual(SPORTS_LEAGUES);
    expect(TEAMS).toEqual(SPORTS_TEAMS);
    expect(FACETS).toEqual(SPORTS_FACETS);
    expect(SPORTS_KNOWLEDGE_PACK.competitions).toEqual(SPORTS_LEAGUES);
    expect(SPORTS_KNOWLEDGE_PACK.entities).toEqual(SPORTS_TEAMS);
    expect(SPORTS_KNOWLEDGE_PACK.facets).toEqual(SPORTS_FACETS);
  });

  it('fails closed on duplicate entity identities and invalid review thresholds', () => {
    expect(() =>
      defineKnowledgePack({
        key: 'broken-pack',
        domain: 'sports',
        version: 1,
        entities: [{ id: 'same' }, { id: 'same' }]
      })
    ).toThrow('cei_knowledge_pack_entities_invalid');

    expect(() =>
      defineKnowledgePack({
        key: 'broken-thresholds',
        domain: 'sports',
        version: 1,
        reviewThresholds: { automatic: 1.5 }
      })
    ).toThrow('cei_knowledge_pack_review_threshold_invalid');
  });

  it('freezes the executable pack surface so runtime code cannot mutate shared knowledge', () => {
    expect(Object.isFrozen(SPORTS_KNOWLEDGE_PACK)).toBe(true);
    expect(Object.isFrozen(SPORTS_KNOWLEDGE_PACK.competitions)).toBe(true);
    expect(Object.isFrozen(SPORTS_KNOWLEDGE_PACK.entities)).toBe(true);
    expect(Object.isFrozen(SPORTS_KNOWLEDGE_PACK.facets)).toBe(true);
  });
});
