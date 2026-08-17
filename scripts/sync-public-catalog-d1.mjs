import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  FACETS,
  LEAGUES,
  TEAMS,
  normalizeCatalogProduct,
  professionalNavigationDefinition
} from '../src/domain/catalog-normalization.js';

const catalogPath = process.env.CATALOG_PATH || 'data/catalog.json';
const sqlDir = process.env.PUBLIC_CATALOG_SQL_DIR || '/tmp/catalog-engine-public-api-sql';
const chunkStatements = Math.max(250, Number(process.env.PUBLIC_CATALOG_SQL_CHUNK_STATEMENTS || 900));

function sqlString(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function writeSqlChunks(statements) {
  await rm(sqlDir, { recursive: true, force: true });
  await mkdir(sqlDir, { recursive: true });
  const files = [];
  for (let index = 0; index < statements.length; index += chunkStatements) {
    const chunk = statements.slice(index, index + chunkStatements);
    const path = resolve(sqlDir, `${String(files.length + 1).padStart(4, '0')}.sql`);
    await writeFile(path, `PRAGMA foreign_keys = ON;\n${chunk.join('\n')}\n`, 'utf8');
    files.push(path);
  }
  return files;
}

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const products = Array.isArray(catalog.products) ? catalog.products : [];
const taxonomy = Array.isArray(catalog.taxonomy) ? catalog.taxonomy : [];
if (!products.length) throw new Error('O catálogo público não possui produtos para sincronizar no D1.');
if (!taxonomy.length) throw new Error('O catálogo público não possui taxonomia para sincronizar no D1.');

const categoryNameById = new Map(taxonomy.map((category) => [category.id, category.name]));
const productCountByCategory = new Map();
const leagueCounts = new Map();
const teamCounts = new Map();
const facetCounts = new Map();
const normalizedProducts = [];

for (const product of products) {
  const categoryIds = [...new Set(product.categoryPathIds || [])];
  for (const categoryId of categoryIds) productCountByCategory.set(categoryId, (productCountByCategory.get(categoryId) || 0) + 1);
  const categoryPathNames = categoryIds.map((categoryId) => categoryNameById.get(categoryId)).filter(Boolean);
  const normalized = normalizeCatalogProduct(product, categoryPathNames);
  normalizedProducts.push({ product, normalized, categoryIds });
  if (normalized.league?.id) leagueCounts.set(normalized.league.id, (leagueCounts.get(normalized.league.id) || 0) + 1);
  if (normalized.team?.id) teamCounts.set(normalized.team.id, (teamCounts.get(normalized.team.id) || 0) + 1);
  for (const facet of normalized.facets) facetCounts.set(facet.id, (facetCounts.get(facet.id) || 0) + 1);
}

const statements = [
  'DELETE FROM catalog_product_facets;',
  'DELETE FROM catalog_facets;',
  'DELETE FROM catalog_teams;',
  'DELETE FROM catalog_leagues;',
  'DELETE FROM catalog_product_categories;',
  'DELETE FROM catalog_products;',
  'DELETE FROM catalog_categories;',
  'DELETE FROM catalog_meta;'
];

for (const [index, category] of taxonomy.entries()) {
  statements.push(`INSERT INTO catalog_categories (category_id, name, parent_id, depth, sort_order, product_count, updated_at) VALUES (${sqlString(category.id)}, ${sqlString(category.name)}, ${sqlString(category.parentId)}, ${Math.max(0, Number(category.depth || 0))}, ${index}, ${productCountByCategory.get(category.id) || 0}, CURRENT_TIMESTAMP);`);
}

for (const league of LEAGUES.filter((entry) => (leagueCounts.get(entry.id) || 0) > 0)) {
  statements.push(`INSERT INTO catalog_leagues (league_id, name, country_code, country_name, entity_type, logo_url, sort_order, product_count, updated_at) VALUES (${sqlString(league.id)}, ${sqlString(league.name)}, ${sqlString(league.countryCode)}, ${sqlString(league.countryName)}, ${sqlString(league.entityType)}, NULL, ${league.sortOrder || 0}, ${leagueCounts.get(league.id) || 0}, CURRENT_TIMESTAMP);`);
}

for (const team of TEAMS.filter((entry) => (teamCounts.get(entry.id) || 0) > 0)) {
  statements.push(`INSERT INTO catalog_teams (team_id, name, short_name, league_id, country_code, entity_type, logo_url, initials, sort_order, product_count, updated_at) VALUES (${sqlString(team.id)}, ${sqlString(team.name)}, ${sqlString(team.shortName)}, ${sqlString(team.leagueId)}, ${sqlString(team.countryCode)}, ${sqlString(team.entityType)}, ${sqlString(team.logoUrl)}, ${sqlString(team.initials)}, ${team.sortOrder || 0}, ${teamCounts.get(team.id) || 0}, CURRENT_TIMESTAMP);`);
}

for (const facet of FACETS.filter((entry) => (facetCounts.get(entry.id) || 0) > 0)) {
  statements.push(`INSERT INTO catalog_facets (facet_id, facet_type, name, sort_order, product_count, updated_at) VALUES (${sqlString(facet.id)}, ${sqlString(facet.type)}, ${sqlString(facet.name)}, ${facet.sortOrder || 0}, ${facetCounts.get(facet.id) || 0}, CURRENT_TIMESTAMP);`);
}

for (const [index, entry] of normalizedProducts.entries()) {
  const { product, normalized, categoryIds } = entry;
  const primaryMediaId = product.media?.[0]?.id || null;
  const imageCount = Math.max(0, Number(product.imageCount || product.media?.length || 0));
  statements.push(`INSERT INTO catalog_products (product_id, name, search_text, category_id, category_name, description, image_count, primary_media_id, sort_order, updated_at, source_name, display_name, source_category_name, display_category_name, team_id, league_id, classification_status, classification_confidence) VALUES (${sqlString(product.id)}, ${sqlString(normalized.displayName)}, ${sqlString(normalized.searchText)}, ${sqlString(product.categoryId)}, ${sqlString(normalized.displayCategoryName)}, ${sqlString(product.description || '')}, ${imageCount}, ${sqlString(primaryMediaId)}, ${index}, CURRENT_TIMESTAMP, ${sqlString(normalized.sourceName)}, ${sqlString(normalized.displayName)}, ${sqlString(normalized.sourceCategoryName)}, ${sqlString(normalized.displayCategoryName)}, ${sqlString(normalized.team?.id)}, ${sqlString(normalized.league?.id)}, ${sqlString(normalized.classificationStatus)}, ${normalized.classificationConfidence});`);
  for (const categoryId of categoryIds) statements.push(`INSERT INTO catalog_product_categories (product_id, category_id) VALUES (${sqlString(product.id)}, ${sqlString(categoryId)});`);
  for (const facet of normalized.facets) statements.push(`INSERT INTO catalog_product_facets (product_id, facet_id) VALUES (${sqlString(product.id)}, ${sqlString(facet.id)});`);
}

const navigation = professionalNavigationDefinition().map((entry) => ({
  ...entry,
  count: entry.facetId ? facetCounts.get(entry.facetId) || 0 :
    entry.kind === 'teams' ? [...teamCounts.entries()].filter(([id]) => TEAMS.find((team) => team.id === id)?.entityType === 'club').reduce((sum, [, count]) => sum + count, 0) :
    entry.kind === 'national_teams' ? [...teamCounts.entries()].filter(([id]) => TEAMS.find((team) => team.id === id)?.entityType === 'national_team').reduce((sum, [, count]) => sum + count, 0) : 0
})).filter((entry) => entry.kind === 'teams' || entry.kind === 'national_teams' || entry.count > 0);

const meta = {
  store: catalog.store || {},
  generatedAt: catalog.generatedAt || new Date().toISOString(),
  stats: { ...(catalog.stats || {}), products: products.length },
  storage: catalog.storage || {},
  navigation,
  normalization: {
    version: 1,
    classified: normalizedProducts.filter((entry) => entry.normalized.classificationStatus === 'automatic').length,
    needsReview: normalizedProducts.filter((entry) => entry.normalized.classificationStatus === 'needs_review').length,
    unknown: normalizedProducts.filter((entry) => entry.normalized.classificationStatus === 'unknown').length,
    leagues: leagueCounts.size,
    teams: teamCounts.size,
    facets: facetCounts.size
  }
};
for (const [key, value] of Object.entries(meta)) statements.push(`INSERT INTO catalog_meta (key, value_json, updated_at) VALUES (${sqlString(key)}, ${sqlString(JSON.stringify(value))}, CURRENT_TIMESTAMP);`);

const files = await writeSqlChunks(statements);
console.log(JSON.stringify({ ok: true, products: products.length, sourceCategories: taxonomy.length, leagues: leagueCounts.size, teams: teamCounts.size, facets: facetCounts.size, automatic: meta.normalization.classified, needsReview: meta.normalization.needsReview, unknown: meta.normalization.unknown, sqlChunks: files.length, sqlDir }, null, 2));
