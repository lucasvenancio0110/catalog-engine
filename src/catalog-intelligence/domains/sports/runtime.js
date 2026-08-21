import { defineDomainRuntime } from '../../core/domain-runtime.js';
import { parseCatalogEvidence } from '../../core/evidence.js';
import { normalizeCatalogProduct } from '../../../domain/catalog-normalization.js';
import { createSportsClaims } from './claims.js';
import { SPORTS_KNOWLEDGE_PACK } from './knowledge-pack.js';
import { analyzeSportsEvidence } from './resolution.js';

export function classifySportsEvidence(evidenceValue) {
  const evidence = parseCatalogEvidence(evidenceValue);
  const automatic = normalizeCatalogProduct(
    {
      sourceName: evidence.title,
      name: evidence.title,
      description: evidence.description,
      sourceCategoryName: evidence.sourceCategoryName,
      category: evidence.sourceCategoryName,
      structuredAttributes: evidence.structuredAttributes
    },
    evidence.categoryPathNames
  );
  const intelligence = analyzeSportsEvidence(evidence, automatic);
  const base = {
    ...automatic,
    automaticClassificationStatus: automatic.classificationStatus,
    automaticClassificationConfidence: automatic.classificationConfidence,
    domain: intelligence.domain,
    fieldConfidence: intelligence.fieldConfidence,
    season: intelligence.season,
    conflicts: intelligence.conflicts,
    reviewRequired: intelligence.reviewRequired,
    classificationStatus: intelligence.reviewRequired
      ? 'needs_review'
      : automatic.classificationStatus,
    classificationConfidence: intelligence.reviewRequired
      ? Math.min(automatic.classificationConfidence, 0.5)
      : automatic.classificationConfidence
  };
  base.claims = createSportsClaims(base, intelligence);
  return base;
}

export const SPORTS_DOMAIN_RUNTIME = defineDomainRuntime({
  knowledgePack: SPORTS_KNOWLEDGE_PACK,
  classifyEvidence: classifySportsEvidence
});
