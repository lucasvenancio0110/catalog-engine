import {
  TENANT_DATA_PLANE_V1_STATEMENTS,
  tenantDataPlaneV1Batch
} from './tenant-data-plane-schema.js';

export const TENANT_DATA_PLANE_SCHEMA_VERSION = 2;

export const TENANT_DATA_PLANE_V2_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS supplier_category_index (
    tenant_id TEXT NOT NULL,
    source_key TEXT NOT NULL,
    category_source_id TEXT NOT NULL,
    name TEXT NOT NULL,
    parent_source_id TEXT,
    depth INTEGER NOT NULL DEFAULT 0 CHECK (depth >= 0),
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, source_key, category_source_id),
    FOREIGN KEY (tenant_id, source_key) REFERENCES supplier_sources(tenant_id, source_key) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_category_index_parent
    ON supplier_category_index (tenant_id, source_key, parent_source_id, sort_order)`,

  `CREATE TABLE IF NOT EXISTS supplier_album_detail_state (
    tenant_id TEXT NOT NULL,
    source_key TEXT NOT NULL,
    album_source_id TEXT NOT NULL,
    import_id TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending'
      CHECK (state IN ('pending', 'processing', 'success', 'skipped', 'deferred', 'failed')),
    claim_token TEXT,
    lease_until TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    outcome_code TEXT,
    last_error_code TEXT,
    detail_fingerprint TEXT,
    processed_at TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, source_key, album_source_id),
    FOREIGN KEY (tenant_id, source_key, album_source_id)
      REFERENCES supplier_album_index(tenant_id, source_key, album_source_id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_album_detail_state_import
    ON supplier_album_detail_state (tenant_id, source_key, import_id, state, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_album_detail_state_lease
    ON supplier_album_detail_state (state, lease_until)`
];

export const TENANT_DATA_PLANE_CURRENT_STATEMENTS = [
  ...TENANT_DATA_PLANE_V1_STATEMENTS,
  ...TENANT_DATA_PLANE_V2_STATEMENTS
];

export function tenantDataPlaneCurrentBatch({ tenantId, source }) {
  const batch = tenantDataPlaneV1Batch({ tenantId, source });
  batch.push(...TENANT_DATA_PLANE_V2_STATEMENTS.map((sql) => ({ sql, params: [] })));
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
