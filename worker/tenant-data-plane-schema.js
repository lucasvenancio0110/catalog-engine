export const TENANT_DATA_PLANE_SCHEMA_VERSION = 1;

// Runtime migrations live as discrete statements so the Cloudflare D1 Query API can
// send them as an explicit batch without parsing SQL text in a Worker.
export const TENANT_DATA_PLANE_V1_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS data_plane_schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS data_plane_identity (
    tenant_id TEXT PRIMARY KEY,
    schema_version INTEGER NOT NULL DEFAULT 0 CHECK (schema_version >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS media_sources (
    media_id TEXT PRIMARY KEY,
    provider TEXT NOT NULL DEFAULT 'yupoo',
    source_url TEXT NOT NULL,
    display_source_url TEXT,
    thumbnail_source_url TEXT,
    referer_url TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_media_sources_active ON media_sources (active, media_id)`,

  `CREATE TABLE IF NOT EXISTS product_media (
    product_id TEXT NOT NULL,
    media_id TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (product_id, position),
    UNIQUE (product_id, media_id),
    FOREIGN KEY (media_id) REFERENCES media_sources(media_id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_product_media_media_id ON product_media (media_id)`,

  `CREATE TABLE IF NOT EXISTS catalog_categories (
    category_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT,
    depth INTEGER NOT NULL DEFAULT 0 CHECK (depth >= 0),
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    product_count INTEGER NOT NULL DEFAULT 0 CHECK (product_count >= 0),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_catalog_categories_parent ON catalog_categories (parent_id, sort_order)`,

  `CREATE TABLE IF NOT EXISTS catalog_products (
    product_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    search_text TEXT NOT NULL,
    category_id TEXT NOT NULL,
    category_name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    image_count INTEGER NOT NULL DEFAULT 0 CHECK (image_count >= 0),
    primary_media_id TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    source_name TEXT,
    display_name TEXT,
    source_category_name TEXT,
    display_category_name TEXT,
    team_id TEXT,
    league_id TEXT,
    classification_status TEXT NOT NULL DEFAULT 'unknown',
    classification_confidence REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_catalog_products_sort ON catalog_products (sort_order, product_id)`,
  `CREATE INDEX IF NOT EXISTS idx_catalog_products_category ON catalog_products (category_id, sort_order)`,
  `CREATE INDEX IF NOT EXISTS idx_catalog_products_search ON catalog_products (search_text)`,
  `CREATE INDEX IF NOT EXISTS idx_catalog_products_team ON catalog_products (team_id, sort_order)`,
  `CREATE INDEX IF NOT EXISTS idx_catalog_products_league ON catalog_products (league_id, sort_order)`,

  `CREATE TABLE IF NOT EXISTS catalog_product_categories (
    product_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    PRIMARY KEY (product_id, category_id),
    FOREIGN KEY (product_id) REFERENCES catalog_products(product_id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES catalog_categories(category_id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_catalog_product_categories_category ON catalog_product_categories (category_id, product_id)`,

  `CREATE TABLE IF NOT EXISTS catalog_meta (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS catalog_leagues (
    league_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    country_code TEXT NOT NULL,
    country_name TEXT NOT NULL,
    entity_type TEXT NOT NULL DEFAULT 'club',
    logo_url TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    product_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_catalog_leagues_country ON catalog_leagues (country_code, sort_order)`,

  `CREATE TABLE IF NOT EXISTS catalog_teams (
    team_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    short_name TEXT NOT NULL,
    league_id TEXT,
    country_code TEXT,
    entity_type TEXT NOT NULL DEFAULT 'club',
    logo_url TEXT,
    initials TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    product_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_catalog_teams_league ON catalog_teams (league_id, sort_order)`,

  `CREATE TABLE IF NOT EXISTS catalog_facets (
    facet_id TEXT PRIMARY KEY,
    facet_type TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    product_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS catalog_product_facets (
    product_id TEXT NOT NULL,
    facet_id TEXT NOT NULL,
    PRIMARY KEY (product_id, facet_id),
    FOREIGN KEY (product_id) REFERENCES catalog_products(product_id) ON DELETE CASCADE,
    FOREIGN KEY (facet_id) REFERENCES catalog_facets(facet_id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_catalog_product_facets_facet ON catalog_product_facets (facet_id, product_id)`,

  `CREATE TABLE IF NOT EXISTS supplier_sources (
    tenant_id TEXT NOT NULL,
    source_key TEXT NOT NULL,
    provider TEXT NOT NULL,
    source_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'error', 'disabled')),
    sync_strategy TEXT NOT NULL DEFAULT 'incremental' CHECK (sync_strategy IN ('incremental', 'full')),
    removal_miss_threshold INTEGER NOT NULL DEFAULT 3 CHECK (removal_miss_threshold >= 2),
    last_scan_at TEXT,
    last_success_at TEXT,
    last_full_reconcile_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, source_key)
  )`,

  `CREATE TABLE IF NOT EXISTS supplier_album_index (
    tenant_id TEXT NOT NULL,
    source_key TEXT NOT NULL,
    album_source_id TEXT NOT NULL,
    public_product_id TEXT NOT NULL,
    source_url TEXT NOT NULL,
    source_title TEXT NOT NULL DEFAULT '',
    source_category_id TEXT,
    source_category_path_json TEXT NOT NULL DEFAULT '[]',
    cover_source_url TEXT,
    image_count_hint INTEGER,
    listing_fingerprint TEXT NOT NULL,
    detail_fingerprint TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'missing', 'deleted')),
    miss_count INTEGER NOT NULL DEFAULT 0 CHECK (miss_count >= 0),
    first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_detail_at TEXT,
    detail_retry_count INTEGER NOT NULL DEFAULT 0,
    detail_retry_after TEXT,
    detail_last_error TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, source_key, album_source_id),
    FOREIGN KEY (tenant_id, source_key) REFERENCES supplier_sources(tenant_id, source_key) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_album_index_product ON supplier_album_index (tenant_id, public_product_id)`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_album_index_status ON supplier_album_index (tenant_id, source_key, status, miss_count)`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_album_index_fingerprint ON supplier_album_index (tenant_id, source_key, listing_fingerprint)`,

  `CREATE TABLE IF NOT EXISTS supplier_sync_runs (
    run_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    source_key TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('incremental', 'full_reconcile')),
    status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
    complete_scan INTEGER NOT NULL DEFAULT 0 CHECK (complete_scan IN (0, 1)),
    scanned_albums INTEGER NOT NULL DEFAULT 0,
    new_count INTEGER NOT NULL DEFAULT 0,
    changed_count INTEGER NOT NULL DEFAULT 0,
    moved_count INTEGER NOT NULL DEFAULT 0,
    restored_count INTEGER NOT NULL DEFAULT 0,
    missing_count INTEGER NOT NULL DEFAULT 0,
    removed_count INTEGER NOT NULL DEFAULT 0,
    detail_fetch_count INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TEXT,
    error_text TEXT,
    FOREIGN KEY (tenant_id, source_key) REFERENCES supplier_sources(tenant_id, source_key) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_sync_runs_source ON supplier_sync_runs (tenant_id, source_key, started_at DESC)`,

  `CREATE TABLE IF NOT EXISTS supplier_sync_events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    source_key TEXT NOT NULL,
    album_source_id TEXT NOT NULL,
    public_product_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('NEW', 'CHANGED', 'CHANGED_MOVED', 'MOVED', 'RESTORED', 'MISSING', 'REMOVED', 'BASELINE')),
    needs_detail INTEGER NOT NULL DEFAULT 0 CHECK (needs_detail IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (run_id) REFERENCES supplier_sync_runs(run_id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_sync_events_run ON supplier_sync_events (run_id, event_type)`
];

export function tenantDataPlaneV1Batch({ tenantId, source }) {
  if (!/^t_[a-f0-9]{20}$/.test(String(tenantId || ''))) throw new Error('invalid_tenant_id');
  if (!source || source.provider !== 'yupoo' || !source.sourceKey || !source.sourceUrl) {
    throw new Error('tenant_source_required');
  }

  const batch = TENANT_DATA_PLANE_V1_STATEMENTS.map((sql) => ({ sql, params: [] }));
  batch.push({
    sql: `INSERT INTO data_plane_identity (tenant_id, schema_version, updated_at)
          VALUES (?1, ?2, CURRENT_TIMESTAMP)
          ON CONFLICT(tenant_id) DO UPDATE SET schema_version=excluded.schema_version, updated_at=CURRENT_TIMESTAMP`,
    params: [tenantId, TENANT_DATA_PLANE_SCHEMA_VERSION]
  });
  batch.push({
    sql: `INSERT INTO supplier_sources
          (tenant_id, source_key, provider, source_url, status, sync_strategy, removal_miss_threshold, updated_at)
          VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?6, CURRENT_TIMESTAMP)
          ON CONFLICT(tenant_id, source_key) DO UPDATE SET
            provider=excluded.provider,
            source_url=excluded.source_url,
            status='active',
            sync_strategy=excluded.sync_strategy,
            removal_miss_threshold=excluded.removal_miss_threshold,
            last_error=NULL,
            updated_at=CURRENT_TIMESTAMP`,
    params: [
      tenantId,
      source.sourceKey,
      source.provider,
      source.sourceUrl,
      source.syncStrategy || 'incremental',
      Number(source.removalMissThreshold || 3)
    ]
  });
  batch.push({
    sql: `INSERT OR IGNORE INTO data_plane_schema_migrations (version, applied_at)
          VALUES (?1, CURRENT_TIMESTAMP)`,
    params: [TENANT_DATA_PLANE_SCHEMA_VERSION]
  });
  return batch;
}
