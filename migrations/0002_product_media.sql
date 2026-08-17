CREATE TABLE IF NOT EXISTS product_media (
  product_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (product_id, position),
  UNIQUE (product_id, media_id),
  FOREIGN KEY (media_id) REFERENCES media_sources(media_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_product_media_media_id
  ON product_media (media_id);
