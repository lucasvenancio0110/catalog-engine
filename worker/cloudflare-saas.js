import { sanitizeDomainProviderStatus } from './custom-domain.js';

const API_ORIGIN = 'https://api.cloudflare.com';
const ZONE_ID_PATTERN = /^[a-f0-9]{32}$/i;
const REQUEST_TIMEOUT_MS = 15_000;

export class CloudflareSaasError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.name = 'CloudflareSaasError';
    this.code = code;
    this.status = status;
  }
}

function validateConfig({ zoneId, apiToken, cnameTarget = null }) {
  const normalizedZoneId = String(zoneId || '').trim();
  const normalizedToken = String(apiToken || '').trim();
  if (!ZONE_ID_PATTERN.test(normalizedZoneId) || normalizedToken.length < 20) {
    throw new CloudflareSaasError('cloudflare_saas_unconfigured', 503);
  }

  let normalizedTarget = null;
  if (cnameTarget) {
    const candidate = String(cnameTarget).trim().toLowerCase().replace(/\.$/, '');
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(candidate)) {
      throw new CloudflareSaasError('cloudflare_saas_invalid_target', 503);
    }
    normalizedTarget = candidate;
  }

  return { zoneId: normalizedZoneId, apiToken: normalizedToken, cnameTarget: normalizedTarget };
}

async function cloudflareRequest(
  path,
  { method = 'GET', body = null, config, fetchImpl = fetch, requireResult = true } = {}
) {
  const url = new URL(path, API_ORIGIN);
  if (url.origin !== API_ORIGIN) throw new CloudflareSaasError('cloudflare_saas_invalid_request', 500);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(url.href, {
      method,
      redirect: 'error',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${config.apiToken}`,
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  } catch {
    clearTimeout(timer);
    throw new CloudflareSaasError('cloudflare_saas_unreachable', 503);
  }
  clearTimeout(timer);

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new CloudflareSaasError('cloudflare_saas_invalid_response');
  }

  if (!response.ok || payload?.success !== true || (requireResult && !payload?.result)) {
    const providerCode = payload?.errors?.[0]?.code;
    const safeCode = Number.isFinite(Number(providerCode)) ? String(providerCode) : 'unknown';
    const status =
      response.status === 429
        ? 503
        : response.status >= 400 && response.status < 500
          ? 422
          : 502;
    throw new CloudflareSaasError(`cloudflare_custom_hostname_${safeCode}`, status);
  }
  return payload.result ?? null;
}

export async function createCloudflareCustomHostname(
  { zoneId, apiToken, hostname, cnameTarget = null },
  { fetchImpl = fetch } = {}
) {
  const config = validateConfig({ zoneId, apiToken, cnameTarget });
  const result = await cloudflareRequest(`/client/v4/zones/${config.zoneId}/custom_hostnames`, {
    method: 'POST',
    config,
    fetchImpl,
    body: {
      hostname,
      ssl: {
        method: 'http',
        type: 'dv',
        wildcard: false,
        settings: { min_tls_version: '1.2' }
      }
    }
  });
  return cloudflareCustomHostnameState(result, { cnameTarget: config.cnameTarget });
}

function normalizedHostnameId(value) {
  const id = String(value || '').trim();
  if (!/^[a-z0-9_-]{8,80}$/i.test(id)) {
    throw new CloudflareSaasError('cloudflare_saas_invalid_hostname_id', 500);
  }
  return id;
}

export async function getCloudflareCustomHostname(
  { zoneId, apiToken, providerHostnameId, cnameTarget = null },
  { fetchImpl = fetch } = {}
) {
  const config = validateConfig({ zoneId, apiToken, cnameTarget });
  const id = normalizedHostnameId(providerHostnameId);
  const result = await cloudflareRequest(
    `/client/v4/zones/${config.zoneId}/custom_hostnames/${encodeURIComponent(id)}`,
    { config, fetchImpl }
  );
  return cloudflareCustomHostnameState(result, { cnameTarget: config.cnameTarget });
}

export async function restartCloudflareHttpDcv(
  { zoneId, apiToken, providerHostnameId, cnameTarget = null },
  { fetchImpl = fetch } = {}
) {
  const config = validateConfig({ zoneId, apiToken, cnameTarget });
  const id = normalizedHostnameId(providerHostnameId);
  const result = await cloudflareRequest(
    `/client/v4/zones/${config.zoneId}/custom_hostnames/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      config,
      fetchImpl,
      body: { ssl: { method: 'http', type: 'dv' } }
    }
  );
  return cloudflareCustomHostnameState(result, { cnameTarget: config.cnameTarget });
}

export async function deleteCloudflareCustomHostname(
  { zoneId, apiToken, providerHostnameId },
  { fetchImpl = fetch } = {}
) {
  const config = validateConfig({ zoneId, apiToken });
  const id = normalizedHostnameId(providerHostnameId);
  await cloudflareRequest(
    `/client/v4/zones/${config.zoneId}/custom_hostnames/${encodeURIComponent(id)}`,
    { method: 'DELETE', config, fetchImpl, requireResult: false }
  );
  return { deleted: true, providerHostnameId: id };
}

function firstValidationRecord(ssl) {
  const records = Array.isArray(ssl?.validation_records) ? ssl.validation_records : [];
  return records.find((record) => record && typeof record === 'object') || null;
}

export function cloudflareCustomHostnameState(result, { cnameTarget = null } = {}) {
  if (!result || typeof result !== 'object' || !result.id || !result.hostname) {
    throw new CloudflareSaasError('cloudflare_saas_invalid_response');
  }
  const ownership = result.ownership_verification || null;
  const validation = firstValidationRecord(result.ssl);
  const providerStatus = sanitizeDomainProviderStatus(result.status, 'pending');
  const sslStatus = sanitizeDomainProviderStatus(result.ssl?.status, 'pending');

  return {
    provider: 'cloudflare',
    providerHostnameId: String(result.id),
    hostname: String(result.hostname).toLowerCase(),
    providerStatus,
    sslStatus,
    cnameTarget: cnameTarget || null,
    ownershipTxtName: ownership?.type === 'txt' ? ownership.name || null : null,
    ownershipTxtValue: ownership?.type === 'txt' ? ownership.value || null : null,
    sslTxtName: validation?.txt_name || null,
    sslTxtValue: validation?.txt_value || null,
    sslHttpUrl: validation?.http_url || null,
    sslHttpBody: validation?.http_body || null,
    ready: providerStatus === 'active' && sslStatus === 'active'
  };
}
