-- Low-volume orchestration state for isolated tenant imports.
-- Per-album/source detail state belongs in the tenant D1, never in this control-plane table.

CREATE TABLE IF NOT EXISTS tenant_import_jobs (
  import_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  source_key TEXT NOT NULL DEFAULT 'primary',
  mode TEXT NOT NULL DEFAULT 'initial' CHECK (mode IN ('initial', 'incremental', 'recovery')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'scanning', 'details', 'finalizing', 'success', 'failed', 'cancelled')),
  phase TEXT NOT NULL DEFAULT 'scan' CHECK (phase IN ('scan', 'details', 'finalize', 'complete')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  discovered_count INTEGER NOT NULL DEFAULT 0 CHECK (discovered_count >= 0),
  queued_detail_count INTEGER NOT NULL DEFAULT 0 CHECK (queued_detail_count >= 0),
  completed_detail_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_detail_count >= 0),
  failed_detail_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_detail_count >= 0),
  deferred_detail_count INTEGER NOT NULL DEFAULT 0 CHECK (deferred_detail_count >= 0),
  published_product_count INTEGER NOT NULL DEFAULT 0 CHECK (published_product_count >= 0),
  classified_automatic_count INTEGER NOT NULL DEFAULT 0 CHECK (classified_automatic_count >= 0),
  classified_review_count INTEGER NOT NULL DEFAULT 0 CHECK (classified_review_count >= 0),
  classified_unknown_count INTEGER NOT NULL DEFAULT 0 CHECK (classified_unknown_count >= 0),
  next_attempt_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES catalog_tenants(tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, source_key) REFERENCES supplier_sources(tenant_id, source_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_import_jobs_tenant
  ON tenant_import_jobs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenant_import_jobs_due
  ON tenant_import_jobs (status, next_attempt_at, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_import_jobs_one_active
  ON tenant_import_jobs (tenant_id, source_key)
  WHERE status IN ('pending', 'queued', 'scanning', 'details', 'finalizing');
