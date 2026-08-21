import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createCatalogEvidence } from '../src/catalog-intelligence/core/evidence.js';
import {
  defineDomainRuntime,
  runDomainRuntime
} from '../src/catalog-intelligence/core/domain-runtime.js';
import { routeCatalogEvidence } from '../src/catalog-intelligence/core/domain-router.js';
import { defineKnowledgePack } from '../src/catalog-intelligence/core/knowledge-pack.js';
import { SPORTS_DOMAIN_RUNTIME } from '../src/catalog-intelligence/domains/sports/runtime.js';
import { CATALOG_DOMAIN_RUNTIMES } from '../src/catalog-intelligence/runtime.js';
import { classifyCatalogEvidence } from '../src/domain/catalog-classifier.js';

const WHEELS_PACK = defineKnowledgePack({
  key: 'test-wheels-v1',
  domain: 'automotive',
  version: 1,
  facets: [{ id: 'wheel' }],
  reviewThresholds: { automatic: 0.8, needsReview: 0.55 }
});

const WHEELS_RUNTIME = defineDomainRuntime({
  knowledgePack: WHEELS_PACK,
  classifyEvidence(evidence) {
    const text = `${evidence.title} ${evidence.description} ${evidence.sourceCategoryName}`.toLowerCase();
    const recognized = /\b(?:wheel|wheels|roda|rodas|5x112|et35)\b/.test(text);
    const confidence = recognized ? 0.97 : 0.2;
    return {
      displayName: evidence.title,
      displayCategoryName: evidence.sourceCategoryName || 'Catalog',
      searchText: text,
      facets: [],
      classificationStatus: recognized ? 'automatic' : 'unknown',
      classificationConfidence: recognized ? 0.94 : 0.2,
      automaticClassificationStatus: recognized ? 'automatic' : 'unknown',
      automaticClassificationConfidence: recognized ? 0.94 : 0.2,
      domain: {
        id: recognized ? 'automotive' : 'unknown',
        confidence,
        knowledgePackKey: WHEELS_PACK.key,
        knowledgePackVersion: WHEELS_PACK.version
      },
      fieldConfidence: { productType: recognized ? 0.98 : 0 },
      conflicts: [],
      reviewRequired: false,
      claims: {
        productType: {
          value: recognized ? 'wheel' : null,
          confidence: recognized ? 0.98 : 0,
          evidenceSources: recognized ? ['title'] : []
        },
        boltPattern: {
          value: text.includes('5x112') ? '5x112' : null,
          confidence: text.includes('5x112') ? 0.99 : 0,
          evidenceSources: text.includes('5x112') ? ['title'] : []
        },
        offset: {
          value: text.includes('et35') ? 35 : null,
          confidence: text.includes('et35') ? 0.99 : 0,
          evidenceSources: text.includes('et35') ? ['title'] : []
        }
      }
    };
  }
});

function evidence(provenance = { providerKey: 'test-provider', sourceKey: 'primary' }) {
  return createCatalogEvidence({
    recordId: 'p_wheel_1',
    title: '18 inch Wheel 5x112 ET35',
    description: 'Alloy wheel',
    sourceCategoryName: 'Wheels',
    categoryPathNames: ['Automotive', 'Wheels'],
    provenance
  });
}

describe('CEI domain router v1', () => {
  it('keeps the production launch registry restricted to Sports v1', () => {
    expect(CATALOG_DOMAIN_RUNTIMES.map((runtime) => runtime.key)).toEqual(['sports-v1']);
    expect(CATALOG_DOMAIN_RUNTIMES).not.toContain(WHEELS_RUNTIME);
    expect(Object.isFrozen(CATALOG_DOMAIN_RUNTIMES)).toBe(true);
  });

  it('selects the strongest domain runtime without teaching the Core automotive semantics', () => {
    const route = routeCatalogEvidence(evidence(), [SPORTS_DOMAIN_RUNTIME, WHEELS_RUNTIME]);

    expect(route.runtimeKey).toBe('test-wheels-v1');
    expect(route.domain.id).toBe('automotive');
    expect(route.domain.confidence).toBe(0.97);
    expect(route.classification.claims.productType.value).toBe('wheel');
    expect(route.classification.claims.boltPattern.value).toBe('5x112');
    expect(route.classification.claims.offset.value).toBe(35);
  });

  it('is deterministic regardless of runtime registration order', () => {
    const first = routeCatalogEvidence(evidence(), [SPORTS_DOMAIN_RUNTIME, WHEELS_RUNTIME]);
    const second = routeCatalogEvidence(evidence(), [WHEELS_RUNTIME, SPORTS_DOMAIN_RUNTIME]);
    expect(second.runtimeKey).toBe(first.runtimeKey);
    expect(second.domain).toEqual(first.domain);
  });

  it('does not let provider provenance change domain routing semantics', () => {
    const yupoo = routeCatalogEvidence(
      evidence({ providerKey: 'yupoo', sourceKey: 'primary', sourceLocalId: 'a1' }),
      [SPORTS_DOMAIN_RUNTIME, WHEELS_RUNTIME]
    );
    const other = routeCatalogEvidence(
      evidence({ providerKey: 'shopify', sourceKey: 'primary', sourceLocalId: 'b9' }),
      [SPORTS_DOMAIN_RUNTIME, WHEELS_RUNTIME]
    );
    expect(yupoo.runtimeKey).toBe('test-wheels-v1');
    expect(other.runtimeKey).toBe(yupoo.runtimeKey);
    expect(other.domain).toEqual(yupoo.domain);
    expect(other.classification.claims).toEqual(yupoo.classification.claims);
  });

  it('fails closed on duplicate runtimes and mismatched Knowledge Pack identity', () => {
    expect(() => routeCatalogEvidence(evidence(), [WHEELS_RUNTIME, WHEELS_RUNTIME])).toThrow(
      'cei_domain_router_runtime_duplicate'
    );

    const broken = defineDomainRuntime({
      knowledgePack: WHEELS_PACK,
      classifyEvidence() {
        return {
          classificationStatus: 'automatic',
          classificationConfidence: 0.9,
          domain: {
            id: 'automotive',
            confidence: 0.9,
            knowledgePackKey: 'wrong-pack',
            knowledgePackVersion: 1
          },
          claims: { productType: { value: 'wheel', confidence: 0.9, evidenceSources: [] } }
        };
      }
    });
    expect(() => runDomainRuntime(broken, evidence())).toThrow(
      'cei_domain_runtime_pack_identity_mismatch'
    );
  });

  it('preserves the production Sports classifier contract through the runtime composition', () => {
    const sportsEvidence = createCatalogEvidence({
      recordId: 'p_city',
      title: 'Manchester City 26/27 Home Player Version Jersey',
      description: 'Home shirt',
      sourceCategoryName: 'Manchester City',
      categoryPathNames: ['Premier League', 'Manchester City'],
      provenance: { providerKey: 'yupoo', sourceKey: 'primary', sourceLocalId: 'city-1' }
    });
    const classified = classifyCatalogEvidence(sportsEvidence);

    expect(classified.domain.id).toBe('sports');
    expect(classified.domain.knowledgePackKey).toBe('sports-v1');
    expect(classified.team?.id).toBe('manchester-city');
    expect(classified.league?.id).toBe('premier-league');
    expect(classified.claims.team.value).toBe('manchester-city');
    expect(classified.season?.label).toBe('2026/27');
    expect(classified.classifierVersion).toBe(3);
    expect(classified.classifierKey).toBe('professional-v3');
  });

  it('keeps CEI Core and the top-level classifier free of direct Sports resolver/claims imports', () => {
    const router = fs.readFileSync('src/catalog-intelligence/core/domain-router.js', 'utf8');
    const runtimeContract = fs.readFileSync('src/catalog-intelligence/core/domain-runtime.js', 'utf8');
    const classifier = fs.readFileSync('src/domain/catalog-classifier.js', 'utf8');

    expect(router).not.toMatch(/domains\/sports|analyzeSportsEvidence|createSportsClaims/);
    expect(runtimeContract).not.toMatch(/domains\/sports|analyzeSportsEvidence|createSportsClaims/);
    expect(classifier).not.toMatch(/analyzeSportsEvidence|createSportsClaims|domains\/sports/);
  });
});
