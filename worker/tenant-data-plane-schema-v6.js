import {
  TENANT_DATA_PLANE_CURRENT_STATEMENTS as V5_STATEMENTS,
  tenantDataPlaneCurrentBatch as tenantDataPlaneV5Batch,
  tenantDataPlaneMigrationBatches as tenantDataPlaneV5MigrationBatches
} from './tenant-data-plane-schema-v5.js';

export const TENANT_DATA_PLANE_SCHEMA_VERSION = 6;
export const TENANT_SYNC_CANDIDATE_CONTRACT_VERSION = 1;
export const TENANT_SYNC_CANDIDATE_JSON_MAX_BYTES = 262_144;

export const TENANT_SYNC_CANDIDATE_TABLES = Object.freeze([
  'supplier_sync_stage_catalog_categories',
  'supplier_sync_stage_leagues',
  'supplier_sync_stage_teams',
  'supplier_sync_stage_facets',
  'supplier_sync_stage_media_sources',
  'supplier_sync_stage_product_details',
  'supplier_sync_stage_product_media',
  'supplier_sync_stage_product_categories',
  'supplier_sync_stage_product_facets',
  'supplier_sync_stage_classification_state',
  'supplier_sync_stage_intelligence_state',
  'supplier_sync_stage_catalog_meta'
]);

export const TENANT_DATA_PLANE_V6_STATEMENTS = [
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_sync_stage_observations_identity
    ON supplier_sync_stage_observations (run_id, album_source_id, public_product_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_sync_stage_events_identity
    ON supplier_sync_stage_events (run_id, album_source_id, public_product_id)`,

  `CREATE TABLE IF NOT EXISTS supplier_sync_stage_catalog_categories (
    run_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    name TEXT NOT NULL,
    parent_id TEXT,
    depth INTEGER NOT NULL DEFAULT 0 CHECK (depth >= 0),
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    product_count INTEGER NOT NULL DEFAULT 0 CHECK (product_count >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (run_id, category_id),
    FOREIGN KEY (run_id) REFERENCES supplier_sync_stage_runs(run_id) ON DELETE CASCADE,
    FOREIGN KEY (run_id, parent_id)
      REFERENCES supplier_sync_stage_catalog_categories(run_id, category_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_sync_stage_catalog_categories_parent
    ON supplier_sync_stage_catalog_categories (run_id, parent_id, sort_order)`,

  `CREATE TABLE IF NOT EXISTS supplier_sync_stage_leagues (
    run_id TEXT NOT NULL,
    league_id TEXT NOT NULL,
    name TEXT NOT NULL,
    country_code TEXT NOT NULL,
    country_name TEXT NOT NULL,
    entity_type TEXT NOT NULL DEFAULT 'club',
    logo_url TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    product_count INTEGER NOT NULL DEFAULT 0 CHECK (product_count >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (run_id, league_id),
    FOREIGN KEY (run_id) REFERENCES supplier_sync_stage_runs(run_id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_sync_stage_leagues_country
    ON supplier_sync_stage_leagues (run_id, country_code, sort_order)`,

  `CREATE TABLE IF NOT EXISTS supplier_sync_stage_teams (
    run_id TEXT NOT NULL,
    team_id TEXT NOT NULL,
    name TEXT NOT NULL,
    short_name TEXT NOT NULL,
    league_id TEXT,
    country_code TEXT,
    entity_type TEXT NOT NULL DEFAULT 'club',
    logo_url TEXT,
    initials TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    product_count INTEGER NOT NULL DEFAULT 0 CHECK (product_count >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (run_id, team_id),
    FOREIGN KEY (run_id) REFERENCES supplier_sync_stage_runs(run_id) ON DELETE CASCADE,
    FOREIGN KEY (run_id, league_id)
      REFERENCES supplier_sync_stage_leagues(run_id, league_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_sync_stage_teams_league
    ON supplier_sync_stage_teams (run_id, league_id, sort_order)`,

  `CREATE TABLE IF NOT EXISTS supplier_sync_stage_facets (
    run_id TEXT NOT NULL,
    facet_id TEXT NOT NULL,
    facet_type TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    product_count INTEGER NOT NULL DEFAULT 0 CHECK (product_count >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (run_id, facet_id),
    FOREIGN KEY (run_id) REFERENCES supplier_sync_stage_runs(run_id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_sync_stage_facets_type
    ON supplier_sync_stage_facets (run_id, facet_type, sort_order)`,

  `CREATE TABLE IF NOT EXISTS supplier_sync_stage_media_sources (
    run_id TEXT NOT NULL,
    media_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    source_url TEXT NOT NULL,
    display_source_url TEXT,
    thumbnail_source_url TEXT,
    referer_url TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (run_id, media_id),
    FOREIGN KEY (run_id) REFERENCES supplier_sync_stage_runs(run_id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_sync_stage_media_active
    ON supplier_sync_stage_media_sources (run_id, active, media_id)`,

  `CREATE TABLE IF NOT EXISTS supplier_sync_stage_product_details (
    run_id TEXT NOT NULL,
    album_source_id TEXT NOT NULL,
    public_product_id TEXT NOT NULL,
    detail_state TEXT NOT NULL DEFAULT 'pending' CHECK (
      detail_state IN ('pending','processing','complete','failed')
    ),
    claim_token TEXT,
    lease_until TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    outcome_code TEXT,
    last_error_code TEXT,
    provider_contract_version INTEGER CHECK (
      provider_contract_version IS NULL OR provider_contract_version >= 1
    ),
    evidence_schema_version INTEGER CHECK (
      evidence_schema_version IS NULL OR evidence_schema_version >= 1
    ),
    detail_fingerprint TEXT,
    normalized_evidence_json TEXT CHECK (
      normalized_evidence_json IS NULL OR (
        json_valid(normalized_evidence_json)
        AND length(CAST(normalized_evidence_json AS BLOB)) <= 262144
      )
    ),
    name TEXT,
    search_text TEXT,
    category_id TEXT,
    category_name TEXT,
    description TEXT,
    image_count INTEGER CHECK (image_count IS NULL OR image_count >= 0),
    primary_media_id TEXT,
    sort_order INTEGER CHECK (sort_order IS NULL OR sort_order >= 0),
    source_name TEXT,
    display_name TEXT,
    source_category_name TEXT,
    display_category_name TEXT,
    team_id TEXT,
    league_id TEXT,
    classification_status TEXT CHECK (
      classification_status IS NULL OR
      classification_status IN ('automatic','needs_review','unknown')
    ),
    classification_confidence REAL CHECK (
      classification_confidence IS NULL OR
      (classification_confidence >= 0 AND classification_confidence <= 1)
    ),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at TEXT,
    PRIMARY KEY (run_id, public_product_id),
    UNIQUE (run_id, album_source_id),
    CHECK (
      detail_state <> 'complete' OR (
        provider_contract_version IS NOT NULL
        AND evidence_schema_version IS NOT NULL
        AND detail_fingerprint IS NOT NULL
        AND normalized_evidence_json IS NOT NULL
        AND name IS NOT NULL
        AND search_text IS NOT NULL
        AND category_id IS NOT NULL
        AND category_name IS NOT NULL
        AND description IS NOT NULL
        AND image_count IS NOT NULL
        AND sort_order IS NOT NULL
      )
    ),
    FOREIGN KEY (run_id) REFERENCES supplier_sync_stage_runs(run_id) ON DELETE CASCADE,
    FOREIGN KEY (run_id, album_source_id, public_product_id)
      REFERENCES supplier_sync_stage_observations(run_id, album_source_id, public_product_id),
    FOREIGN KEY (run_id, album_source_id, public_product_id)
      REFERENCES supplier_sync_stage_events(run_id, album_source_id, public_product_id),
    FOREIGN KEY (run_id, category_id)
      REFERENCES supplier_sync_stage_catalog_categories(run_id, category_id),
    FOREIGN KEY (run_id, primary_media_id)
      REFERENCES supplier_sync_stage_media_sources(run_id, media_id),
    FOREIGN KEY (run_id, team_id)
      REFERENCES supplier_sync_stage_teams(run_id, team_id),
    FOREIGN KEY (run_id, league_id)
      REFERENCES supplier_sync_stage_leagues(run_id, league_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_sync_stage_product_details_state
    ON supplier_sync_stage_product_details (run_id, detail_state, lease_until)`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_sync_stage_product_details_classification
    ON supplier_sync_stage_product_details (run_id, classification_status, public_product_id)`,

  `CREATE TABLE IF NOT EXISTS supplier_sync_stage_product_media (
    run_id TEXT NOT NULL,
    public_product_id TEXT NOT NULL,
    media_id TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (run_id, public_product_id, position),
    UNIQUE (run_id, public_product_id, media_id),
    FOREIGN KEY (run_id, public_product_id)
      REFERENCES supplier_sync_stage_product_details(run_id, public_product_id) ON DELETE CASCADE,
    FOREIGN KEY (run_id, media_id)
      REFERENCES supplier_sync_stage_media_sources(run_id, media_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_sync_stage_product_media_source
    ON supplier_sync_stage_product_media (run_id, media_id)`,

  `CREATE TABLE IF NOT EXISTS supplier_sync_stage_product_categories (
    run_id TEXT NOT NULL,
    public_product_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    PRIMARY KEY (run_id, public_product_id, category_id),
    FOREIGN KEY (run_id, public_product_id)
      REFERENCES supplier_sync_stage_product_details(run_id, public_product_id) ON DELETE CASCADE,
    FOREIGN KEY (run_id, category_id)
      REFERENCES supplier_sync_stage_catalog_categories(run_id, category_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_sync_stage_product_categories_category
    ON supplier_sync_stage_product_categories (run_id, category_id, public_product_id)`,

  `CREATE TABLE IF NOT EXISTS supplier_sync_stage_product_facets (
    run_id TEXT NOT NULL,
    public_product_id TEXT NOT NULL,
    facet_id TEXT NOT NULL,
    PRIMARY KEY (run_id, public_product_id, facet_id),
    FOREIGN KEY (run_id, public_product_id)
      REFERENCES supplier_sync_stage_product_details(run_id, public_product_id) ON DELETE CASCADE,
    FOREIGN KEY (run_id, facet_id)
      REFERENCES supplier_sync_stage_facets(run_id, facet_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_sync_stage_product_facets_facet
    ON supplier_sync_stage_product_facets (run_id, facet_id, public_product_id)`,

  `CREATE TABLE IF NOT EXISTS supplier_sync_stage_classification_state (
    run_id TEXT NOT NULL,
    public_product_id TEXT NOT NULL,
    classifier_version INTEGER NOT NULL CHECK (classifier_version >= 1),
    classifier_key TEXT NOT NULL,
    override_applied INTEGER NOT NULL DEFAULT 0 CHECK (override_applied IN (0,1)),
    merchant_override_version INTEGER CHECK (
      merchant_override_version IS NULL OR merchant_override_version >= 1
    ),
    merchant_override_updated_at TEXT,
    classified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (run_id, public_product_id),
    CHECK (
      (override_applied=0 AND merchant_override_version IS NULL)
      OR (override_applied=1 AND merchant_override_version IS NOT NULL)
    ),
    FOREIGN KEY (run_id, public_product_id)
      REFERENCES supplier_sync_stage_product_details(run_id, public_product_id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_sync_stage_classification_version
    ON supplier_sync_stage_classification_state (run_id, classifier_version, classifier_key)`,

  `CREATE TABLE IF NOT EXISTS supplier_sync_stage_intelligence_state (
    run_id TEXT NOT NULL,
    public_product_id TEXT NOT NULL,
    contract_version INTEGER NOT NULL CHECK (contract_version >= 1),
    evidence_schema_version INTEGER NOT NULL CHECK (evidence_schema_version >= 1),
    classifier_version INTEGER NOT NULL CHECK (classifier_version >= 1),
    classifier_key TEXT NOT NULL,
    knowledge_pack_key TEXT,
    knowledge_pack_version INTEGER CHECK (
      knowledge_pack_version IS NULL OR knowledge_pack_version >= 1
    ),
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
    state_json TEXT NOT NULL CHECK (
      json_valid(state_json) AND length(CAST(state_json AS BLOB)) <= 65536
    ),
    classified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (run_id, public_product_id),
    FOREIGN KEY (run_id, public_product_id)
      REFERENCES supplier_sync_stage_classification_state(run_id, public_product_id)
      ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_sync_stage_intelligence_review
    ON supplier_sync_stage_intelligence_state
      (run_id, review_required, knowledge_state, domain_id)`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_sync_stage_intelligence_research
    ON supplier_sync_stage_intelligence_state
      (run_id, research_required, knowledge_state, domain_id)`,

  `CREATE TABLE IF NOT EXISTS supplier_sync_stage_catalog_meta (
    run_id TEXT NOT NULL,
    key TEXT NOT NULL CHECK (key IN ('classification','normalization','navigation','merchandising')),
    value_json TEXT NOT NULL CHECK (
      json_valid(value_json) AND length(CAST(value_json AS BLOB)) <= 262144
    ),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (run_id, key),
    FOREIGN KEY (run_id) REFERENCES supplier_sync_stage_runs(run_id) ON DELETE CASCADE
  )`
];

export const TENANT_DATA_PLANE_CURRENT_STATEMENTS = [
  ...V5_STATEMENTS,
  ...TENANT_DATA_PLANE_V6_STATEMENTS
];

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
  currentVersion = 0,
  targetVersion = TENANT_DATA_PLANE_SCHEMA_VERSION
}) {
  const from = Number(currentVersion);
  const target = Number(targetVersion);
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(target) ||
    from < 0 ||
    target < 1 ||
    target > TENANT_DATA_PLANE_SCHEMA_VERSION ||
    from > target
  ) {
    throw new Error('tenant_data_plane_migration_range_invalid');
  }
  if (from === target) return [];

  const batches = [];
  if (from < 5) {
    batches.push(
      ...tenantDataPlaneV5MigrationBatches({
        tenantId,
        source,
        currentVersion: from,
        targetVersion: Math.min(target, 5)
      })
    );
  }
  if (target === TENANT_DATA_PLANE_SCHEMA_VERSION && from < TENANT_DATA_PLANE_SCHEMA_VERSION) {
    batches.push([
      ...TENANT_DATA_PLANE_V6_STATEMENTS.map((sql) => ({ sql, params: [] })),
      ...schemaVersionCompletionBatch(tenantId, TENANT_DATA_PLANE_SCHEMA_VERSION)
    ]);
  }
  return batches;
}

export function tenantDataPlaneCurrentBatch({ tenantId, source }) {
  const batch = tenantDataPlaneV5Batch({ tenantId, source });
  batch.push(...TENANT_DATA_PLANE_V6_STATEMENTS.map((sql) => ({ sql, params: [] })));
  batch.push(...schemaVersionCompletionBatch(tenantId, TENANT_DATA_PLANE_SCHEMA_VERSION));
  return batch;
}
