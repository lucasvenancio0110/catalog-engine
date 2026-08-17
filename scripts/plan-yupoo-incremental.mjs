import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { flattenWranglerResults, planIncrementalDelta, sqlString } from './incremental-sync-core.mjs';
import { publicProductId } from './catalog-sync.mjs';

const provider = 'yupoo';
const tenantId = process.env.TENANT_ID || 't_00000000000000000001';
const sourceKey = process.env.SOURCE_KEY || 'primary';
const currentIndexPath = process.env.SUPPLIER_INDEX_OUT || '/tmp/catalog-engine-current-index.json';
const previousIndexPath = process.env.SUPPLIER_PREVIOUS_INDEX || '/tmp/catalog-engine-previous-index.json';
const catalogPath = process.env.CATALOG_PATH || 'data/catalog.json';
const deltaPath = process.env.SUPPLIER_DELTA_OUT || '/tmp/catalog-engine-delta.json';
const sqlDir = process.env.SUPPLIER_INDEX_SQL_DIR || '/tmp/catalog-engine-index-sql';
const removalMissThreshold = Math.max(2, Number(process.env.REMOVAL_MISS_THRESHOLD || 3));
const chunkStatements = Math.max(200, Number(process.env.SUPPLIER_INDEX_SQL_CHUNK_STATEMENTS || 800));

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function writeSqlChunks(statements) {
  await rm(sqlDir, { recursive: true, force: true });
  await mkdir(sqlDir, { recursive: true });
  const files = [];
  for (let index = 0; index < statements.length; index += chunkStatements) {
    const path = resolve(sqlDir, `${String(files.length + 1).padStart(4, '0')}.sql`);
    const chunk = statements.slice(index, index + chunkStatements);
    await writeFile(path, `PRAGMA foreign_keys = ON;\n${chunk.join('\n')}\n`, 'utf8');
    files.push(path);
  }
  return files;
}

const current = JSON.parse(await readFile(currentIndexPath, 'utf8'));
if (!Array.isArray(current.albums) || !current.albums.length) {
  throw new Error('O índice atual não contém álbuns observados; sync incremental abortado.');
}
const inferMissing = current.complete === true;

let previousPayload = [];
try {
  previousPayload = JSON.parse(await readFile(previousIndexPath, 'utf8'));
} catch {
  previousPayload = [];
}
const previousRows = flattenWranglerResults(previousPayload);
const previousById = new Map(previousRows.map((row) => [String(row.album_source_id || ''), row]).filter(([id]) => id));

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const existingPublicIds = new Set((catalog.products || []).map((product) => product.id));
const baseline = [];
for (const entry of current.albums) {
  if (previousById.has(String(entry.sourceId))) continue;
  const publicId = publicProductId(provider, String(entry.sourceId));
  if (!existingPublicIds.has(publicId)) continue;
  baseline.push({ ...entry, publicProductId: publicId });
  previousRows.push({
    album_source_id: String(entry.sourceId),
    public_product_id: publicId,
    source_title: entry.title || '',
    source_category_id: entry.categoryId || null,
    source_category_path_json: JSON.stringify(entry.categoryPathIds || []),
    cover_source_url: entry.coverUrl || null,
    image_count_hint: entry.imageCountHint ?? null,
    listing_fingerprint: entry.listingFingerprint,
    detail_fingerprint: `baseline-existing:${publicId}`,
    status: 'active',
    miss_count: 0
  });
}

const plan = planIncrementalDelta(previousRows, current.albums, { removalMissThreshold, inferMissing });
const runId = `r_${hash(`${tenantId}|${sourceKey}|${current.startedAt}|${current.finishedAt}`).slice(0, 20)}`;
const startedAt = current.startedAt || new Date().toISOString();
const now = current.finishedAt || new Date().toISOString();
const sourceUrl = current.sourceUrl;
const events = [
  ...baseline.map((entry) => ({ type: 'BASELINE', sourceId: String(entry.sourceId), current: entry, previous: null, needsDetail: false })),
  ...plan.events
];

const statements = [
  `INSERT OR IGNORE INTO catalog_tenants (tenant_id, slug, display_name, status, created_at, updated_at) VALUES (${sqlString(tenantId)}, ${sqlString('catalog-engine-default')}, ${sqlString('Catalog Engine Default')}, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
  `INSERT INTO supplier_sources (tenant_id, source_key, provider, source_url, status, sync_strategy, removal_miss_threshold, last_scan_at, created_at, updated_at) VALUES (${sqlString(tenantId)}, ${sqlString(sourceKey)}, ${sqlString(provider)}, ${sqlString(sourceUrl)}, 'active', 'incremental', ${removalMissThreshold}, ${sqlString(now)}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(tenant_id, source_key) DO UPDATE SET provider=excluded.provider, source_url=excluded.source_url, status='active', sync_strategy='incremental', removal_miss_threshold=excluded.removal_miss_threshold, last_scan_at=excluded.last_scan_at, updated_at=CURRENT_TIMESTAMP;`,
  `INSERT INTO supplier_sync_runs (run_id, tenant_id, source_key, mode, status, complete_scan, scanned_albums, new_count, changed_count, moved_count, restored_count, missing_count, removed_count, detail_fetch_count, started_at) VALUES (${sqlString(runId)}, ${sqlString(tenantId)}, ${sqlString(sourceKey)}, 'incremental', 'running', ${inferMissing ? 1 : 0}, ${current.albums.length}, ${plan.summary.NEW || 0}, ${(plan.summary.CHANGED || 0) + (plan.summary.CHANGED_MOVED || 0)}, ${(plan.summary.MOVED || 0) + (plan.summary.CHANGED_MOVED || 0)}, ${plan.summary.RESTORED || 0}, ${plan.summary.MISSING || 0}, ${plan.summary.REMOVED || 0}, ${plan.detailQueue.length}, ${sqlString(startedAt)});`
];

function upsertActive(entry, eventType) {
  const publicId = publicProductId(provider, String(entry.sourceId));
  const categoryPathJson = JSON.stringify(entry.categoryPathIds || []);
  const detailRequired = ['NEW', 'CHANGED', 'CHANGED_MOVED', 'RESTORED'].includes(eventType);
  const initialDetailFingerprint = eventType === 'BASELINE' ? `baseline-existing:${publicId}` : null;
  const detailUpdate = detailRequired
    ? 'detail_fingerprint=NULL'
    : eventType === 'BASELINE'
      ? 'detail_fingerprint=COALESCE(supplier_album_index.detail_fingerprint, excluded.detail_fingerprint)'
      : 'detail_fingerprint=supplier_album_index.detail_fingerprint';

  statements.push(`INSERT INTO supplier_album_index (tenant_id, source_key, album_source_id, public_product_id, source_url, source_title, source_category_id, source_category_path_json, cover_source_url, image_count_hint, listing_fingerprint, detail_fingerprint, status, miss_count, first_seen_at, last_seen_at, last_changed_at, updated_at) VALUES (${sqlString(tenantId)}, ${sqlString(sourceKey)}, ${sqlString(entry.sourceId)}, ${sqlString(publicId)}, ${sqlString(entry.sourceUrl)}, ${sqlString(entry.title || '')}, ${sqlString(entry.categoryId || null)}, ${sqlString(categoryPathJson)}, ${sqlString(entry.coverUrl || null)}, ${entry.imageCountHint === null || entry.imageCountHint === undefined ? 'NULL' : Number(entry.imageCountHint)}, ${sqlString(entry.listingFingerprint)}, ${sqlString(initialDetailFingerprint)}, 'active', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(tenant_id, source_key, album_source_id) DO UPDATE SET public_product_id=excluded.public_product_id, source_url=excluded.source_url, source_title=excluded.source_title, source_category_id=excluded.source_category_id, source_category_path_json=excluded.source_category_path_json, cover_source_url=excluded.cover_source_url, image_count_hint=excluded.image_count_hint, listing_fingerprint=excluded.listing_fingerprint, ${detailUpdate}, status='active', miss_count=0, last_seen_at=CURRENT_TIMESTAMP, last_changed_at=CASE WHEN supplier_album_index.listing_fingerprint <> excluded.listing_fingerprint OR supplier_album_index.status <> 'active' THEN CURRENT_TIMESTAMP ELSE supplier_album_index.last_changed_at END, updated_at=CURRENT_TIMESTAMP;`);
  statements.push(`INSERT INTO supplier_sync_events (run_id, tenant_id, source_key, album_source_id, public_product_id, event_type, needs_detail) VALUES (${sqlString(runId)}, ${sqlString(tenantId)}, ${sqlString(sourceKey)}, ${sqlString(entry.sourceId)}, ${sqlString(publicId)}, ${sqlString(eventType)}, ${detailRequired ? 1 : 0});`);
}

for (const event of events) {
  if (event.current) {
    upsertActive(event.current, event.type);
    continue;
  }
  const publicId = event.previous?.publicProductId || publicProductId(provider, String(event.sourceId));
  const status = event.type === 'REMOVED' ? 'deleted' : 'missing';
  statements.push(`UPDATE supplier_album_index SET status=${sqlString(status)}, miss_count=${Number(event.missCount || 1)}, updated_at=CURRENT_TIMESTAMP WHERE tenant_id=${sqlString(tenantId)} AND source_key=${sqlString(sourceKey)} AND album_source_id=${sqlString(event.sourceId)};`);
  statements.push(`INSERT INTO supplier_sync_events (run_id, tenant_id, source_key, album_source_id, public_product_id, event_type, needs_detail) VALUES (${sqlString(runId)}, ${sqlString(tenantId)}, ${sqlString(sourceKey)}, ${sqlString(event.sourceId)}, ${sqlString(publicId)}, ${sqlString(event.type)}, 0);`);
}

const sqlFiles = await writeSqlChunks(statements);
const delta = {
  schemaVersion: 2,
  tenantId,
  sourceKey,
  provider,
  runId,
  sourceUrl,
  complete: true,
  scanComplete: inferMissing,
  scan: current.stats,
  baselineCount: baseline.length,
  removalMissThreshold,
  summary: { BASELINE: baseline.length, ...plan.summary },
  detailQueue: plan.detailQueue,
  events
};
await writeFile(deltaPath, `${JSON.stringify(delta, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, runId, scanComplete: inferMissing, scannedAlbums: current.albums.length, baseline: baseline.length, ...plan.summary, detailFetches: plan.detailQueue.length, sqlChunks: sqlFiles.length }, null, 2));
