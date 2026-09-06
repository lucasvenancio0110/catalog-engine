CREATE TABLE IF NOT EXISTS tenant_runtime_scheduler_state (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  stage TEXT NOT NULL CHECK (stage IN (
    'never',
    'entered',
    'configured',
    'discovered',
    'selected',
    'completed',
    'failed',
    'disabled'
  )),
  discovered_count INTEGER NOT NULL DEFAULT 0 CHECK (discovered_count >= 0),
  selected_count INTEGER NOT NULL DEFAULT 0 CHECK (selected_count >= 0),
  processed_count INTEGER NOT NULL DEFAULT 0 CHECK (processed_count >= 0),
  last_error_code TEXT,
  started_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO tenant_runtime_scheduler_state (
  singleton_id,
  stage,
  discovered_count,
  selected_count,
  processed_count,
  last_error_code,
  started_at,
  updated_at
) VALUES (1, 'never', 0, 0, 0, NULL, NULL, CURRENT_TIMESTAMP);
