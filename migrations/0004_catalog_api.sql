CREATE TABLE IF NOT EXISTS catalog_categories (
  category_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT,
  depth INTEGER NOT NULL DEFAULT 0 CHECK (depth >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  product_count INTEGER NOT NULL DEFAULT 0 CHECK (product_count >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_catalog_categories_parent
  ON catalog_categories (parent_id, sort_order);

CREATE TABLE IF NOT EXISTS catalog_products (
  product_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  search_text TEXT NOT NULL,
  category_id TEXT NOT NULL,
  category_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_count INTEGER NOT NULL DEFAULT 0 CHECK (image_count >= 0),
  primary_media_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_catalog_products_sort
  ON catalog_products (sort_order, product_id);

CREATE INDEX IF NOT EXISTS idx_catalog_products_category
  ON catalog_products (category_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_catalog_products_search
  ON catalog_products (search_text);

CREATE TABLE IF NOT EXISTS catalog_product_categories (
  product_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  PRIMARY KEY (product_id, category_id),
  FOREIGN KEY (product_id) REFERENCES catalog_products(product_id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES catalog_categories(category_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_catalog_product_categories_category
  ON catalog_product_categories (category_id, product_id);

CREATE TABLE IF NOT EXISTS catalog_meta (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
