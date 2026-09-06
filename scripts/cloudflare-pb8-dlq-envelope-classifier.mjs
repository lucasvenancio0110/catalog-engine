import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_ORIGIN = 'https://api.cloudflare.com';
const DETAIL_DLQ = 'catalog-engine-import-detail-dlq';
const KNOWN_TYPES = new Set(['scan', 'detail', 'finalize']);

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name}_missing`);
  return value;
}

async function cfRequest(accountId, apiToken, pathname, init = {}) {
  const response = await fetch(new URL(pathname, API_ORIGIN), {
    ...init,
    redirect: 'error',
    headers: {
      authorization: `Bearer ${apiToken}`,
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {})
    }
  }).catch(() => null);
  const payload = await response?.json().catch(() => null);
  if (!response?.ok || payload?.success !== true) throw new Error('pb8_dlq_envelope_cloudflare_query_failed');
  return payload.result ?? null;
}

async function queueId(accountId, apiToken) {
  const queues = await cfRequest(accountId, apiToken, `/client/v4/accounts/${accountId}/queues?per_page=100`, { method: 'GET' });
  const row = (Array.isArray(queues) ? queues : []).find((entry) => String(entry?.queue_name || entry?.name || '') === DETAIL_DLQ);
  const id = String(row?.queue_id || row?.id || '').trim();
  if (!id) throw new Error('pb8_dlq_envelope_queue_missing');
  return id;
}

function decode(body) {
  if (body && typeof body === 'object') return body;
  try { return JSON.parse(String(body || '')); } catch { return null; }
}

function classifyObject(body) {
  const type = String(body?.type || '');
  if (KNOWN_TYPES.has(type)) return `top-${type}`;
  if (body?.body && typeof body.body === 'object') {
    const nested = String(body.body.type || '');
    if (KNOWN_TYPES.has(nested)) return `nested-body-${nested}`;
    return 'nested-body-unknown';
  }
  if (body?.message && typeof body.message === 'object') {
    const nested = String(body.message.type || '');
    if (KNOWN_TYPES.has(nested)) return `nested-message-${nested}`;
    return 'nested-message-unknown';
  }
  if (body?.payload && typeof body.payload === 'object') {
    const nested = String(body.payload.type || '');
    if (KNOWN_TYPES.has(nested)) return `nested-payload-${nested}`;
    return 'nested-payload-unknown';
  }
  return type ? 'top-unknown-type' : 'top-missing-type';
}

export function summarizeEnvelopeClasses(messages = []) {
  const summary = { peeked: messages.length, invalidJson: 0, classes: {}, hasTopLevelIdentityFields: 0 };
  for (const message of messages) {
    const body = decode(message?.body);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      summary.invalidJson += 1;
      continue;
    }
    const cls = classifyObject(body);
    summary.classes[cls] = (summary.classes[cls] || 0) + 1;
    if ('tenantId' in body || 'importId' in body || 'sourceKey' in body) summary.hasTopLevelIdentityFields += 1;
  }
  return summary;
}

function safeEvidence(value) {
  const text = JSON.stringify(value);
  if (/t_[a-f0-9]{20}|imp_[a-f0-9]{20}|https?:\/\/|yupoo\.com|albumSourceId|\"ref\"|sourceUrl|credential|token/i.test(text)) {
    throw new Error('pb8_dlq_envelope_private_evidence_leak');
  }
  return value;
}

export async function runPb8DlqEnvelopeClassifier() {
  const accountId = requiredEnv('CLOUDFLARE_ACCOUNT_ID');
  const apiToken = requiredEnv('CLOUDFLARE_API_TOKEN');
  const id = await queueId(accountId, apiToken);
  const result = await cfRequest(accountId, apiToken, `/client/v4/accounts/${accountId}/queues/${encodeURIComponent(id)}/messages/peek`, {
    method: 'POST', body: JSON.stringify({ batch_size: 100 })
  });
  const messages = Array.isArray(result?.messages) ? result.messages : [];
  const evidence = safeEvidence({
    pb8DlqEnvelopeClassifier: 'observed',
    queue: 'detail-dlq',
    ...summarizeEnvelopeClasses(messages),
    nonDestructivePeek: true,
    privateIdentifiersExposed: false
  });
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  runPb8DlqEnvelopeClassifier().catch((error) => {
    console.error(String(error?.message || error).slice(0, 120));
    process.exitCode = 1;
  });
}
