-- Distinguish onboarding schema work from additive maintenance upgrades for already-ready tenant data planes.
-- Existing rows predate this distinction and therefore default to provisioning semantics.

ALTER TABLE tenant_data_plane_migration_jobs
  ADD COLUMN migration_kind TEXT NOT NULL DEFAULT 'provisioning'
  CHECK (migration_kind IN ('provisioning', 'maintenance'));

CREATE INDEX IF NOT EXISTS idx_tenant_data_plane_migration_jobs_kind_due
  ON tenant_data_plane_migration_jobs (migration_kind, status, next_attempt_at, created_at);
