import PQueue from 'p-queue';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { publicCategoryId, publicProductId } from './catalog-sync.mjs';
import { buildUsedPublicTaxonomy, categoryPathFor } from './full-import-core.mjs';
import { fetchYupooAlbumDetail, mediaId } from './yupoo-detail-core.mjs';
import { sqlString } from './incremental-sync-core.mjs';

const provider = 'yupoo';
const catalogPath = process.env.CATALOG_PATH || 'data/catalog.json';
const currentIndexPath = process.env.SUPPLIER_INDEX_OUT || '/tmp/catalog-engine-current-index.json';
const deltaPath = process.env.SUPPLIER_DELTA_OUT || '/tmp/catalog-engine-delta.json';
const mediaSqlDir = process.env.SUPPLIER_MEDIA_SQL_DIR || '/tmp/catalog-engine-delta-media-sql';
const summaryPath = process.env.SUPPLIER_PROCESS_SUMMARY_OUT || '/tmp/catalog-engine-incremental-summary.json';
const chunkStatements = Math.max(200, Number(process.env.SUPPLIER_MEDIA_SQL_CHUNK_STATEMENTS || 800));

async function writeSqlChunks(statements) {
  await rm(mediaSqlDir, { recursive: true, force: true });
  await mkdir(mediaSqlDir, { recursive: true });
  const files = [];
  if (!statements.length) {
    const path = resolve(mediaSqlDir, '0001.sql');
    await writeFile(path, 'SELECT 1;\n', 'utf8');
    return [path];
  }
  for (let index = 0; index < statements.length; index += chunkStatements) {
    const path = resolve(mediaSqlDir, `${String(files.length + 1).padStart(4, '0')}.sql`);
    await writeFile(path, `PRAGMA foreign_keys = ON;\n${statements.slice(index, index + chunkStatements).join('\n')}\n`, 'utf8');
    files.push(path);
  }
  return files;
}

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const current = JSON.parse(await readFile(currentIndexPath, 'utf8'));
const delta = JSON.parse(await readFile(deltaPath, 'utf8'));
if (!current.complete || !delta.complete) throw new Error('Processamento incremental exige scan completo.');

const uncategorizedSourceId = '__catalog_engine_uncategorized__';
const taxonomyInput = [...(current.taxonomy || [])];
if (!taxonomyInput.some((category) => String(category.id) === uncategorizedSourceId)) {
  taxonomyInput.push({ id: uncategorizedSourceId, name: 'Outros', parentId: null, childIds: [], depth: 0 });
}
const allCurrentSourceCategoryIds = [...new Set(current.albums.map((entry) => entry.categoryId || uncategorizedSourceId).map(String))];
const currentPublicTaxonomy = buildUsedPublicTaxonomy({ provider, rawTaxonomy: taxonomyInput, usedSourceCategoryIds: allCurrentSourceCategoryIds });
const rawById = currentPublicTaxonomy.rawById;
const albumBySourceId = new Map(current.albums.map((entry) => [String(entry.sourceId), entry]));
const productById = new Map((catalog.products || []).map((product) => [product.id, product]));
const originalOrder = (catalog.products || []).map((product) => product.id);
const newProductIds = [];
const mediaStatements = [];
const detailEvents = delta.events.filter((event) => event.needsDetail && event.current);
const queue = new PQueue({ concurrency: 6, intervalCap: 9, interval: 1000, timeout: 180_000 });
const detailResults = new Map();
let detailFailures = 0;

await Promise.all(detailEvents.map((event) => queue.add(async () => {
  try {
    const detail = await fetchYupooAlbumDetail(event.current.sourceUrl, delta.sourceUrl);
    detailResults.set(String(event.sourceId), detail);
  } catch (error) {
    detailFailures += 1;
    console.warn(`Falha no detalhe do álbum ${event.sourceId}: ${error?.message || error}`);
  }
})));
if (detailFailures > 0) throw new Error(`Sync incremental abortado: ${detailFailures} detalhe(s) falharam. O índice não deve avançar.`);

function categoryFields(entry) {
  const sourceCategoryId = entry?.categoryId ? String(entry.categoryId) : uncategorizedSourceId;
  const sourceCategory = rawById.get(sourceCategoryId);
  return {
    categoryId: publicCategoryId(provider, sourceCategoryId),
    category: sourceCategory?.name || 'Outros',
    categoryPathIds: categoryPathFor(sourceCategoryId, rawById, provider)
  };
}

function mediaDescriptors(publicId, albumUrl, images) {
  mediaStatements.push(`DELETE FROM product_media WHERE product_id=${sqlString(publicId)};`);
  return images.map((sourceImage, position) => {
    const id = mediaId(sourceImage.sourceUrl);
    mediaStatements.push(`INSERT INTO media_sources (media_id, provider, source_url, display_source_url, thumbnail_source_url, referer_url, active, updated_at) VALUES (${sqlString(id)}, ${sqlString(provider)}, ${sqlString(sourceImage.sourceUrl)}, ${sqlString(sourceImage.displaySourceUrl)}, ${sqlString(sourceImage.thumbnailSourceUrl)}, ${sqlString(albumUrl)}, 1, CURRENT_TIMESTAMP) ON CONFLICT(media_id) DO UPDATE SET provider=excluded.provider, source_url=excluded.source_url, display_source_url=excluded.display_source_url, thumbnail_source_url=excluded.thumbnail_source_url, referer_url=excluded.referer_url, active=1, updated_at=CURRENT_TIMESTAMP;`);
    mediaStatements.push(`INSERT INTO product_media (product_id, media_id, position, updated_at) VALUES (${sqlString(publicId)}, ${sqlString(id)}, ${position}, CURRENT_TIMESTAMP) ON CONFLICT(product_id, position) DO UPDATE SET media_id=excluded.media_id, updated_at=CURRENT_TIMESTAMP;`);
    return { id, url: `/media/${id}/view`, thumbnailUrl: `/media/${id}/thumb`, downloadUrl: `/media/${id}`, storage: 'edge-proxy' };
  });
}

const processing = { created: 0, updated: 0, moved: 0, removed: 0, skippedNonProduct: 0, baseline: delta.summary.BASELINE || 0 };
for (const event of delta.events) {
  const sourceId = String(event.sourceId);
  const publicId = publicProductId(provider, sourceId);
  if (event.type === 'BASELINE' || event.type === 'MISSING') continue;

  if (event.type === 'REMOVED') {
    if (productById.delete(publicId)) processing.removed += 1;
    mediaStatements.push(`DELETE FROM product_media WHERE product_id=${sqlString(publicId)};`);
    continue;
  }

  const entry = albumBySourceId.get(sourceId) || event.current;
  if (!entry) continue;
  const fields = categoryFields(entry);

  if (event.type === 'MOVED') {
    const previous = productById.get(publicId);
    if (!previous) continue;
    productById.set(publicId, { ...previous, category: fields.category, categoryId: fields.categoryId, categoryPathIds: fields.categoryPathIds });
    processing.moved += 1;
    continue;
  }

  const detail = detailResults.get(sourceId);
  if (!detail) throw new Error(`Detalhe ausente para evento ${event.type} do álbum ${sourceId}.`);
  if (detail.classification.entityType !== 'product') {
    if (productById.delete(publicId)) processing.removed += 1;
    mediaStatements.push(`DELETE FROM product_media WHERE product_id=${sqlString(publicId)};`);
    processing.skippedNonProduct += 1;
    continue;
  }
  if (!detail.name || !detail.images.length) throw new Error(`Álbum ${sourceId} ficou sem mídia válida; produto saudável anterior não será sobrescrito.`);

  const media = mediaDescriptors(publicId, entry.sourceUrl, detail.images);
  const product = {
    id: publicId,
    name: detail.name,
    category: fields.category,
    categoryId: fields.categoryId,
    categoryPathIds: fields.categoryPathIds,
    description: detail.description,
    images: media.map((item) => item.url),
    media,
    imageCount: media.length,
    entityType: 'product'
  };
  const existed = productById.has(publicId);
  productById.set(publicId, product);
  if (!existed) {
    newProductIds.push(publicId);
    processing.created += 1;
  } else {
    processing.updated += 1;
  }
  mediaStatements.push(`UPDATE supplier_album_index SET detail_fingerprint=${sqlString(detail.detailFingerprint)}, last_detail_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE tenant_id=${sqlString(delta.tenantId)} AND source_key=${sqlString(delta.sourceKey)} AND album_source_id=${sqlString(sourceId)};`);
}
if (mediaStatements.length) mediaStatements.push(`DELETE FROM media_sources WHERE provider=${sqlString(provider)} AND media_id NOT IN (SELECT media_id FROM product_media);`);

const catalogChanged = delta.events.some((event) => !['BASELINE', 'MISSING'].includes(event.type));
let finalProductCount = productById.size;
let finalTaxonomyCount = (catalog.taxonomy || []).length;

if (catalogChanged) {
  const finalOrder = [...newProductIds, ...originalOrder.filter((id) => !newProductIds.includes(id)), ...[...productById.keys()].filter((id) => !originalOrder.includes(id) && !newProductIds.includes(id))];
  const products = finalOrder.map((id) => productById.get(id)).filter(Boolean);
  const mergedTaxonomyById = new Map((catalog.taxonomy || []).map((category) => [category.id, { ...category }]));
  for (const category of currentPublicTaxonomy.taxonomy) mergedTaxonomyById.set(category.id, { ...category });
  const usedCategoryIds = new Set(products.flatMap((product) => product.categoryPathIds || []));
  const taxonomy = [...mergedTaxonomyById.values()].filter((category) => usedCategoryIds.has(category.id));
  const finalTaxonomyById = new Map(taxonomy.map((category) => [category.id, { ...category, childIds: [] }]));
  for (const category of finalTaxonomyById.values()) {
    if (!category.parentId) continue;
    const parent = finalTaxonomyById.get(category.parentId);
    if (parent && !parent.childIds.includes(category.id)) parent.childIds.push(category.id);
  }
  const finalTaxonomy = [...finalTaxonomyById.values()].map((category) => ({ ...category, childIds: [...category.childIds].sort() })).sort((a, b) => (a.depth || 0) - (b.depth || 0) || a.name.localeCompare(b.name));
  const photos = products.reduce((sum, product) => sum + Number(product.imageCount || product.media?.length || 0), 0);
  const nextCatalog = {
    ...catalog,
    generatedAt: new Date().toISOString(),
    taxonomy: finalTaxonomy,
    taxonomyStats: {
      total: finalTaxonomy.length,
      roots: finalTaxonomy.filter((category) => !category.parentId).length,
      nested: finalTaxonomy.filter((category) => category.parentId).length,
      maxDepth: finalTaxonomy.reduce((max, category) => Math.max(max, category.depth || 0), 0),
      used: usedCategoryIds.size
    },
    stats: { ...(catalog.stats || {}), products: products.length, photos },
    sync: {
      mode: 'incremental',
      tenantId: delta.tenantId,
      sourceKey: delta.sourceKey,
      runId: delta.runId,
      completedAt: new Date().toISOString(),
      scannedAlbums: delta.scan?.albums || current.albums.length,
      detailFetches: detailEvents.length,
      summary: delta.summary,
      processing
    },
    products
  };
  const serialized = `${JSON.stringify(nextCatalog, null, 2)}\n`;
  if (/x\.yupoo\.com|photo\.yupoo\.com/i.test(serialized)) throw new Error('White-label gate: hostname do fornecedor apareceu no catálogo público.');
  if (serialized.includes(delta.sourceUrl)) throw new Error('White-label gate: URL da fonte apareceu no catálogo público.');
  await writeFile(catalogPath, serialized, 'utf8');
  finalProductCount = products.length;
  finalTaxonomyCount = finalTaxonomy.length;
}

const sqlFiles = await writeSqlChunks(mediaStatements);
const summary = { ok: true, runId: delta.runId, catalogChanged, products: finalProductCount, taxonomy: finalTaxonomyCount, detailFetches: detailEvents.length, mediaSqlChunks: sqlFiles.length, ...processing };
await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(summary, null, 2));
