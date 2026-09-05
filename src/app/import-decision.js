const TENANT_ID_PATTERN = /^t_[a-f0-9]{20}$/;
const DECISION_KIND = 'full_connected_source';
const SOURCE_KEY = 'primary';

export class PortalImportDecisionError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.name = 'PortalImportDecisionError';
    this.code = code;
    this.status = status;
  }
}

function validateTenantId(tenantId) {
  const value = String(tenantId || '').trim();
  if (!TENANT_ID_PATTERN.test(value)) {
    throw new PortalImportDecisionError('store_not_found', 404);
  }
  return value;
}

async function responsePayload(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function responseError(payload, response, fallback) {
  const code = String(payload?.error || fallback || 'import_decision_temporarily_unavailable')
    .trim()
    .toLowerCase();
  return new PortalImportDecisionError(code, response.status);
}

function safeDecision(value) {
  if (!value) return null;
  if (
    value.sourceKey !== SOURCE_KEY ||
    value.decisionKind !== DECISION_KIND ||
    value.status !== 'confirmed' ||
    !['merchant', 'preexisting_import'].includes(value.authority)
  ) {
    throw new PortalImportDecisionError('import_decision_state_invalid', 502);
  }
  return {
    sourceKey: SOURCE_KEY,
    decisionKind: DECISION_KIND,
    status: 'confirmed',
    authority: value.authority,
    confirmedAt: value.confirmedAt || null
  };
}

export async function requestPortalImportDecisionState({ tenantId, token, fetchImpl = fetch }) {
  const safeTenantId = validateTenantId(tenantId);
  if (!String(token || '').trim()) throw new PortalImportDecisionError('unauthorized', 401);
  const response = await fetchImpl(`/api/admin/stores/${safeTenantId}/import-decision`, {
    method: 'GET',
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}` }
  });
  const payload = await responsePayload(response);
  if (!response.ok) throw responseError(payload, response, 'import_decision_state_unavailable');
  return {
    sourceConnected: payload?.sourceConnected === true,
    decision: safeDecision(payload?.decision)
  };
}

export async function confirmPortalFullSourceImport({ tenantId, token, fetchImpl = fetch }) {
  const safeTenantId = validateTenantId(tenantId);
  if (!String(token || '').trim()) throw new PortalImportDecisionError('unauthorized', 401);
  const response = await fetchImpl(`/api/admin/stores/${safeTenantId}/import-decision`, {
    method: 'PUT',
    cache: 'no-store',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ sourceKey: SOURCE_KEY, decisionKind: DECISION_KIND })
  });
  const payload = await responsePayload(response);
  if (!response.ok) throw responseError(payload, response, 'import_decision_failed');
  return safeDecision(payload?.decision);
}

export const portalImportDecisionContract = Object.freeze({
  sourceKey: SOURCE_KEY,
  decisionKind: DECISION_KIND
});
