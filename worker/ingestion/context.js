import { z } from 'zod';

const importIdSchema = z.string().regex(/^imp_[a-f0-9]{20}$/);
const tenantIdSchema = z.string().regex(/^t_[a-f0-9]{20}$/);
const sourceKeySchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);
const providerKeySchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/);
const databaseIdSchema = z.string().regex(/^[a-f0-9-]{32,40}$/i);

export class TenantImportContextError extends Error {
  constructor(code, status = 409) {
    super(code);
    this.name = 'TenantImportContextError';
    this.code = code;
    this.status = status;
  }
}

export async function loadTenantImportContext(db, { importId, tenantId, sourceKey }) {
  const parsed = {
    importId: importIdSchema.parse(importId),
    tenantId: tenantIdSchema.parse(tenantId),
    sourceKey: sourceKeySchema.parse(sourceKey)
  };

  const row = await db
    .prepare(
      `SELECT j.import_id, j.mode, j.status AS import_status, j.phase,
              j.detail_enqueue_cursor, j.discovered_count,
              s.provider, s.source_url, s.sync_strategy, s.removal_miss_threshold,
              p.d1_database_id, p.database_status, p.worker_status, p.dispatch_namespace,
              r.provisioning_id, r.current_step AS provisioning_step,
              i.schema_version
         FROM tenant_import_jobs j
         JOIN supplier_sources s ON s.tenant_id=j.tenant_id AND s.source_key=j.source_key
         JOIN tenant_data_plane_provider_state p ON p.tenant_id=j.tenant_id
         JOIN tenant_catalog_instances i ON i.tenant_id=j.tenant_id
         LEFT JOIN tenant_provisioning_runs r ON r.provisioning_id=(
           SELECT r2.provisioning_id
             FROM tenant_provisioning_runs r2
            WHERE r2.tenant_id=j.tenant_id
            ORDER BY r2.created_at DESC
            LIMIT 1
         )
        WHERE j.import_id=?1 AND j.tenant_id=?2 AND j.source_key=?3
        LIMIT 1`
    )
    .bind(parsed.importId, parsed.tenantId, parsed.sourceKey)
    .first();

  if (!row) throw new TenantImportContextError('tenant_import_not_found', 404);
  if (row.mode !== 'initial') throw new TenantImportContextError('tenant_import_mode_not_supported');
  if (!['pending', 'queued', 'scanning', 'details', 'finalizing', 'failed'].includes(row.import_status)) {
    throw new TenantImportContextError('tenant_import_not_runnable');
  }
  if (!['scan', 'details', 'finalize'].includes(row.phase)) {
    throw new TenantImportContextError('tenant_import_phase_not_runnable');
  }
  if (row.database_status !== 'active' || row.worker_status !== 'active') {
    throw new TenantImportContextError('tenant_data_plane_not_ready');
  }
  if (Number(row.schema_version || 0) < 3) {
    throw new TenantImportContextError('tenant_schema_not_ready');
  }
  if (row.provisioning_step && row.provisioning_step !== 'import') {
    throw new TenantImportContextError('tenant_import_checkpoint_mismatch');
  }

  let provider;
  try {
    provider = providerKeySchema.parse(String(row.provider || '').trim().toLowerCase());
  } catch {
    throw new TenantImportContextError('tenant_import_provider_invalid');
  }

  return {
    importId: parsed.importId,
    tenantId: parsed.tenantId,
    sourceKey: parsed.sourceKey,
    importStatus: row.import_status,
    phase: row.phase,
    detailEnqueueCursor: Number(row.detail_enqueue_cursor || 0),
    discoveredCount: Number(row.discovered_count || 0),
    privateSource: {
      provider,
      url: row.source_url,
      syncStrategy: row.sync_strategy,
      removalMissThreshold: Number(row.removal_miss_threshold || 3)
    },
    dataPlane: {
      databaseId: databaseIdSchema.parse(row.d1_database_id),
      dispatchNamespace: row.dispatch_namespace
    },
    provisioningId: row.provisioning_id || null
  };
}

export function ingestionPlatformConfig(env, expectedNamespace) {
  const dispatchNamespace = String(
    env.CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE || expectedNamespace || ''
  ).trim();
  if (!dispatchNamespace) {
    throw new TenantImportContextError('tenant_ingestion_platform_unconfigured', 503);
  }
  if (expectedNamespace && dispatchNamespace !== expectedNamespace) {
    throw new TenantImportContextError('tenant_dispatch_namespace_mismatch', 500);
  }

  if (env?.TENANT_DISPATCH && typeof env.TENANT_DISPATCH.get === 'function') {
    return {
      dispatchNamespace,
      tenantDispatch: env.TENANT_DISPATCH
    };
  }

  // Transitional fallback for existing administrative tools and unit fixtures.
  // Queue workers are configured with TENANT_DISPATCH and therefore do not need
  // account-level D1 credentials on the ingestion hot path.
  const accountId = String(env.CLOUDFLARE_PLATFORM_ACCOUNT_ID || '').trim();
  const apiToken = String(env.CLOUDFLARE_PLATFORM_API_TOKEN || '').trim();
  if (!/^[a-f0-9]{32}$/i.test(accountId) || apiToken.length < 20) {
    throw new TenantImportContextError('tenant_ingestion_platform_unconfigured', 503);
  }
  return { accountId, apiToken, dispatchNamespace };
}
