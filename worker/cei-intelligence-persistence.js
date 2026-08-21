import {
  CEI_INTELLIGENCE_STATE_CONTRACT_VERSION,
  serializeCatalogIntelligenceState
} from '../src/catalog-intelligence/core/intelligence-state.js';

export function intelligenceStateStatement(productId, classified) {
  let serialized;
  try {
    serialized = serializeCatalogIntelligenceState(classified);
  } catch {
    throw new Error('cei_intelligence_state_invalid');
  }

  const state = serialized.state;
  return {
    sql: `INSERT INTO catalog_product_intelligence_state
            (product_id, contract_version, evidence_schema_version,
             classifier_version, classifier_key,
             knowledge_pack_key, knowledge_pack_version,
             domain_id, domain_confidence, domain_knowledge_state,
             knowledge_state, override_applied, review_required,
             research_required, conflict_count, state_json,
             classified_at, updated_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                  ?11, ?12, ?13, ?14, ?15, ?16,
                  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT(product_id) DO UPDATE SET
            contract_version=excluded.contract_version,
            evidence_schema_version=excluded.evidence_schema_version,
            classifier_version=excluded.classifier_version,
            classifier_key=excluded.classifier_key,
            knowledge_pack_key=excluded.knowledge_pack_key,
            knowledge_pack_version=excluded.knowledge_pack_version,
            domain_id=excluded.domain_id,
            domain_confidence=excluded.domain_confidence,
            domain_knowledge_state=excluded.domain_knowledge_state,
            knowledge_state=excluded.knowledge_state,
            override_applied=excluded.override_applied,
            review_required=excluded.review_required,
            research_required=excluded.research_required,
            conflict_count=excluded.conflict_count,
            state_json=excluded.state_json,
            classified_at=CURRENT_TIMESTAMP,
            updated_at=CURRENT_TIMESTAMP`,
    params: [
      String(productId),
      CEI_INTELLIGENCE_STATE_CONTRACT_VERSION,
      state.evidenceSchemaVersion,
      state.classifierVersion,
      state.classifierKey,
      state.knowledgePackKey,
      state.knowledgePackVersion,
      state.domain.id,
      state.domain.confidence,
      state.domain.knowledgeState,
      serialized.knowledgeState,
      state.overrideApplied ? 1 : 0,
      serialized.reviewRequired ? 1 : 0,
      serialized.researchRequired ? 1 : 0,
      serialized.conflictCount,
      serialized.stateJson
    ]
  };
}
