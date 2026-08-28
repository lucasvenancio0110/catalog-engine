import {
  TENANT_DATA_PLANE_CURRENT_STATEMENTS as V7_STATEMENTS,
  tenantDataPlaneCurrentBatch as tenantDataPlaneV7Batch,
  tenantDataPlaneMigrationBatches as tenantDataPlaneV7MigrationBatches
} from './tenant-data-plane-schema-v7.js';

export { TENANT_SYNC_CANDIDATE_TABLES } from './tenant-data-plane-schema-v7.js';

export const TENANT_DATA_PLANE_SCHEMA_VERSION = 8;
export const TENANT_SYNC_REMOVAL_POLICY_CONTRACT_VERSION = 1;
export const TENANT_SYNC_REMOVAL_POLICY_VERSION = 1;

export const TENANT_DATA_PLANE_V8_STATEMENTS = Object.freeze([
  `CREATE TABLE IF NOT EXISTS supplier_scope_memberships (
    tenant_id TEXT NOT NULL,
    source_key TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    scope_kind TEXT NOT NULL CHECK (scope_kind IN ('catalog','category','source','legacy')),
    album_source_id TEXT NOT NULL,
    public_product_id TEXT NOT NULL,
    contract_version INTEGER NOT NULL DEFAULT 1 CHECK (contract_version >= 1),
    removal_policy_version INTEGER NOT NULL DEFAULT 1 CHECK (removal_policy_version >= 1),
    removal_threshold INTEGER NOT NULL CHECK (removal_threshold >= 2),
    state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','missing','detached')),
    miss_count INTEGER NOT NULL DEFAULT 0 CHECK (miss_count >= 0),
    last_observed_run_id TEXT,
    last_progress_run_id TEXT,
    detached_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, source_key, scope_id, album_source_id),
    FOREIGN KEY (tenant_id, source_key, album_source_id)
      REFERENCES supplier_album_index(tenant_id, source_key, album_source_id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_scope_memberships_product
    ON supplier_scope_memberships
      (tenant_id, source_key, public_product_id, state, scope_id)`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_scope_memberships_progress
    ON supplier_scope_memberships
      (tenant_id, source_key, scope_id, state, miss_count, last_progress_run_id)`,
  `CREATE TABLE IF NOT EXISTS supplier_sync_stage_removal_policy (
    run_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    source_key TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    scope_kind TEXT NOT NULL CHECK (scope_kind IN ('catalog','category','source','legacy')),
    contract_version INTEGER NOT NULL DEFAULT 1 CHECK (contract_version >= 1),
    policy_version INTEGER NOT NULL DEFAULT 1 CHECK (policy_version >= 1),
    removal_threshold INTEGER NOT NULL CHECK (removal_threshold >= 2),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (run_id) REFERENCES supplier_sync_stage_runs(run_id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_sync_stage_removal_policy_scope
    ON supplier_sync_stage_removal_policy
      (tenant_id, source_key, scope_id, policy_version)`,
  `CREATE TABLE IF NOT EXISTS catalog_product_classification_override_retention (
    product_id TEXT PRIMARY KEY,
    override_json TEXT NOT NULL CHECK (json_valid(override_json)),
    override_version INTEGER NOT NULL CHECK (override_version >= 1),
    original_created_at TEXT NOT NULL,
    original_updated_at TEXT NOT NULL,
    retained_by_run_id TEXT NOT NULL,
    retained_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE VIEW IF NOT EXISTS catalog_product_effective_classification_overrides AS
    SELECT product_id, override_json, override_version, created_at, updated_at
      FROM catalog_product_classification_overrides
    UNION ALL
    SELECT r.product_id, r.override_json, r.override_version,
           r.original_created_at AS created_at, r.original_updated_at AS updated_at
      FROM catalog_product_classification_override_retention r
     WHERE NOT EXISTS (
       SELECT 1 FROM catalog_product_classification_overrides o
        WHERE o.product_id=r.product_id
     )`
]);

export const TENANT_DATA_PLANE_CURRENT_STATEMENTS = Object.freeze([
  ...V7_STATEMENTS,
  ...TENANT_DATA_PLANE_V8_STATEMENTS
]);

function schemaVersionCompletionBatch(tenantId, version) {
  return [
    {
      sql: `UPDATE data_plane_identity
              SET schema_version=?2, updated_at=CURRENT_TIMESTAMP
            WHERE tenant_id=?1`,
      params: [tenantId, version]
    },
    {
      sql: `INSERT OR IGNORE INTO data_plane_schema_migrations (version, applied_at)
            VALUES (?1, CURRENT_TIMESTAMP)`,
      params: [version]
    }
  ];
}

export function tenantDataPlaneMigrationBatches({
  tenantId,
  source,
  currentVersion,
  targetVersion = TENANT_DATA_PLANE_SCHEMA_VERSION
}) {
  const from = Number(currentVersion);
  const target = Number(targetVersion);
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(target) ||
    from < 1 ||
    target < 1 ||
    target > TENANT_DATA_PLANE_SCHEMA_VERSION ||
    from > target
  ) {
    throw new Error('tenant_data_plane_migration_range_invalid');
  }
  if (from === target) return [];

  const batches = [];
  if (from < 7) {
    batches.push(
      ...tenantDataPlaneV7MigrationBatches({
        tenantId,
        source,
        currentVersion: from,
        targetVersion: Math.min(target, 7)
      })
    );
  }
  if (target === TENANT_DATA_PLANE_SCHEMA_VERSION && from < TENANT_DATA_PLANE_SCHEMA_VERSION) {
    batches.push([
      ...TENANT_DATA_PLANE_V8_STATEMENTS.map((sql) => ({ sql, params: [] })),
      ...schemaVersionCompletionBatch(tenantId, TENANT_DATA_PLANE_SCHEMA_VERSION)
    ]);
  }
  return batches;
}

export function tenantDataPlaneCurrentBatch({ tenantId, source }) {
  const batch = tenantDataPlaneV7Batch({ tenantId, source });
  batch.push(...TENANT_DATA_PLANE_V8_STATEMENTS.map((sql) => ({ sql, params: [] })));
  batch.push(...schemaVersionCompletionBatch(tenantId, TENANT_DATA_PLANE_SCHEMA_VERSION));
  return batch;
}
