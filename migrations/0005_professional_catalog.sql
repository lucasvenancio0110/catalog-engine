ALTER TABLE catalog_products ADD COLUMN source_name TEXT;
ALTER TABLE catalog_products ADD COLUMN display_name TEXT;
ALTER TABLE catalog_products ADD COLUMN source_category_name TEXT;
ALTER TABLE catalog_products ADD COLUMN display_category_name TEXT;
ALTER TABLE catalog_products ADD COLUMN team_id TEXT;
ALTER TABLE catalog_products ADD COLUMN league_id TEXT;
ALTER TABLE catalog_products ADD COLUMN classification_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE catalog_products ADD COLUMN classification_confidence REAL NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_catalog_products_team ON catalog_products (team_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_catalog_products_league ON catalog_products (league_id, sort_order);

CREATE TABLE IF NOT EXISTS catalog_leagues (
  league_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  country_code TEXT NOT NULL,
  country_name TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT 'club',
  logo_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  product_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_catalog_leagues_country ON catalog_leagues (country_code, sort_order);

CREATE TABLE IF NOT EXISTS catalog_teams (
  team_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  league_id TEXT,
  country_code TEXT,
  entity_type TEXT NOT NULL DEFAULT 'club',
  logo_url TEXT,
  initials TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  product_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_catalog_teams_league ON catalog_teams (league_id, sort_order);

CREATE TABLE IF NOT EXISTS catalog_facets (
  facet_id TEXT PRIMARY KEY,
  facet_type TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  product_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS catalog_product_facets (
  product_id TEXT NOT NULL,
  facet_id TEXT NOT NULL,
  PRIMARY KEY (product_id, facet_id),
  FOREIGN KEY (product_id) REFERENCES catalog_products(product_id) ON DELETE CASCADE,
  FOREIGN KEY (facet_id) REFERENCES catalog_facets(facet_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_catalog_product_facets_facet ON catalog_product_facets (facet_id, product_id);
