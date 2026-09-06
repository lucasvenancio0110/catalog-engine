import { queryD1Batch } from '../cloudflare-platform.js';
import { ingestionPlatformConfig, loadTenantImportContext } from './context.js';

const MAX_DETAIL_ATTEMPTS = 4;
const EXHAUSTED_LEASE_ERROR = 'tenant_import_detail_lease_exhausted';

export async function recoverExhaustedInitialDetailLeases(
  message,
  env,
  { fetchImpl = fetch } = {}
) {
  if (!env?.CATALOG_DB) return { outcome: 'skipped', reason: 'database_unbound', recovered: 0 };

  const context = await loadTenantImportContext(env.CATALOG_DB, message);
  if (context.mode !== 'initial' || context.phase !== 'details') {
    return { outcome: 'skipped', reason: 'not_initial_details', recovered: 0 };
  }

  const platform = ingestionPlatformConfig(env, context.dataPlane.dispatchNamespace);
  const result = await queryD1Batch(
    {
      ...platform,
      databaseId: context.dataPlane.databaseId,
      batch: [
        {
          sql: `UPDATE supplier_album_detail_state
                   SET state='deferred', claim_token=NULL, lease_until=NULL,
                       outcome_code='retry_exhausted',
                       last_error_code=COALESCE(last_error_code, ?4),
                       processed_at=COALESCE(processed_at, CURRENT_TIMESTAMP),
                       updated_at=CURRENT_TIMESTAMP
                 WHERE tenant_id=?1 AND source_key=?2 AND import_id=?3
                   AND state='processing'
                   AND lease_until IS NOT NULL
                   AND lease_until<=CURRENT_TIMESTAMP
                   AND attempt_count>=?5`,
          params: [
            context.tenantId,
            context.sourceKey,
            context.importId,
            EXHAUSTED_LEASE_ERROR,
            MAX_DETAIL_ATTEMPTS
          ]
        },
        {
          sql: `UPDATE supplier_album_index
                   SET detail_retry_count=COALESCE((
                         SELECT d.attempt_count
                           FROM supplier_album_detail_state d
                          WHERE d.tenant_id=supplier_album_index.tenant_id
                            AND d.source_key=supplier_album_index.source_key
                            AND d.album_source_id=supplier_album_index.album_source_id
                            AND d.import_id=?3
                            AND d.state='deferred'
                            AND d.outcome_code='retry_exhausted'
                          LIMIT 1
                       ), detail_retry_count),
                       detail_retry_after=NULL,
                       detail_last_error=COALESCE((
                         SELECT d.last_error_code
                           FROM supplier_album_detail_state d
                          WHERE d.tenant_id=supplier_album_index.tenant_id
                            AND d.source_key=supplier_album_index.source_key
                            AND d.album_source_id=supplier_album_index.album_source_id
                            AND d.import_id=?3
                            AND d.state='deferred'
                            AND d.outcome_code='retry_exhausted'
                          LIMIT 1
                       ), ?4),
                       updated_at=CURRENT_TIMESTAMP
                 WHERE tenant_id=?1 AND source_key=?2
                   AND EXISTS (
                     SELECT 1
                       FROM supplier_album_detail_state d
                      WHERE d.tenant_id=supplier_album_index.tenant_id
                        AND d.source_key=supplier_album_index.source_key
                        AND d.album_source_id=supplier_album_index.album_source_id
                        AND d.import_id=?3
                        AND d.state='deferred'
                        AND d.outcome_code='retry_exhausted'
                   )`,
          params: [
            context.tenantId,
            context.sourceKey,
            context.importId,
            EXHAUSTED_LEASE_ERROR
          ]
        }
      ]
    },
    { fetchImpl }
  );

  const recovered = Math.max(0, Number(result?.[0]?.meta?.changes || 0));
  return { outcome: 'success', recovered };
}
