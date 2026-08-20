import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  normalizeYupooCatalogUrl,
  resolveCatalogSource
} from '../catalog-provider/index.js';

const tenantIdSchema = z.string().regex(/^t_[a-f0-9]{20}$/);
const sourceKeySchema = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{0,39}$/).default('primary');
const providerSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{0,31}$/);

const sourceConnectionInputSchema = z.object({
  tenantId: tenantIdSchema,
  provider: providerSchema.optional(),
  sourceKey: sourceKeySchema.optional(),
  sourceUrl: z.string().trim().min(1),
  syncStrategy: z.enum(['incremental', 'full']).default('incremental')
});

function hashHex(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function stableOpaqueId(prefix, seed) {
  return `${prefix}_${hashHex(`${prefix}:${seed}`).slice(0, 20)}`;
}

export function buildTenantSourceConnection(input) {
  const parsed = sourceConnectionInputSchema.parse(input);
  const sourceKey = parsed.sourceKey || 'primary';
  const resolved = resolveCatalogSource({
    provider: parsed.provider || null,
    sourceUrl: parsed.sourceUrl
  });
  const normalized = resolved.normalized;
  const connectionId = stableOpaqueId('src', `${parsed.tenantId}:${sourceKey}`);
  // Keep the v1 locator seed stable for existing Yupoo tenants. Provider-specific
  // URL validation prevents two provider adapters from claiming the same locator.
  const sourceLocatorRef = stableOpaqueId(
    'loc',
    `${parsed.tenantId}:${sourceKey}:${normalized.canonicalUrl}`
  );

  return {
    schemaVersion: 1,
    connection: {
      connectionId,
      tenantId: parsed.tenantId,
      provider: resolved.provider.key,
      sourceKey,
      sourceLocatorRef,
      status: 'active',
      syncStrategy: parsed.syncStrategy
    },
    privateSource: {
      canonicalUrl: normalized.canonicalUrl,
      scopeKind: normalized.scopeKind
    }
  };
}

export function publicTenantSourceSummary(plan) {
  return {
    connectionId: plan.connection.connectionId,
    tenantId: plan.connection.tenantId,
    provider: plan.connection.provider,
    sourceKey: plan.connection.sourceKey,
    status: plan.connection.status,
    syncStrategy: plan.connection.syncStrategy,
    scopeKind: plan.privateSource.scopeKind
  };
}

// Compatibility export for existing callers/tests while provider-specific source
// rules live outside the tenant connection domain module.
export { normalizeYupooCatalogUrl };
