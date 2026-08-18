import { createHash } from 'node:crypto';
import { z } from 'zod';

const tenantIdSchema = z.string().regex(/^t_[a-f0-9]{20}$/);
const hostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);

function stableDomainId(tenantId, hostname) {
  const hash = createHash('sha256').update(`custom-domain:${tenantId}:${hostname}`).digest('hex');
  return `dom_${hash.slice(0, 20)}`;
}

export function normalizeCustomHostname(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/\.$/, '');
  if (!raw) throw new Error('Informe o domínio próprio da loja.');
  if (raw.includes('://') || raw.includes('/') || raw.includes(':') || raw.includes('*')) {
    throw new Error('Informe somente o domínio, sem protocolo, caminho, porta ou curinga.');
  }
  return hostnameSchema.parse(raw);
}

export function buildTenantCustomDomain({ tenantId, hostname }) {
  const parsedTenantId = tenantIdSchema.parse(tenantId);
  const normalizedHostname = normalizeCustomHostname(hostname);
  return {
    domainId: stableDomainId(parsedTenantId, normalizedHostname),
    tenantId: parsedTenantId,
    hostname: normalizedHostname,
    domainType: 'custom',
    status: 'pending'
  };
}
