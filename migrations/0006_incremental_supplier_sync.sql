CREATE TABLE IF NOT EXISTS catalog_tenants (
  tenant_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'disabled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO catalog_tenants (tenant_id, slug, display_name, status)
VALUES ('t_00000000000000000001', 'catalog-engine-default', 'Catalog Engine Default', 'active');

CREATE TABLE IF NOT EXISTS supplier_sources (
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
  PRIMARY KEY (tenant_id, source_key),
  FOREIGN KEY (tenant_id) REFERENCES catalog_tenants(tenant_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS supplier_album_index (
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
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, source_key, album_source_id),
  FOREIGN KEY (tenant_id, source_key) REFERENCES supplier_sources(tenant_id, source_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_supplier_album_index_product
  ON supplier_album_index (tenant_id, public_product_id);
CREATE INDEX IF NOT EXISTS idx_supplier_album_index_status
  ON supplier_album_index (tenant_id, source_key, status, miss_count);
CREATE INDEX IF NOT EXISTS idx_supplier_album_index_fingerprint
  ON supplier_album_index (tenant_id, source_key, listing_fingerprint);

CREATE TABLE IF NOT EXISTS supplier_sync_runs (
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
);

CREATE INDEX IF NOT EXISTS idx_supplier_sync_runs_source
  ON supplier_sync_runs (tenant_id, source_key, started_at DESC);

CREATE TABLE IF NOT EXISTS supplier_sync_events (
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
);

CREATE INDEX IF NOT EXISTS idx_supplier_sync_events_run
  ON supplier_sync_events (run_id, event_type);
