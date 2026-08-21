-- Low-volume control-plane schedule state for recurring tenant synchronization.
-- High-cardinality sync/index/event state remains inside each tenant data plane.

CREATE TABLE IF NOT EXISTS tenant_sync_schedules (
  tenant_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'disabled')),
  incremental_interval_minutes INTEGER NOT NULL DEFAULT 360
    CHECK (incremental_interval_minutes BETWEEN 15 AND 10080),
  next_sync_at TEXT NOT NULL,
  last_scheduled_at TEXT,
  last_import_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, source_key),
  FOREIGN KEY (tenant_id, source_key) REFERENCES supplier_sources(tenant_id, source_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_sync_schedules_due
  ON tenant_sync_schedules (status, next_sync_at, tenant_id, source_key);
