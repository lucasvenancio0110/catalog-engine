import { parseCatalogEvidence } from './evidence.js';
import { CEI_KNOWLEDGE_PACK_CONTRACT_VERSION } from './knowledge-pack.js';

const CLASSIFICATION_STATUS = new Set(['automatic', 'needs_review', 'unknown']);

export const CEI_DOMAIN_RUNTIME_CONTRACT_VERSION = 1;

function assertKnowledgePack(knowledgePack) {
  if (
    !knowledgePack ||
    typeof knowledgePack !== 'object' ||
    knowledgePack.contractVersion !== CEI_KNOWLEDGE_PACK_CONTRACT_VERSION ||
    typeof knowledgePack.key !== 'string' ||
    !knowledgePack.key ||
    typeof knowledgePack.domain !== 'string' ||
    !knowledgePack.domain ||
    !Number.isInteger(knowledgePack.version) ||
    knowledgePack.version < 1
  ) {
    throw new Error('cei_domain_runtime_knowledge_pack_invalid');
  }
}

function boundedConfidence(value, code) {
  const confidence = Number(value);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error(code);
  return confidence;
}

function validateClassification(runtime, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('cei_domain_runtime_classification_invalid');
  }
  const domain = value.domain;
  if (!domain || typeof domain !== 'object' || Array.isArray(domain)) {
    throw new Error('cei_domain_runtime_domain_invalid');
  }
  const domainId = String(domain.id || '').trim().toLowerCase();
  if (domainId !== runtime.knowledgePack.domain && domainId !== 'unknown') {
    throw new Error('cei_domain_runtime_domain_mismatch');
  }
  if (
    domain.knowledgePackKey !== runtime.knowledgePack.key ||
    Number(domain.knowledgePackVersion) !== runtime.knowledgePack.version
  ) {
    throw new Error('cei_domain_runtime_pack_identity_mismatch');
  }
  if (!CLASSIFICATION_STATUS.has(String(value.classificationStatus || ''))) {
    throw new Error('cei_domain_runtime_status_invalid');
  }
  boundedConfidence(value.classificationConfidence, 'cei_domain_runtime_confidence_invalid');
  const domainConfidence = boundedConfidence(
    domain.confidence,
    'cei_domain_runtime_domain_confidence_invalid'
  );
  if (!value.claims || typeof value.claims !== 'object' || Array.isArray(value.claims)) {
    throw new Error('cei_domain_runtime_claims_invalid');
  }

  return Object.freeze({
    id: domainId,
    confidence: domainConfidence,
    knowledgePackKey: runtime.knowledgePack.key,
    knowledgePackVersion: runtime.knowledgePack.version
  });
}

export function defineDomainRuntime({ knowledgePack, classifyEvidence } = {}) {
  assertKnowledgePack(knowledgePack);
  if (typeof classifyEvidence !== 'function') {
    throw new Error('cei_domain_runtime_classifier_invalid');
  }
  return Object.freeze({
    contractVersion: CEI_DOMAIN_RUNTIME_CONTRACT_VERSION,
    key: knowledgePack.key,
    knowledgePack,
    classifyEvidence
  });
}

export function runDomainRuntime(runtime, evidenceValue) {
  if (
    !runtime ||
    runtime.contractVersion !== CEI_DOMAIN_RUNTIME_CONTRACT_VERSION ||
    typeof runtime.classifyEvidence !== 'function'
  ) {
    throw new Error('cei_domain_runtime_invalid');
  }
  assertKnowledgePack(runtime.knowledgePack);
  if (runtime.key !== runtime.knowledgePack.key) {
    throw new Error('cei_domain_runtime_pack_identity_mismatch');
  }

  const evidence = parseCatalogEvidence(evidenceValue);
  const classification = runtime.classifyEvidence(evidence);
  const domain = validateClassification(runtime, classification);
  return Object.freeze({
    runtimeKey: runtime.key,
    knowledgePackKey: runtime.knowledgePack.key,
    knowledgePackVersion: runtime.knowledgePack.version,
    domain,
    classification
  });
}
