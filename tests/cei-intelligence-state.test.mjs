import { describe, expect, it } from 'vitest';
import {
  CEI_KNOWLEDGE_STATE,
  createCatalogIntelligenceState,
  deriveKnowledgeState,
  parseCatalogIntelligenceState,
  serializeCatalogIntelligenceState
} from '../src/catalog-intelligence/core/intelligence-state.js';
import { classifyCatalogRecord } from '../src/domain/catalog-classifier.js';

describe('CEI intelligence state', () => {
  it('maps confidence and evidence conditions into explicit knowledge states', () => {
    expect(deriveKnowledgeState(0.98)).toBe(CEI_KNOWLEDGE_STATE.VERIFIED);
    expect(deriveKnowledgeState(0.9)).toBe(CEI_KNOWLEDGE_STATE.KNOWN);
    expect(deriveKnowledgeState(0.72)).toBe(CEI_KNOWLEDGE_STATE.UNCERTAIN);
    expect(deriveKnowledgeState(0.2)).toBe(CEI_KNOWLEDGE_STATE.UNKNOWN);
    expect(deriveKnowledgeState(0.99, { conflict: true })).toBe(CEI_KNOWLEDGE_STATE.CONFLICT);
    expect(deriveKnowledgeState(0.99, { stale: true })).toBe(CEI_KNOWLEDGE_STATE.STALE);
    expect(deriveKnowledgeState(0.99, { classificationStatus: 'unknown' })).toBe(
      CEI_KNOWLEDGE_STATE.UNKNOWN
    );
  });

  it('preserves automatic inference separately from merchant-corrected effective state', () => {
    const classified = classifyCatalogRecord(
      {
        productId: 'p_test_conflict',
        sourceName: 'Barcelona Real Madrid 26/27 Player Version',
        sourceCategoryName: 'La Liga',
        description: ''
      },
      ['La Liga'],
      { teamId: 'barcelona' }
    );

    const state = createCatalogIntelligenceState(classified);

    expect(state.overrideApplied).toBe(true);
    expect(state.automatic.knowledgeState).toBe(CEI_KNOWLEDGE_STATE.CONFLICT);
    expect(state.automatic.claims.team.knowledgeState).toBe(CEI_KNOWLEDGE_STATE.CONFLICT);
    expect(state.automatic.conflicts.some((item) => item.code === 'sports_team_conflict')).toBe(true);

    expect(state.effective.claims.team.value).toBe('barcelona');
    expect(state.effective.claims.team.confidence).toBe(1);
    expect(state.effective.claims.team.knowledgeState).toBe(CEI_KNOWLEDGE_STATE.VERIFIED);
    expect(state.effective.claims.team.source).toBe('merchant_override');
    expect(state.effective.conflicts.some((item) => item.field === 'team')).toBe(false);

    expect(state.research.required).toBe(true);
    expect(state.research.reasonCodes).toContain('knowledge_conflict');
  });

  it('accepts non-sports claims without changing the CEI Core contract', () => {
    const state = createCatalogIntelligenceState({
      evidenceSchemaVersion: 1,
      classifierVersion: 7,
      classifierKey: 'automotive-test-v7',
      domain: {
        id: 'automotive',
        confidence: 0.98,
        knowledgePackKey: 'automotive-wheels-v1',
        knowledgePackVersion: 1
      },
      classificationStatus: 'automatic',
      classificationConfidence: 0.96,
      claims: {
        productType: {
          value: 'wheel',
          confidence: 0.99,
          evidenceSources: ['title', 'category']
        },
        diameter: {
          value: 18,
          confidence: 0.98,
          evidenceSources: ['title']
        },
        boltPattern: {
          value: '5x112',
          confidence: 0.97,
          evidenceSources: ['title', 'attributes']
        },
        offset: {
          value: 35,
          confidence: 0.91,
          evidenceSources: ['title']
        }
      },
      conflicts: [],
      reviewRequired: false,
      overrideFields: [],
      overrideApplied: false
    });

    expect(state.domain.id).toBe('automotive');
    expect(state.knowledgePackKey).toBe('automotive-wheels-v1');
    expect(state.effective.claims.productType.value).toBe('wheel');
    expect(state.effective.claims.boltPattern.value).toBe('5x112');
    expect(state.effective.claims.offset.knowledgeState).toBe(CEI_KNOWLEDGE_STATE.KNOWN);
    expect(Object.hasOwn(state.effective.claims, 'team')).toBe(false);
    expect(Object.hasOwn(state.effective.claims, 'league')).toBe(false);
  });

  it('serializes one bounded canonical state for durable persistence', () => {
    const classified = classifyCatalogRecord(
      {
        productId: 'p_barcelona',
        sourceName: 'Barcelona 26/27 Player Version',
        sourceCategoryName: 'Barcelona'
      },
      ['La Liga', 'Barcelona']
    );
    const serialized = serializeCatalogIntelligenceState(classified);
    const reparsed = parseCatalogIntelligenceState(serialized.stateJson);

    expect(reparsed).toEqual(serialized.state);
    expect(serialized.conflictCount).toBe(0);
    expect(serialized.reviewRequired).toBe(false);
    expect(typeof serialized.knowledgeState).toBe('string');
  });

  it('fails closed when arbitrary unbounded state is injected', () => {
    expect(() =>
      parseCatalogIntelligenceState({
        contractVersion: 1,
        evidenceSchemaVersion: 1,
        classifierVersion: 1,
        classifierKey: 'test-v1',
        knowledgePackKey: null,
        knowledgePackVersion: null,
        domain: { id: 'unknown', confidence: 0, knowledgeState: 'UNKNOWN' },
        automatic: {
          status: 'unknown',
          confidence: 0,
          knowledgeState: 'UNKNOWN',
          claims: {},
          conflicts: [],
          reviewRequired: false
        },
        effective: {
          status: 'unknown',
          confidence: 0,
          knowledgeState: 'UNKNOWN',
          claims: {},
          conflicts: [],
          reviewRequired: false
        },
        overrideApplied: false,
        research: {
          required: false,
          reasonCodes: [],
          unknownConcepts: [],
          unexpected: 'not allowed'
        }
      })
    ).toThrow();
  });
});
