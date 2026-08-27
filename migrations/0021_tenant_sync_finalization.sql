-- M7D8 control-plane state for promotion-before-cursor finalization.
-- The scheduled slot is copied onto the incremental import job so the final control commit
-- can compare-and-set the exact schedule row that created the run.

ALTER TABLE tenant_import_jobs ADD COLUMN sync_scheduled_for TEXT;
ALTER TABLE tenant_import_jobs ADD COLUMN finalize_lease_until TEXT;

CREATE INDEX IF NOT EXISTS idx_tenant_import_jobs_incremental_finalize
  ON tenant_import_jobs (mode, status, phase, finalize_lease_until, updated_at)
  WHERE mode='incremental' AND status='finalizing' AND phase='finalize';
