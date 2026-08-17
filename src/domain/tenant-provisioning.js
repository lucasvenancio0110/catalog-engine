import { createHash } from 'node:crypto';
import { z } from 'zod';
import { normalizeTenantProvisionRequest } from './tenant-config.js';

export const TENANT_PROVISION_STEPS = [
  'tenant',
  'profile',
  'domain',
  'data_plane',
  'source',
  'migrations',
  'import',
  'classify',
  'verify',
  'publish'
];

const principalIdSchema = z.string().trim().min(3).max(160).nullable().default(null);
const platformBaseDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/)
  .nullable()
  .default(null);

const provisioningInputSchema = z.object({
  storeName: z.string(),
  slug: z.string(),
  themeKey: z.string().optional(),
  currency: z.string().optional(),
  ownerPrincipalId: principalIdSchema,
  platformBaseDomain: platformBaseDomainSchema
});

function hashHex(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function stableOpaqueId(prefix, seed) {
  return `${prefix}_${hashHex(`${prefix}:${seed}`).slice(0, 20)}`;
}

function stableIdempotencyKey(request) {
  return hashHex(
    JSON.stringify({
      slug: request.slug,
      ownerPrincipalId: request.ownerPrincipalId || null
    })
  );
}

export function buildTenantProvisioningPlan(input) {
  const raw = provisioningInputSchema.parse(input);
  const store = normalizeTenantProvisionRequest({
    storeName: raw.storeName,
    slug: raw.slug,
    themeKey: raw.themeKey,
    currency: raw.currency
  });
  const idempotencyKey = stableIdempotencyKey({
    slug: store.slug,
    ownerPrincipalId: raw.ownerPrincipalId
  });
  const tenantId = stableOpaqueId('t', idempotencyKey);
  const provisioningId = stableOpaqueId('pv', idempotencyKey);
  const dataPlaneKey = stableOpaqueId('dp', tenantId);
  const membershipId = raw.ownerPrincipalId
    ? stableOpaqueId('mem', `${tenantId}:${raw.ownerPrincipalId}`)
    : null;
  const hostname = raw.platformBaseDomain ? `${store.slug}.${raw.platformBaseDomain}` : null;
  const domainId = hostname ? stableOpaqueId('dom', `${tenantId}:${hostname}`) : null;

  return {
    schemaVersion: 1,
    tenant: {
      tenantId,
      slug: store.slug,
      displayName: store.storeName,
      status: 'active'
    },
    profile: {
      tenantId,
      storeName: store.storeName,
      themeKey: store.themeKey,
      currency: store.currency,
      setupStatus: 'configuring'
    },
    dataPlane: {
      tenantId,
      dataPlaneKey,
      status: 'provisioning',
      schemaVersion: 0
    },
    domain: hostname
      ? {
          domainId,
          tenantId,
          hostname,
          domainType: 'platform_subdomain',
          status: 'pending'
        }
      : null,
    membership: raw.ownerPrincipalId
      ? {
          membershipId,
          tenantId,
          principalId: raw.ownerPrincipalId,
          role: 'owner',
          status: 'active'
        }
      : null,
    provisioning: {
      provisioningId,
      tenantId,
      idempotencyKey,
      requestedByPrincipalId: raw.ownerPrincipalId,
      status: 'pending',
      currentStep: 'tenant',
      steps: TENANT_PROVISION_STEPS.map((stepKey) => ({
        stepKey,
        status: 'pending',
        attemptCount: 0
      }))
    }
  };
}

export function publicProvisioningSummary(plan) {
  return {
    tenantId: plan.tenant.tenantId,
    slug: plan.tenant.slug,
    storeName: plan.profile.storeName,
    themeKey: plan.profile.themeKey,
    currency: plan.profile.currency,
    dataPlaneKey: plan.dataPlane.dataPlaneKey,
    hostname: plan.domain?.hostname || null,
    provisioningId: plan.provisioning.provisioningId,
    status: plan.provisioning.status,
    currentStep: plan.provisioning.currentStep,
    steps: plan.provisioning.steps.map(({ stepKey, status }) => ({ stepKey, status }))
  };
}
