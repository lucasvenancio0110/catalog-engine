import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_ORIGIN = 'https://api.cloudflare.com';
const DETAIL_DLQ = 'catalog-engine-import-detail-dlq';
const PEEK_BATCH_SIZE = 20;

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
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {})
    }
  }).catch(() => null);
  if (!response) throw new Error('pb8_dlq_shape_cloudflare_unreachable');
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) throw new Error('pb8_dlq_shape_cloudflare_query_failed');
  return payload.result ?? null;
}

async function detailDlqId(accountId, apiToken) {
  const queues = await cfRequest(accountId, apiToken, `/client/v4/accounts/${accountId}/queues?per_page=100`, { method: 'GET' });
  const row = (Array.isArray(queues) ? queues : []).find(
    (entry) => String(entry?.queue_name || entry?.name || '') === DETAIL_DLQ
  );
  const id = String(row?.queue_id || row?.id || '').trim();
  if (!id) throw new Error('pb8_dlq_shape_queue_missing');
  return id;
}

function bodyShape(body) {
  if (body === null) return 'null';
  if (Array.isArray(body)) return 'array';
  return typeof body;
}

function safeMetadataClass(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return 'none';
  const contentType = String(metadata['CF-Content-Type'] || metadata['cf-content-type'] || '').trim().toLowerCase();
  if (!contentType) return 'metadata-other';
  if (contentType === 'json') return 'json';
  if (contentType === 'text') return 'text';
  if (contentType === 'bytes') return 'bytes';
  if (contentType === 'v8') return 'v8';
  return 'content-type-other';
}

export function summarizePeekShapes(messages = []) {
  const summary = {
    peeked: messages.length,
    withRef: 0,
    bodyShapes: {},
    metadataClasses: {},
    stringBodyJsonParseable: 0,
    stringBodyNotJson: 0,
    stringBodyEmpty: 0
  };

  for (const message of messages) {
    if (String(message?.ref || '').trim()) summary.withRef += 1;

    const shape = bodyShape(message?.body);
    summary.bodyShapes[shape] = (summary.bodyShapes[shape] || 0) + 1;

    const metadataClass = safeMetadataClass(message?.metadata);
    summary.metadataClasses[metadataClass] = (summary.metadataClasses[metadataClass] || 0) + 1;

    if (typeof message?.body === 'string') {
      if (!message.body.length) {
        summary.stringBodyEmpty += 1;
        continue;
      }
      try {
        JSON.parse(message.body);
        summary.stringBodyJsonParseable += 1;
      } catch {
        summary.stringBodyNotJson += 1;
      }
    }
  }

  return summary;
}

function safeEvidence(evidence) {
  const serialized = JSON.stringify(evidence);
  if (/t_[a-f0-9]{20}|imp_[a-f0-9]{20}|https?:\/\/|yupoo\.com|albumSourceId|sourceKey|tenantId|importId|\"ref\"|d1_database_id|worker_script|dispatch_namespace/i.test(serialized)) {
    throw new Error('pb8_dlq_shape_private_evidence_leak');
  }
  return evidence;
}

export async function runPb8DlqPeekShape() {
  await fs.access(new URL('../wrangler.jsonc', import.meta.url));
  const accountId = requiredEnv('CLOUDFLARE_ACCOUNT_ID');
  const apiToken = requiredEnv('CLOUDFLARE_API_TOKEN');
  const queueId = await detailDlqId(accountId, apiToken);
  const result = await cfRequest(
    accountId,
    apiToken,
    `/client/v4/accounts/${accountId}/queues/${encodeURIComponent(queueId)}/messages/peek`,
    { method: 'POST', body: JSON.stringify({ batch_size: PEEK_BATCH_SIZE }) }
  );
  const messages = Array.isArray(result?.messages) ? result.messages : [];
  const evidence = safeEvidence({
    pb8DlqPeekShape: 'observed',
    queue: 'detail-dlq',
    ...summarizePeekShapes(messages),
    nonDestructivePeek: true,
    privateIdentifiersExposed: false
  });
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  runPb8DlqPeekShape().catch((error) => {
    console.error(String(error?.message || error).slice(0, 120));
    process.exitCode = 1;
  });
}
