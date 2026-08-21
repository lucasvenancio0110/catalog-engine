import { routeCatalogEvidence } from './core/domain-router.js';
import { SPORTS_DOMAIN_RUNTIME } from './domains/sports/runtime.js';

export const CATALOG_DOMAIN_RUNTIMES = Object.freeze([SPORTS_DOMAIN_RUNTIME]);

export function classifyCatalogEvidenceAutomatically(evidenceValue) {
  return routeCatalogEvidence(evidenceValue, CATALOG_DOMAIN_RUNTIMES).classification;
}
