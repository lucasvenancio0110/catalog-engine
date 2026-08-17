CREATE TABLE IF NOT EXISTS media_sources (
  media_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'yupoo',
  source_url TEXT NOT NULL,
  referer_url TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_media_sources_active
  ON media_sources (active, media_id);
