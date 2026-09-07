const TENANT_ID_PATTERN = /^t_[a-f0-9]{20}$/;
const STAGES = new Set(['source', 'preparing', 'discovering', 'importing', 'finalizing', 'organizing', 'checking', 'ready']);
const STATUSES = new Set(['waiting', 'running', 'attention', 'complete']);
const COUNTER_KEYS = new Set([
  'discovered',
  'queued',
  'completed',
  'failed',
  'deferred',
  'published',
  'total',
  'processed',
  'automatic',
  'review',
  'unknown',
  'checked',
  'findings'
]);
const TIMING_KEYS = new Set([
  'importStartedMs',
  'listingScannedMs',
  'importCompletedMs',
  'classificationCompletedMs',
  'verificationCompletedMs'
]);

export class PortalProvisioningProgressError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.name = 'PortalProvisioningProgressError';
    this.code = code;
    this.status = status;
  }
}

function validateTenantId(tenantId) {
  const value = String(tenantId || '').trim();
  if (!TENANT_ID_PATTERN.test(value)) {
    throw new PortalProvisioningProgressError('store_not_found', 404);
  }
  return value;
}

function safeText(value, maximum) {
  const text = String(value || '').trim();
  if (!text || text.length > maximum) throw new PortalProvisioningProgressError('progress_state_invalid', 502);
  return text;
}

function boundedInteger(value, maximum = 10_000_000) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > maximum) {
    throw new PortalProvisioningProgressError('progress_state_invalid', 502);
  }
  return parsed;
}

function safeCounters(input) {
  if (input == null) return null;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new PortalProvisioningProgressError('progress_state_invalid', 502);
  }
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    if (!COUNTER_KEYS.has(key)) throw new PortalProvisioningProgressError('progress_state_invalid', 502);
    result[key] = boundedInteger(value);
  }
  return Object.keys(result).length ? result : null;
}

function safeTiming(input) {
  if (input == null) return null;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new PortalProvisioningProgressError('progress_state_invalid', 502);
  }
  if (input.contract !== 'instant-catalog-baseline-v1') {
    throw new PortalProvisioningProgressError('progress_state_invalid', 502);
  }
  const milestones = input.milestones;
  if (!milestones || typeof milestones !== 'object' || Array.isArray(milestones)) {
    throw new PortalProvisioningProgressError('progress_state_invalid', 502);
  }
  const normalizedMilestones = {};
  for (const [key, value] of Object.entries(milestones)) {
    if (!TIMING_KEYS.has(key)) throw new PortalProvisioningProgressError('progress_state_invalid', 502);
    normalizedMilestones[key] = boundedInteger(value, 1000 * 60 * 60 * 24 * 30);
  }
  return {
    contract: 'instant-catalog-baseline-v1',
    elapsedMs: boundedInteger(input.elapsedMs, 1000 * 60 * 60 * 24 * 30),
    milestones: normalizedMilestones
  };
}

export function normalizePortalProvisioningProgress(input) {
  if (!input || Number(input.version) !== 1 || !STAGES.has(input.stage) || !STATUSES.has(input.status)) {
    throw new PortalProvisioningProgressError('progress_state_invalid', 502);
  }
  const pollAfterMs = Number(input.pollAfterMs);
  if (!Number.isInteger(pollAfterMs) || pollAfterMs < 5000 || pollAfterMs > 30000) {
    throw new PortalProvisioningProgressError('progress_state_invalid', 502);
  }
  let retry = null;
  if (input.retry != null) {
    if (input.retry?.kind !== 'automatic' || !String(input.retry?.scheduledAt || '').trim()) {
      throw new PortalProvisioningProgressError('progress_state_invalid', 502);
    }
    retry = { kind: 'automatic', scheduledAt: String(input.retry.scheduledAt) };
  }
  return {
    version: 1,
    stage: input.stage,
    status: input.status,
    title: safeText(input.title, 96),
    message: safeText(input.message, 320),
    counters: safeCounters(input.counters),
    retry,
    timing: safeTiming(input.timing),
    updatedAt: String(input.updatedAt || '').trim() || null,
    pollAfterMs
  };
}

async function payload(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export async function requestPortalProvisioningProgress({ tenantId, token, fetchImpl = fetch }) {
  const safeTenantId = validateTenantId(tenantId);
  if (!String(token || '').trim()) throw new PortalProvisioningProgressError('unauthorized', 401);
  const response = await fetchImpl(`/api/admin/stores/${safeTenantId}/onboarding`, {
    method: 'GET',
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}` }
  });
  const body = await payload(response);
  if (!response.ok) {
    throw new PortalProvisioningProgressError(
      String(body?.error || 'progress_state_unavailable').trim().toLowerCase(),
      response.status
    );
  }
  return normalizePortalProvisioningProgress(body?.progress);
}
