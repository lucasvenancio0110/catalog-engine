import {
  TENANT_DATA_PLANE_CURRENT_STATEMENTS as V2_STATEMENTS,
  tenantDataPlaneCurrentBatch as tenantDataPlaneV2Batch
} from './tenant-data-plane-schema-v2.js';

export const TENANT_DATA_PLANE_SCHEMA_VERSION = 3;

export const TENANT_DATA_PLANE_V3_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS catalog_product_classification_state (
    product_id TEXT PRIMARY KEY,
    classifier_version INTEGER NOT NULL CHECK (classifier_version >= 1),
    classifier_key TEXT NOT NULL,
    override_applied INTEGER NOT NULL DEFAULT 0 CHECK (override_applied IN (0,1)),
    classified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES catalog_products(product_id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_catalog_product_classification_state_version
    ON catalog_product_classification_state (classifier_version, classifier_key)`,

  `CREATE TABLE IF NOT EXISTS catalog_product_classification_overrides (
    product_id TEXT PRIMARY KEY,
    override_json TEXT NOT NULL,
    override_version INTEGER NOT NULL DEFAULT 1 CHECK (override_version >= 1),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES catalog_products(product_id) ON DELETE CASCADE
  )`
];

export const TENANT_DATA_PLANE_CURRENT_STATEMENTS = [
  ...V2_STATEMENTS,
  ...TENANT_DATA_PLANE_V3_STATEMENTS
];

export function tenantDataPlaneCurrentBatch({ tenantId, source }) {
  const batch = tenantDataPlaneV2Batch({ tenantId, source });
  batch.push(...TENANT_DATA_PLANE_V3_STATEMENTS.map((sql) => ({ sql, params: [] })));
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
