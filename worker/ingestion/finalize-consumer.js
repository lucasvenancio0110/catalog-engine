import { queryD1Batch } from '../cloudflare-platform.js';
import { parseTenantImportMessage } from '../tenant-import-queue.js';
import {
  TenantImportContextError,
  ingestionPlatformConfig,
  loadTenantImportContext
} from './context.js';

const FINALIZE_RETRY_SECONDS = 90;

function safeFinalizeError(error) {
  if (error instanceof TenantImportContextError) return error.code;
  const message = String(error?.message || error);
  if (/^tenant_[a-z0-9_]+$/i.test(message)) return message.slice(0, 120);
  return 'tenant_import_finalize_failed';
}

function countByState(rows) {
  const output = { success: 0, skipped: 0, deferred: 0, failed: 0, processing: 0, pending: 0 };
  for (const row of rows || []) {
    if (Object.hasOwn(output, row.state)) output[row.state] = Number(row.total || 0);
  }
  return output;
}

async function readFinalizeState(context, platform, fetchImpl) {
  const result = await queryD1Batch(
    {
      ...platform,
      databaseId: context.dataPlane.databaseId,
      batch: [
        {
          sql: `SELECT state, COUNT(*) AS total
                  FROM supplier_album_detail_state
                 WHERE tenant_id=?1 AND source_key=?2 AND import_id=?3
                 GROUP BY state`,
          params: [context.tenantId, context.sourceKey, context.importId]
        },
        {
          sql: `SELECT COUNT(*) AS total,
                       SUM(CASE WHEN classification_status='automatic' THEN 1 ELSE 0 END) AS automatic,
                       SUM(CASE WHEN classification_status='needs_review' THEN 1 ELSE 0 END) AS review,
                       SUM(CASE WHEN classification_status='unknown' THEN 1 ELSE 0 END) AS unknown_count
                  FROM catalog_products`,
          params: []
        },
        {
          sql: `SELECT COUNT(*) AS leaks
                  FROM catalog_products
                 WHERE lower(name) LIKE '%x.yupoo.com%'
                    OR lower(description) LIKE '%x.yupoo.com%'
                    OR lower(name) LIKE '%photo.yupoo.com%'
                    OR lower(description) LIKE '%photo.yupoo.com%'
                    OR lower(description) LIKE '%http://%'
                    OR lower(description) LIKE '%https://%'`,
          params: []
        }
      ]
    },
    { fetchImpl }
  );
  const states = countByState(result[0]?.results || []);
  const products = result[1]?.results?.[0] || {};
  const leaks = Number(result[2]?.results?.[0]?.leaks || 0);
  return {
    states,
    products: Number(products.total || 0),
    automatic: Number(products.automatic || 0),
    review: Number(products.review || 0),
    unknown: Number(products.unknown_count || 0),
    leaks
  };
}

async function finalizeTenantDataPlane(context, platform, stats, fetchImpl) {
  const generatedAt = new Date().toISOString();
  const publicStats = JSON.stringify({ products: stats.products });
  const normalization = JSON.stringify({
    version: 1,
    classified: stats.automatic,
    needsReview: stats.review,
    unknown: stats.unknown
  });
  await queryD1Batch(
    {
      ...platform,
      databaseId: context.dataPlane.databaseId,
      batch: [
        {
          sql: `UPDATE catalog_categories
                   SET product_count=(
                     SELECT COUNT(*) FROM catalog_product_categories pc
                      WHERE pc.category_id=catalog_categories.category_id
                   ), updated_at=CURRENT_TIMESTAMP`,
          params: []
        },
        {
          sql: `UPDATE catalog_leagues
                   SET product_count=(
                     SELECT COUNT(*) FROM catalog_products p
                      WHERE p.league_id=catalog_leagues.league_id
                   ), updated_at=CURRENT_TIMESTAMP`,
          params: []
        },
        {
          sql: `UPDATE catalog_teams
                   SET product_count=(
                     SELECT COUNT(*) FROM catalog_products p
                      WHERE p.team_id=catalog_teams.team_id
                   ), updated_at=CURRENT_TIMESTAMP`,
          params: []
        },
        {
          sql: `UPDATE catalog_facets
                   SET product_count=(
                     SELECT COUNT(*) FROM catalog_product_facets pf
                      WHERE pf.facet_id=catalog_facets.facet_id
                   ), updated_at=CURRENT_TIMESTAMP`,
          params: []
        },
        { sql: `DELETE FROM catalog_leagues WHERE product_count=0`, params: [] },
        { sql: `DELETE FROM catalog_teams WHERE product_count=0`, params: [] },
        { sql: `DELETE FROM catalog_facets WHERE product_count=0`, params: [] },
        {
          sql: `DELETE FROM media_sources
                 WHERE media_id NOT IN (SELECT media_id FROM product_media)`,
          params: []
        },
        {
          sql: `INSERT INTO catalog_meta (key, value_json, updated_at)
                VALUES ('generatedAt', ?1, CURRENT_TIMESTAMP)
                ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=CURRENT_TIMESTAMP`,
          params: [JSON.stringify(generatedAt)]
        },
        {
          sql: `INSERT INTO catalog_meta (key, value_json, updated_at)
                VALUES ('stats', ?1, CURRENT_TIMESTAMP)
                ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=CURRENT_TIMESTAMP`,
          params: [publicStats]
        },
        {
          sql: `INSERT INTO catalog_meta (key, value_json, updated_at)
                VALUES ('normalization', ?1, CURRENT_TIMESTAMP)
                ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=CURRENT_TIMESTAMP`,
          params: [normalization]
        },
        {
          sql: `UPDATE supplier_sources
                   SET last_success_at=CURRENT_TIMESTAMP, last_error=NULL, updated_at=CURRENT_TIMESTAMP
                 WHERE tenant_id=?1 AND source_key=?2`,
          params: [context.tenantId, context.sourceKey]
        }
      ]
    },
    { fetchImpl }
  );
}

async function finishControlPlaneImport(db, context, stats) {
  const terminal = stats.states.success + stats.states.skipped + stats.states.deferred;
  const statements = [
    db
      .prepare(
        `UPDATE tenant_import_jobs
            SET status='success', phase='complete',
                completed_detail_count=?2,
                failed_detail_count=?3,
                deferred_detail_count=?4,
                published_product_count=?5,
                classified_automatic_count=?6,
                classified_review_count=?7,
                classified_unknown_count=?8,
                next_attempt_at=NULL, finished_at=CURRENT_TIMESTAMP,
                last_error_code=NULL, updated_at=CURRENT_TIMESTAMP
          WHERE import_id=?1 AND tenant_id=?9 AND source_key=?10`
      )
      .bind(
        context.importId,
        terminal,
        stats.states.failed,
        stats.states.deferred,
        stats.products,
        stats.automatic,
        stats.review,
        stats.unknown,
        context.tenantId,
        context.sourceKey
      )
  ];

  if (context.provisioningId) {
    statements.push(
      db
        .prepare(
          `UPDATE tenant_provisioning_steps
              SET status='success',
                  attempt_count=CASE WHEN attempt_count < 1 THEN 1 ELSE attempt_count END,
                  started_at=COALESCE(started_at,CURRENT_TIMESTAMP),
                  finished_at=CURRENT_TIMESTAMP,
                  last_error=NULL, metadata_json=?2, updated_at=CURRENT_TIMESTAMP
            WHERE provisioning_id=?1 AND step_key='import'`
        )
        .bind(
          context.provisioningId,
          JSON.stringify({
            importId: context.importId,
            discovered: context.discoveredCount,
            published: stats.products,
            deferred: stats.states.deferred,
            isolated: true
          })
        )
    );
    statements.push(
      db
        .prepare(
          `UPDATE tenant_provisioning_runs
              SET status='running', current_step='classify', last_error=NULL,
                  updated_at=CURRENT_TIMESTAMP
            WHERE provisioning_id=?1 AND tenant_id=?2 AND current_step='import'`
        )
        .bind(context.provisioningId, context.tenantId)
    );
  }
  await db.batch(statements);
}

async function markFinalizing(db, context) {
  await db
    .prepare(
      `UPDATE tenant_import_jobs
          SET status='finalizing', phase='finalize', updated_at=CURRENT_TIMESTAMP
        WHERE import_id=?1 AND tenant_id=?2 AND source_key=?3
          AND status IN ('details','finalizing')`
    )
    .bind(context.importId, context.tenantId, context.sourceKey)
    .run();
}

export async function handleTenantImportFinalizeMessage(
  messageValue,
  env,
  { fetchImpl = fetch } = {}
) {
  const message = parseTenantImportMessage(messageValue);
  if (message.type !== 'finalize') return { outcome: 'unsupported', type: message.type };
  if (!env.CATALOG_DB) return { outcome: 'failed', error: 'database_unbound' };

  try {
    const context = await loadTenantImportContext(env.CATALOG_DB, message);
    if (!['details', 'finalize'].includes(context.phase)) {
      return { outcome: 'busy', delaySeconds: FINALIZE_RETRY_SECONDS };
    }
    const platform = ingestionPlatformConfig(env, context.dataPlane.dispatchNamespace);
    const stats = await readFinalizeState(context, platform, fetchImpl);
    const terminal = stats.states.success + stats.states.skipped + stats.states.deferred;
    if (terminal < context.discoveredCount) {
      return {
        outcome: 'not_ready',
        terminal,
        discovered: context.discoveredCount,
        delaySeconds: FINALIZE_RETRY_SECONDS
      };
    }
    if (terminal > context.discoveredCount) throw new Error('tenant_import_terminal_count_invalid');
    if (stats.leaks > 0) throw new Error('tenant_import_public_whitelabel_violation');

    await markFinalizing(env.CATALOG_DB, context);
    await finalizeTenantDataPlane(context, platform, stats, fetchImpl);
    await finishControlPlaneImport(env.CATALOG_DB, context, stats);
    return {
      outcome: 'success',
      products: stats.products,
      automatic: stats.automatic,
      review: stats.review,
      unknown: stats.unknown,
      deferred: stats.states.deferred
    };
  } catch (error) {
    return { outcome: 'failed', error: safeFinalizeError(error) };
  }
}
