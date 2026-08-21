import {
  TENANT_DATA_PLANE_CURRENT_STATEMENTS as V3_STATEMENTS,
  tenantDataPlaneCurrentBatch as tenantDataPlaneV3Batch
} from './tenant-data-plane-schema-v3.js';

export const TENANT_DATA_PLANE_SCHEMA_VERSION = 4;
export const CEI_STATE_JSON_MAX_BYTES = 65_536;

export const TENANT_DATA_PLANE_V4_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS catalog_product_intelligence_state (
    product_id TEXT PRIMARY KEY,
    contract_version INTEGER NOT NULL CHECK (contract_version >= 1),
    evidence_schema_version INTEGER NOT NULL CHECK (evidence_schema_version >= 1),
    classifier_version INTEGER NOT NULL CHECK (classifier_version >= 1),
    classifier_key TEXT NOT NULL,
    knowledge_pack_key TEXT,
    knowledge_pack_version INTEGER CHECK (knowledge_pack_version IS NULL OR knowledge_pack_version >= 1),
    domain_id TEXT NOT NULL,
    domain_confidence REAL NOT NULL CHECK (domain_confidence >= 0 AND domain_confidence <= 1),
    domain_knowledge_state TEXT NOT NULL CHECK (
      domain_knowledge_state IN ('VERIFIED','KNOWN','UNCERTAIN','UNKNOWN','CONFLICT','STALE')
    ),
    knowledge_state TEXT NOT NULL CHECK (
      knowledge_state IN ('VERIFIED','KNOWN','UNCERTAIN','UNKNOWN','CONFLICT','STALE')
    ),
    override_applied INTEGER NOT NULL DEFAULT 0 CHECK (override_applied IN (0,1)),
    review_required INTEGER NOT NULL DEFAULT 0 CHECK (review_required IN (0,1)),
    research_required INTEGER NOT NULL DEFAULT 0 CHECK (research_required IN (0,1)),
    conflict_count INTEGER NOT NULL DEFAULT 0 CHECK (conflict_count >= 0),
    state_json TEXT NOT NULL CHECK (json_valid(state_json) AND length(CAST(state_json AS BLOB)) <= 65536),
    classified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES catalog_products(product_id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_catalog_product_intelligence_classifier
    ON catalog_product_intelligence_state (classifier_version, classifier_key)`,
  `CREATE INDEX IF NOT EXISTS idx_catalog_product_intelligence_review
    ON catalog_product_intelligence_state (review_required, knowledge_state, domain_id)`,
  `CREATE INDEX IF NOT EXISTS idx_catalog_product_intelligence_research
    ON catalog_product_intelligence_state (research_required, knowledge_state, domain_id)`
];

export const TENANT_DATA_PLANE_CURRENT_STATEMENTS = [
  ...V3_STATEMENTS,
  ...TENANT_DATA_PLANE_V4_STATEMENTS
];

export function tenantDataPlaneCurrentBatch({ tenantId, source }) {
  const batch = tenantDataPlaneV3Batch({ tenantId, source });
  batch.push(...TENANT_DATA_PLANE_V4_STATEMENTS.map((sql) => ({ sql, params: [] })));
  batch.push({
    sql: `UPDATE data_plane_identity
             SET schema_version=?2, updated_at=CURRENT_TIMESTAMP
           WHERE tenant_id=?1`,
    params: [tenantId, TENANT_DATA_PLANE_SCHEMA_VERSION]
  });
  batch.push({
    sql: `INSERT OR IGNORE INTO data_plane_schema_migrations (version, applied_at)
          VALUES (?1, CURRENT_TIMESTAMP)`,
    params: [TENANT_DATA_PLANE_SCHEMA_VERSION]
  });
  return batch;
}
