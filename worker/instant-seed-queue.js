const MESSAGE_VERSION = 1;
const TENANT_ID_PATTERN = /^t_[a-f0-9]{20}$/;
const SOURCE_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ALLOWED_KEYS = new Set(['v', 'type', 'tenantId', 'sourceKey']);

function invalid() {
  return Object.assign(new Error('instant_seed_message_invalid'), {
    code: 'instant_seed_message_invalid'
  });
}

export function buildInstantSeedMessage({ tenantId, sourceKey = 'primary' } = {}) {
  const tenant = String(tenantId || '').trim().toLowerCase();
  const source = String(sourceKey || '').trim().toLowerCase();
  if (!TENANT_ID_PATTERN.test(tenant) || !SOURCE_KEY_PATTERN.test(source)) throw invalid();
  return Object.freeze({
    v: MESSAGE_VERSION,
    type: 'instant-seed',
    tenantId: tenant,
    sourceKey: source
  });
}

export function parseInstantSeedMessage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  for (const key of Object.keys(value)) {
    if (!ALLOWED_KEYS.has(key)) throw invalid();
  }
  if (value.v !== MESSAGE_VERSION || value.type !== 'instant-seed') throw invalid();
  return buildInstantSeedMessage(value);
}

export function assertPublicSafeInstantSeedMessage(value) {
  const message = parseInstantSeedMessage(value);
  const serialized = JSON.stringify(message);
  if (/https?:\/\/|yupoo|sourceUrl|source_locator|provider|token|secret|d1|worker/i.test(serialized)) {
    throw invalid();
  }
  return message;
}

export const instantSeedQueueContract = Object.freeze({
  version: MESSAGE_VERSION,
  type: 'instant-seed'
});
