import { z } from 'zod';
import { TENANT_PROVISION_STEPS } from '../src/domain/tenant-provisioning-steps.js';
import {
  stableCustomDomainId,
  stableOpaqueId,
  stableProvisioningIdempotencyKey
} from './runtime-identity.js';

const THEME_KEYS = ['stadium', 'premium-dark', 'clean', 'street', 'minimal'];
const TENANT_ID_PATTERN = /^t_[a-f0-9]{20}$/;
const YUPOO_HOST_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.x\.yupoo\.com$/i;

const storeCreateSchema = z.object({
  storeName: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/),
  themeKey: z.enum(THEME_KEYS).default('premium-dark'),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default('BRL'),
  customDomain: z.string().trim().min(3).max(253).nullable().optional().default(null)
});

const sourceConnectionSchema = z.object({
  tenantId: z.string().regex(TENANT_ID_PATTERN),
  sourceKey: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{0,39}$/)
    .default('primary'),
  sourceUrl: z.string().trim().min(1),
  syncStrategy: z.enum(['incremental', 'full']).default('incremental')
});

export class SupplierSourceValidationError extends Error {
  constructor(code) {
    super(code);
    this.name = 'SupplierSourceValidationError';
    this.code = code;
  }
}

export function normalizeCustomHostname(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/\.$/, '');
  if (!raw) throw new Error('Informe o domínio próprio da loja.');
  if (raw.includes('://') || raw.includes('/') || raw.includes(':') || raw.includes('*')) {
    throw new Error('Informe somente o domínio, sem protocolo, caminho, porta ou curinga.');
  }
  return z
    .string()
    .max(253)
    .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/)
    .parse(raw);
}

export async function buildWorkerTenantProvisioningPlan(input) {
  const store = storeCreateSchema.parse(input);
  const ownerPrincipalId = z.string().regex(/^prn_[a-f0-9]{20}$/).parse(input.ownerPrincipalId);
  const idempotencyKey = await stableProvisioningIdempotencyKey({
    slug: store.slug,
    ownerPrincipalId
  });
  const tenantId = await stableOpaqueId('t', idempotencyKey);
  const provisioningId = await stableOpaqueId('pv', idempotencyKey);
  const dataPlaneKey = await stableOpaqueId('dp', tenantId);
  const membershipId = await stableOpaqueId('mem', `${tenantId}:${ownerPrincipalId}`);
  const hostname = store.customDomain ? normalizeCustomHostname(store.customDomain) : null;
  const domainId = hostname ? await stableCustomDomainId(tenantId, hostname) : null;

  return {
    schemaVersion: 2,
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
          domainType: 'custom',
          status: 'pending'
        }
      : null,
    membership: {
      membershipId,
      tenantId,
      principalId: ownerPrincipalId,
      role: 'owner',
      status: 'active'
    },
    provisioning: {
      provisioningId,
      tenantId,
      idempotencyKey,
      requestedByPrincipalId: ownerPrincipalId,
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

export function publicWorkerProvisioningSummary(plan) {
  return {
    tenantId: plan.tenant.tenantId,
    slug: plan.tenant.slug,
    storeName: plan.profile.storeName,
    themeKey: plan.profile.themeKey,
    currency: plan.profile.currency,
    dataPlaneKey: plan.dataPlane.dataPlaneKey,
    hostname: plan.domain?.hostname || null,
    domainType: plan.domain?.domainType || null,
    provisioningId: plan.provisioning.provisioningId,
    status: plan.provisioning.status,
    currentStep: plan.provisioning.currentStep,
    steps: plan.provisioning.steps.map(({ stepKey, status }) => ({ stepKey, status }))
  };
}

function normalizeYupooPathname(pathname) {
  return pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
}

export function normalizeYupooCatalogUrl(value) {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw new SupplierSourceValidationError('invalid_supplier_url');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) {
    throw new SupplierSourceValidationError('invalid_supplier_url');
  }
  url.hostname = url.hostname.toLowerCase();
  if (!YUPOO_HOST_PATTERN.test(url.hostname)) {
    throw new SupplierSourceValidationError('unsupported_supplier_host');
  }

  const pathname = normalizeYupooPathname(url.pathname);
  if (pathname === '/' || pathname === '/albums') {
    url.pathname = '/albums/';
    url.search = '';
    return { canonicalUrl: url.href, scopeKind: 'catalog' };
  }

  const categoryMatch = pathname.match(/^\/categories\/(\d+)$/i);
  if (!categoryMatch) throw new SupplierSourceValidationError('unsupported_supplier_scope');
  const isSubCategory = url.searchParams.get('isSubCate') === 'true';
  url.pathname = `/categories/${categoryMatch[1]}`;
  url.search = '';
  if (isSubCategory) url.searchParams.set('isSubCate', 'true');
  return { canonicalUrl: url.href, scopeKind: 'category' };
}

function isAllowedYupooUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && YUPOO_HOST_PATTERN.test(url.hostname);
  } catch {
    return false;
  }
}

async function probeYupoo(url, fetchImpl) {
  let current = new URL(url).href;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    let response;
    try {
      response = await fetchImpl(current, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
          'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8'
        }
      });
    } catch {
      clearTimeout(timer);
      throw new SupplierSourceValidationError('supplier_source_unreachable');
    }
    clearTimeout(timer);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => {});
      if (!location) throw new SupplierSourceValidationError('supplier_source_unreachable');
      const next = new URL(location, current).href;
      if (!isAllowedYupooUrl(next)) throw new SupplierSourceValidationError('supplier_redirect_rejected');
      current = next;
      continue;
    }

    await response.body?.cancel().catch(() => {});
    return { status: response.status, finalUrl: current };
  }
  throw new SupplierSourceValidationError('supplier_redirect_limit');
}

function subcategoryVariant(value) {
  const url = new URL(value);
  if (!url.searchParams.has('isSubCate')) url.searchParams.set('isSubCate', 'true');
  return url.href;
}

export async function verifyYupooCatalogSource(value, { fetchImpl = fetch } = {}) {
  const normalized = normalizeYupooCatalogUrl(value);
  const first = await probeYupoo(normalized.canonicalUrl, fetchImpl);
  if (first.status >= 200 && first.status < 400) return normalized;

  if (normalized.scopeKind === 'category' && first.status === 404) {
    const candidate = subcategoryVariant(normalized.canonicalUrl);
    const second = await probeYupoo(candidate, fetchImpl);
    if (second.status >= 200 && second.status < 400) {
      return { canonicalUrl: candidate, scopeKind: 'category' };
    }
  }

  throw new SupplierSourceValidationError(
    first.status === 404 ? 'supplier_source_not_found' : 'supplier_source_unavailable'
  );
}

export async function buildWorkerTenantSourceConnection(input, { fetchImpl = fetch } = {}) {
  const parsed = sourceConnectionSchema.parse(input);
  const verified = await verifyYupooCatalogSource(parsed.sourceUrl, { fetchImpl });
  const connectionId = await stableOpaqueId('src', `${parsed.tenantId}:${parsed.sourceKey}`);
  const sourceLocatorRef = await stableOpaqueId(
    'loc',
    `${parsed.tenantId}:${parsed.sourceKey}:${verified.canonicalUrl}`
  );

  return {
    schemaVersion: 1,
    connection: {
      connectionId,
      tenantId: parsed.tenantId,
      provider: 'yupoo',
      sourceKey: parsed.sourceKey,
      sourceLocatorRef,
      status: 'active',
      syncStrategy: parsed.syncStrategy
    },
    privateSource: verified
  };
}

export function publicWorkerTenantSourceSummary(plan) {
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
