import { createHash } from 'node:crypto';
import { z } from 'zod';

const tenantIdSchema = z.string().regex(/^t_[a-f0-9]{20}$/);
const sourceKeySchema = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{0,39}$/).default('primary');
const yupooHostnamePattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.x\.yupoo\.com$/i;

const sourceConnectionInputSchema = z.object({
  tenantId: tenantIdSchema,
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

function normalizePathname(pathname) {
  return pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
}

export function normalizeYupooCatalogUrl(value) {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw new Error('Informe uma URL válida do catálogo Yupoo.');
  }

  if (url.protocol !== 'https:') {
    throw new Error('A fonte Yupoo precisa usar HTTPS.');
  }
  if (url.username || url.password || url.port || url.hash) {
    throw new Error('A URL do fornecedor contém componentes não permitidos.');
  }

  url.hostname = url.hostname.toLowerCase();
  if (!yupooHostnamePattern.test(url.hostname)) {
    throw new Error('A fonte precisa ser um catálogo público do Yupoo (*.x.yupoo.com).');
  }

  const pathname = normalizePathname(url.pathname);
  if (pathname === '/' || pathname === '/albums') {
    url.pathname = '/albums/';
    url.search = '';
    return {
      canonicalUrl: url.href,
      scopeKind: 'catalog'
    };
  }

  const categoryMatch = pathname.match(/^\/categories\/(\d+)$/i);
  if (categoryMatch) {
    const isSubCategory = url.searchParams.get('isSubCate') === 'true';
    url.pathname = `/categories/${categoryMatch[1]}`;
    url.search = '';
    if (isSubCategory) url.searchParams.set('isSubCate', 'true');
    return {
      canonicalUrl: url.href,
      scopeKind: 'category'
    };
  }

  throw new Error('Conecte a raiz do catálogo (/albums/) ou uma categoria Yupoo suportada.');
}

export function buildTenantSourceConnection(input) {
  const parsed = sourceConnectionInputSchema.parse(input);
  const sourceKey = parsed.sourceKey || 'primary';
  const normalized = normalizeYupooCatalogUrl(parsed.sourceUrl);
  const connectionId = stableOpaqueId('src', `${parsed.tenantId}:${sourceKey}`);
  const sourceLocatorRef = stableOpaqueId(
    'loc',
    `${parsed.tenantId}:${sourceKey}:${normalized.canonicalUrl}`
  );

  return {
    schemaVersion: 1,
    connection: {
      connectionId,
      tenantId: parsed.tenantId,
      provider: 'yupoo',
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
