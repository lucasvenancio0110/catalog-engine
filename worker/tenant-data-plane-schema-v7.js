import {
  TENANT_DATA_PLANE_CURRENT_STATEMENTS as V6_STATEMENTS,
  tenantDataPlaneCurrentBatch as tenantDataPlaneV6Batch,
  tenantDataPlaneMigrationBatches as tenantDataPlaneV6MigrationBatches
} from './tenant-data-plane-schema-v6.js';

export { TENANT_SYNC_CANDIDATE_TABLES } from './tenant-data-plane-schema-v6.js';

export const TENANT_DATA_PLANE_SCHEMA_VERSION = 7;
export const TENANT_SYNC_AUTHORITY_CONTRACT_VERSION = 1;

export const TENANT_DATA_PLANE_V7_STATEMENTS = Object.freeze([
  `CREATE TABLE IF NOT EXISTS catalog_serving_authority (
    tenant_id TEXT PRIMARY KEY,
    contract_version INTEGER NOT NULL DEFAULT 1 CHECK(contract_version >= 1),
    revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
    last_promoted_run_id TEXT,
    last_promoted_source_key TEXT,
    promoted_at TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES data_plane_identity(tenant_id) ON DELETE CASCADE
  )`,
  `INSERT OR IGNORE INTO catalog_serving_authority
    (tenant_id, contract_version, revision, last_promoted_run_id, last_promoted_source_key,
     promoted_at, updated_at)
   SELECT tenant_id, 1, 0, NULL, NULL, NULL, CURRENT_TIMESTAMP
     FROM data_plane_identity`,
  `CREATE TABLE IF NOT EXISTS supplier_sync_stage_authority (
    run_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    source_key TEXT NOT NULL,
    contract_version INTEGER NOT NULL DEFAULT 1 CHECK(contract_version >= 1),
    base_authority_revision INTEGER NOT NULL CHECK(base_authority_revision >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (run_id) REFERENCES supplier_sync_stage_runs(run_id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_sync_stage_authority_scope
     ON supplier_sync_stage_authority
        (tenant_id, source_key, base_authority_revision)`
]);

export const TENANT_DATA_PLANE_CURRENT_STATEMENTS = Object.freeze([
  ...V6_STATEMENTS,
  ...TENANT_DATA_PLANE_V7_STATEMENTS
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
  if (from < 6) {
    batches.push(
      ...tenantDataPlaneV6MigrationBatches({
        tenantId,
        source,
        currentVersion: from,
        targetVersion: Math.min(target, 6)
      })
    );
  }
  if (target === TENANT_DATA_PLANE_SCHEMA_VERSION && from < TENANT_DATA_PLANE_SCHEMA_VERSION) {
    batches.push([
      ...TENANT_DATA_PLANE_V7_STATEMENTS.map((sql) => ({ sql, params: [] })),
      ...schemaVersionCompletionBatch(tenantId, TENANT_DATA_PLANE_SCHEMA_VERSION)
    ]);
  }
  return batches;
}

export function tenantDataPlaneCurrentBatch({ tenantId, source }) {
  const batch = tenantDataPlaneV6Batch({ tenantId, source });
  batch.push(...TENANT_DATA_PLANE_V7_STATEMENTS.map((sql) => ({ sql, params: [] })));
  batch.push(...schemaVersionCompletionBatch(tenantId, TENANT_DATA_PLANE_SCHEMA_VERSION));
  return batch;
}
