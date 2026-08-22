import {
  TENANT_DATA_PLANE_CURRENT_STATEMENTS as V4_STATEMENTS,
  tenantDataPlaneCurrentBatch as tenantDataPlaneV4Batch
} from './tenant-data-plane-schema-v4.js';

export const TENANT_DATA_PLANE_SCHEMA_VERSION = 5;
export const TENANT_SYNC_STAGE_CONTRACT_VERSION = 1;

export const TENANT_DATA_PLANE_V5_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS supplier_sync_stage_runs (
    run_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    source_key TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    scope_kind TEXT NOT NULL CHECK (scope_kind IN ('catalog','category','source','legacy')),
    contract_version INTEGER NOT NULL DEFAULT 1 CHECK (contract_version >= 1),
    state TEXT NOT NULL DEFAULT 'staging' CHECK (
      state IN (
        'staging','planned','details_pending','details_complete',
        'verified','promoting','promoted','preserved','quarantined','failed'
      )
    ),
    safety_outcome TEXT CHECK (
      safety_outcome IS NULL OR safety_outcome IN ('proceed','preserve_last_known_good','quarantine')
    ),
    safety_policy_version INTEGER CHECK (safety_policy_version IS NULL OR safety_policy_version >= 1),
    scan_complete INTEGER NOT NULL DEFAULT 0 CHECK (scan_complete IN (0,1)),
    previous_known_good_count INTEGER NOT NULL DEFAULT 0 CHECK (previous_known_good_count >= 0),
    observed_count INTEGER NOT NULL DEFAULT 0 CHECK (observed_count >= 0),
    disqualifying_failure_count INTEGER NOT NULL DEFAULT 0 CHECK (disqualifying_failure_count >= 0),
    expected_event_count INTEGER NOT NULL DEFAULT 0 CHECK (expected_event_count >= 0),
    expected_detail_count INTEGER NOT NULL DEFAULT 0 CHECK (expected_detail_count >= 0),
    staged_observation_count INTEGER NOT NULL DEFAULT 0 CHECK (staged_observation_count >= 0),
    staged_event_count INTEGER NOT NULL DEFAULT 0 CHECK (staged_event_count >= 0),
    staged_category_count INTEGER NOT NULL DEFAULT 0 CHECK (staged_category_count >= 0),
    verification_code TEXT,
    last_error_code TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    verified_at TEXT,
    promoted_at TEXT,
    FOREIGN KEY (tenant_id, source_key)
      REFERENCES supplier_sources(tenant_id, source_key) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_sync_stage_runs_source
    ON supplier_sync_stage_runs (tenant_id, source_key, state, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS supplier_sync_stage_observations (
    run_id TEXT NOT NULL,
    album_source_id TEXT NOT NULL,
    public_product_id TEXT NOT NULL,
    source_url TEXT NOT NULL,
    source_title TEXT NOT NULL DEFAULT '',
    source_category_id TEXT,
    source_category_path_json TEXT NOT NULL DEFAULT '[]'
      CHECK (json_valid(source_category_path_json)),
    cover_source_url TEXT,
    image_count_hint INTEGER CHECK (image_count_hint IS NULL OR image_count_hint >= 0),
    listing_fingerprint TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (run_id, album_source_id),
    FOREIGN KEY (run_id) REFERENCES supplier_sync_stage_runs(run_id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_sync_stage_observations_product
    ON supplier_sync_stage_observations (run_id, public_product_id)`,

  `CREATE TABLE IF NOT EXISTS supplier_sync_stage_events (
    run_id TEXT NOT NULL,
    album_source_id TEXT NOT NULL,
    public_product_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (
      event_type IN ('NEW','CHANGED','CHANGED_MOVED','MOVED','RESTORED','MISSING','REMOVED')
    ),
    needs_detail INTEGER NOT NULL DEFAULT 0 CHECK (needs_detail IN (0,1)),
    next_miss_count INTEGER CHECK (next_miss_count IS NULL OR next_miss_count >= 0),
    reason_code TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (run_id, album_source_id),
    FOREIGN KEY (run_id) REFERENCES supplier_sync_stage_runs(run_id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_sync_stage_events_type
    ON supplier_sync_stage_events (run_id, event_type, needs_detail)`,

  `CREATE TABLE IF NOT EXISTS supplier_sync_stage_categories (
    run_id TEXT NOT NULL,
    category_source_id TEXT NOT NULL,
    name TEXT NOT NULL,
    parent_source_id TEXT,
    depth INTEGER NOT NULL DEFAULT 0 CHECK (depth >= 0),
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (run_id, category_source_id),
    FOREIGN KEY (run_id) REFERENCES supplier_sync_stage_runs(run_id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_sync_stage_categories_parent
    ON supplier_sync_stage_categories (run_id, parent_source_id, sort_order)`
];

export const TENANT_DATA_PLANE_CURRENT_STATEMENTS = [
  ...V4_STATEMENTS,
  ...TENANT_DATA_PLANE_V5_STATEMENTS
];

export function tenantDataPlaneCurrentBatch({ tenantId, source }) {
  const batch = tenantDataPlaneV4Batch({ tenantId, source });
  batch.push(...TENANT_DATA_PLANE_V5_STATEMENTS.map((sql) => ({ sql, params: [] })));
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
