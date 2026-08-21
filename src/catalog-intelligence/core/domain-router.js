import { parseCatalogEvidence } from './evidence.js';
import { CEI_DOMAIN_RUNTIME_CONTRACT_VERSION, runDomainRuntime } from './domain-runtime.js';

const MAX_DOMAIN_RUNTIMES = 16;

function validateRuntimes(runtimes) {
  if (!Array.isArray(runtimes) || runtimes.length < 1 || runtimes.length > MAX_DOMAIN_RUNTIMES) {
    throw new Error('cei_domain_router_runtimes_invalid');
  }
  const keys = new Set();
  for (const runtime of runtimes) {
    if (!runtime || runtime.contractVersion !== CEI_DOMAIN_RUNTIME_CONTRACT_VERSION) {
      throw new Error('cei_domain_router_runtime_invalid');
    }
    if (keys.has(runtime.key)) throw new Error('cei_domain_router_runtime_duplicate');
    keys.add(runtime.key);
  }
}

function routeOrder(a, b) {
  const confidence = b.domain.confidence - a.domain.confidence;
  if (confidence !== 0) return confidence;
  const aKnown = a.domain.id === 'unknown' ? 0 : 1;
  const bKnown = b.domain.id === 'unknown' ? 0 : 1;
  if (aKnown !== bKnown) return bKnown - aKnown;
  return a.runtimeKey.localeCompare(b.runtimeKey);
}

export function routeCatalogEvidence(evidenceValue, runtimes) {
  const evidence = parseCatalogEvidence(evidenceValue);
  validateRuntimes(runtimes);
  const candidates = runtimes.map((runtime) => runDomainRuntime(runtime, evidence));
  candidates.sort(routeOrder);
  const selected = candidates[0];
  return Object.freeze({
    runtimeKey: selected.runtimeKey,
    knowledgePackKey: selected.knowledgePackKey,
    knowledgePackVersion: selected.knowledgePackVersion,
    domain: selected.domain,
    classification: selected.classification
  });
}
