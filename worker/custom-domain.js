import { z } from 'zod';
import { normalizeCustomHostname } from './control-plane-plan.js';
import { stableCustomDomainId, stableOpaqueId } from './runtime-identity.js';

const tenantIdSchema = z.string().regex(/^t_[a-f0-9]{20}$/);

export async function buildTenantDomainAttachPlan({ tenantId, hostname }) {
  const parsedTenantId = tenantIdSchema.parse(tenantId);
  const normalizedHostname = normalizeCustomHostname(hostname);
  const domainId = await stableCustomDomainId(parsedTenantId, normalizedHostname);
  const jobId = await stableOpaqueId('djob', `${domainId}:provision`);

  return {
    schemaVersion: 1,
    domain: {
      domainId,
      tenantId: parsedTenantId,
      hostname: normalizedHostname,
      domainType: 'custom',
      status: 'pending'
    },
    providerState: {
      domainId,
      tenantId: parsedTenantId,
      provider: 'cloudflare',
      providerHostnameId: null,
      providerStatus: 'pending',
      sslStatus: 'pending',
      cnameTarget: null
    },
    job: {
      jobId,
      tenantId: parsedTenantId,
      domainId,
      operation: 'provision',
      status: 'pending'
    }
  };
}

function dnsRecord(type, name, value) {
  if (!type || !name || !value) return null;
  return { type, name, value };
}

export function publicTenantDomainState(row) {
  if (!row?.domain_id || !row?.hostname) return null;
  const instructions = [];
  const cname = dnsRecord('CNAME', row.hostname, row.cname_target);
  const ownership = dnsRecord('TXT', row.ownership_txt_name, row.ownership_txt_value);
  const sslTxt = dnsRecord('TXT', row.ssl_txt_name, row.ssl_txt_value);
  if (cname) instructions.push(cname);
  if (ownership) instructions.push(ownership);
  if (sslTxt && !(ownership && ownership.name === sslTxt.name && ownership.value === sslTxt.value)) {
    instructions.push(sslTxt);
  }

  const hostnameActive = row.provider_status === 'active';
  const sslActive = row.ssl_status === 'active';
  return {
    domainId: row.domain_id,
    hostname: row.hostname,
    domainType: 'custom',
    status: row.domain_status,
    provider: row.provider || 'cloudflare',
    providerStatus: row.provider_status || 'pending',
    sslStatus: row.ssl_status || 'pending',
    readyForPublish: Boolean(hostnameActive && sslActive && row.domain_status === 'active'),
    dns: {
      target: row.cname_target || null,
      records: instructions
    },
    validation: {
      httpUrl: row.ssl_http_url || null,
      httpBody: row.ssl_http_body || null
    },
    lastCheckedAt: row.last_checked_at || null,
    lastErrorCode: row.last_error_code || null
  };
}

export function sanitizeDomainProviderStatus(value, fallback = 'pending') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized.length > 80 || !/^[a-z0-9_-]+$/.test(normalized)) return fallback;
  return normalized;
}
