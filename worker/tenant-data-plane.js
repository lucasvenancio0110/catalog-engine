import { z } from 'zod';
import { stableOpaqueId } from './runtime-identity.js';

const tenantIdSchema = z.string().regex(/^t_[a-f0-9]{20}$/);
const namespaceSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{1,62}$/i);

function tenantSuffix(tenantId) {
  return tenantId.slice(2);
}

export async function buildTenantDataPlanePlan({ tenantId, dispatchNamespace }) {
  const parsedTenantId = tenantIdSchema.parse(tenantId);
  const namespace = namespaceSchema.parse(String(dispatchNamespace || '').trim());
  const suffix = tenantSuffix(parsedTenantId);
  const workerScriptName = `ce-${suffix}`;
  const d1DatabaseName = `ce-${suffix}`;
  const jobId = await stableOpaqueId('dpjob', `${parsedTenantId}:provision`);

  return {
    schemaVersion: 1,
    tenantId: parsedTenantId,
    provider: 'cloudflare_wfp',
    dispatchNamespace: namespace,
    workerScriptName,
    d1DatabaseName,
    job: {
      jobId,
      tenantId: parsedTenantId,
      operation: 'provision',
      status: 'pending'
    }
  };
}

export function publicTenantDataPlaneState(row) {
  if (!row?.tenant_id) return null;
  return {
    provider: row.provider || 'cloudflare_wfp',
    status:
      row.worker_status === 'active' && row.database_status === 'active'
        ? 'provisioned'
        : row.worker_status === 'error' || row.database_status === 'error'
          ? 'error'
          : 'provisioning',
    workerStatus: row.worker_status || 'pending',
    databaseStatus: row.database_status || 'pending',
    lastCheckedAt: row.last_checked_at || null,
    lastErrorCode: row.last_error_code || null
  };
}
