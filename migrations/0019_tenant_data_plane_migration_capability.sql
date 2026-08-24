-- Gate additive tenant schema maintenance on a trusted-CI prepared User Worker.
-- The marker is promoted only after the Workers for Platforms upload succeeds;
-- existing verified storefront/runtime state remains authoritative while it is pending.

ALTER TABLE tenant_data_plane_provider_state
  ADD COLUMN migration_command_version INTEGER NOT NULL DEFAULT 0
    CHECK (migration_command_version >= 0);

ALTER TABLE tenant_data_plane_provider_state
  ADD COLUMN migration_command_prepared_at TEXT;

ALTER TABLE tenant_data_plane_provider_state
  ADD COLUMN migration_command_last_error_code TEXT;

CREATE INDEX IF NOT EXISTS idx_tenant_data_plane_migration_capability
  ON tenant_data_plane_provider_state
    (migration_command_version, worker_status, database_status, updated_at);
