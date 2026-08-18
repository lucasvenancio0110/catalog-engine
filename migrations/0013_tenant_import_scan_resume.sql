-- Resume-safe listing scan -> detail fan-out cursor for large initial imports.

ALTER TABLE tenant_import_jobs ADD COLUMN detail_enqueue_cursor INTEGER NOT NULL DEFAULT 0 CHECK (detail_enqueue_cursor >= 0);
ALTER TABLE tenant_import_jobs ADD COLUMN scan_completed_at TEXT;
