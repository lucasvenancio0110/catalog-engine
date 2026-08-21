import { describe, expect, it } from 'vitest';
import { createCatalogEvidence } from '../src/catalog-intelligence/core/evidence.js';
import { parseCatalogIntelligenceState } from '../src/catalog-intelligence/core/intelligence-state.js';
import { classifyCatalogEvidence } from '../src/domain/catalog-classifier.js';
import { intelligenceStateStatement } from '../worker/cei-intelligence-persistence.js';

describe('CEI intelligence persistence adapter', () => {
  it('writes one canonical domain-neutral state payload that round-trips through the CEI schema', () => {
    const evidence = createCatalogEvidence({
      recordId: 'p_test_barcelona',
      title: 'Barcelona 26/27 Player Version',
      sourceCategoryName: 'Barcelona',
      categoryPathNames: ['La Liga', 'Barcelona'],
      provenance: {
        providerKey: 'yupoo',
        sourceKey: 'private-source',
        sourceLocalId: 'private-album-123'
      }
    });
    const classified = classifyCatalogEvidence(evidence);
    const statement = intelligenceStateStatement('p_test_barcelona', classified);

    expect(statement.sql).toContain('INSERT INTO catalog_product_intelligence_state');
    expect(statement.sql).toContain('ON CONFLICT(product_id) DO UPDATE SET');
    expect(statement.params).toHaveLength(16);

    const stateJson = statement.params[15];
    const state = parseCatalogIntelligenceState(stateJson);
    expect(state.domain.id).toBe('sports');
    expect(state.effective.claims.team.value).toBe('barcelona');
    expect(state.effective.claims.season.value).toEqual({
      label: '2026/27',
      startYear: 2026,
      endYear: 2027
    });
  });

  it('never persists provider/source-local provenance into the intelligence state JSON', () => {
    const secretSourceKey = 'tenant-private-source-key';
    const secretLocalId = 'supplier-private-album-id';
    const evidence = createCatalogEvidence({
      recordId: 'p_private_provenance',
      title: 'Flamengo 26/27 Fan Version',
      sourceCategoryName: 'Flamengo',
      categoryPathNames: ['Brasileirão Série A', 'Flamengo'],
      provenance: {
        providerKey: 'yupoo',
        sourceKey: secretSourceKey,
        sourceLocalId: secretLocalId
      }
    });
    const statement = intelligenceStateStatement(
      'p_private_provenance',
      classifyCatalogEvidence(evidence)
    );
    const stateJson = String(statement.params[15]);

    expect(stateJson).not.toContain(secretSourceKey);
    expect(stateJson).not.toContain(secretLocalId);
    expect(stateJson).not.toContain('yupoo');
    expect(stateJson).not.toMatch(/https?:\/\//i);
  });

  it('fails closed instead of generating a partial row for invalid intelligence output', () => {
    expect(() =>
      intelligenceStateStatement('p_invalid', {
        classifierVersion: 2,
        classifierKey: 'professional-v2',
        classificationStatus: 'automatic',
        classificationConfidence: 2,
        domain: { id: 'sports', confidence: 4 },
        fieldConfidence: {},
        conflicts: [],
        facets: []
      })
    ).toThrow('cei_intelligence_state_invalid');
  });
});
