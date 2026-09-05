const TENANT_ID_PATTERN = /^t_[a-f0-9]{20}$/;
const MAX_SOURCE_URL_LENGTH = 2048;

export class PortalSourceConnectionError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.name = 'PortalSourceConnectionError';
    this.code = code;
    this.status = status;
  }
}

function validateTenantId(tenantId) {
  const value = String(tenantId || '').trim();
  if (!TENANT_ID_PATTERN.test(value)) {
    throw new PortalSourceConnectionError('store_not_found', 404);
  }
  return value;
}

export function buildPortalSourceConnectionPayload(sourceUrl) {
  const value = String(sourceUrl || '').trim();
  if (!value || value.length > MAX_SOURCE_URL_LENGTH) {
    throw new PortalSourceConnectionError('invalid_supplier_url', 400);
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new PortalSourceConnectionError('invalid_supplier_url', 400);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new PortalSourceConnectionError('invalid_supplier_url', 400);
  }

  return {
    sourceUrl: value,
    sourceKey: 'primary',
    syncStrategy: 'incremental'
  };
}

async function responsePayload(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function responseError(payload, response, fallback) {
  const code = String(payload?.error || fallback || 'admin_temporarily_unavailable')
    .trim()
    .toLowerCase();
  return new PortalSourceConnectionError(code, response.status);
}

export async function requestPortalSourceState({ tenantId, token, fetchImpl = fetch }) {
  const safeTenantId = validateTenantId(tenantId);
  if (!String(token || '').trim()) throw new PortalSourceConnectionError('unauthorized', 401);

  const response = await fetchImpl(`/api/admin/stores/${safeTenantId}/onboarding`, {
    method: 'GET',
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}` }
  });
  const payload = await responsePayload(response);
  if (!response.ok) throw responseError(payload, response, 'source_state_unavailable');

  const source = payload?.source;
  if (!source) return null;
  if (
    source.provider !== 'yupoo' ||
    source.sourceKey !== 'primary' ||
    typeof source.status !== 'string'
  ) {
    throw new PortalSourceConnectionError('source_state_invalid', 502);
  }

  return {
    provider: 'yupoo',
    sourceKey: 'primary',
    status: source.status,
    syncStrategy: source.syncStrategy || 'incremental',
    lastHealthAt: source.lastHealthAt || null,
    lastSuccessAt: source.lastSuccessAt || null,
    lastError: source.lastError || null
  };
}

export async function requestPortalSourceConnection({
  tenantId,
  token,
  sourceUrl,
  fetchImpl = fetch
}) {
  const safeTenantId = validateTenantId(tenantId);
  if (!String(token || '').trim()) throw new PortalSourceConnectionError('unauthorized', 401);
  const body = buildPortalSourceConnectionPayload(sourceUrl);

  const response = await fetchImpl(`/api/admin/stores/${safeTenantId}/source`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const payload = await responsePayload(response);
  if (!response.ok) throw responseError(payload, response, 'source_connection_failed');

  const source = payload?.source;
  if (
    source?.provider !== 'yupoo' ||
    source?.sourceKey !== 'primary' ||
    source?.status !== 'active' ||
    !['catalog', 'category'].includes(source?.scopeKind)
  ) {
    throw new PortalSourceConnectionError('source_connection_response_invalid', 502);
  }

  return {
    provider: 'yupoo',
    sourceKey: 'primary',
    status: 'active',
    syncStrategy: source.syncStrategy || 'incremental',
    scopeKind: source.scopeKind
  };
}
