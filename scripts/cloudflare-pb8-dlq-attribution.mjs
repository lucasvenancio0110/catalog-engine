import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryD1Batch } from '../worker/cloudflare-platform.js';

const API_ORIGIN = 'https://api.cloudflare.com';
const MERCHANT = String(process.env.PB8_MERCHANT_DISPLAY_NAME || 'CROCCODILOS').trim();
const DETAIL_DLQ = 'catalog-engine-import-detail-dlq';
const DISPATCH_NAMESPACE = 'catalog-engine-production';

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name}_missing`);
  return value;
}

async function runtimeConfig() {
  const raw = await fs.readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const config = JSON.parse(raw);
  const database = (config.d1_databases || []).find((entry) => entry?.binding === 'CATALOG_DB');
  if (!database?.database_id) throw new Error('pb8_dlq_control_database_missing');
  return { databaseId: String(database.database_id) };
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
  if (!response) throw new Error('pb8_dlq_cloudflare_unreachable');
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) throw new Error('pb8_dlq_cloudflare_query_failed');
  return payload.result ?? null;
}

async function targetIdentity({ accountId, apiToken, databaseId }) {
  const result = await queryD1Batch({
    accountId,
    apiToken,
    dispatchNamespace: DISPATCH_NAMESPACE,
    databaseId,
    batch: [
      {
        sql: `SELECT t.tenant_id,j.import_id
                FROM catalog_tenants t
                JOIN tenant_import_jobs j ON j.tenant_id=t.tenant_id
               WHERE UPPER(t.display_name)=UPPER(?1)
                 AND t.status='active'
                 AND j.source_key='primary'
                 AND j.mode='initial'
               ORDER BY j.created_at DESC
               LIMIT 2`,
        params: [MERCHANT]
      }
    ]
  });
  const rows = result?.[0]?.results || [];
  if (rows.length !== 1) throw new Error('pb8_dlq_merchant_identity_ambiguous');
  const row = rows[0];
  if (!/^t_[a-f0-9]{20}$/.test(String(row.tenant_id || ''))) {
    throw new Error('pb8_dlq_tenant_identity_invalid');
  }
  if (!/^imp_[a-f0-9]{20}$/.test(String(row.import_id || ''))) {
    throw new Error('pb8_dlq_import_identity_invalid');
  }
  return { tenantId: row.tenant_id, importId: row.import_id };
}

async function detailDlqId(accountId, apiToken) {
  const queues = await cfRequest(
    accountId,
    apiToken,
    `/client/v4/accounts/${accountId}/queues?per_page=100`,
    { method: 'GET' }
  );
  const row = (Array.isArray(queues) ? queues : []).find(
    (entry) => String(entry?.queue_name || entry?.name || '') === DETAIL_DLQ
  );
  const id = String(row?.queue_id || row?.id || '').trim();
  if (!id) throw new Error('pb8_dlq_queue_missing');
  return id;
}

function decodeBody(body) {
  if (body && typeof body === 'object') return body;
  const text = String(body || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function attributePeekedMessages(messages, target) {
  const summary = {
    peeked: 0,
    targetMerchant: 0,
    otherTenantOrImport: 0,
    invalidBody: 0,
    detailMessages: 0,
    otherMessageTypes: 0,
    attempts: {}
  };

  for (const message of messages || []) {
    summary.peeked += 1;
    const body = decodeBody(message?.body);
    if (!body || typeof body !== 'object') {
      summary.invalidBody += 1;
      continue;
    }
    const type = String(body.type || '');
    if (type === 'detail') summary.detailMessages += 1;
    else summary.otherMessageTypes += 1;

    const isTarget =
      String(body.tenantId || '') === target.tenantId &&
      String(body.importId || '') === target.importId;
    if (isTarget) summary.targetMerchant += 1;
    else summary.otherTenantOrImport += 1;

    const attempts = Math.max(0, Math.floor(Number(message?.attempts || 0)));
    const bucket = String(attempts);
    summary.attempts[bucket] = (summary.attempts[bucket] || 0) + 1;
  }
  return summary;
}

function assertSafeEvidence(evidence) {
  const serialized = JSON.stringify(evidence);
  if (/t_[a-f0-9]{20}|imp_[a-f0-9]{20}|https?:\/\/|yupoo\.com|albumSourceId|lease_id|\"ref\"/i.test(serialized)) {
    throw new Error('pb8_dlq_private_evidence_leak');
  }
}

export async function runPb8DlqAttribution() {
  const accountId = requiredEnv('CLOUDFLARE_ACCOUNT_ID');
  const apiToken = requiredEnv('CLOUDFLARE_API_TOKEN');
  const { databaseId } = await runtimeConfig();
  const target = await targetIdentity({ accountId, apiToken, databaseId });
  const queueId = await detailDlqId(accountId, apiToken);

  // Cloudflare's official Queue peek endpoint is deliberately non-destructive:
  // messages are not leased, acknowledged, retried or purged by this diagnostic.
  const result = await cfRequest(
    accountId,
    apiToken,
    `/client/v4/accounts/${accountId}/queues/${encodeURIComponent(queueId)}/messages/peek`,
    { method: 'POST', body: JSON.stringify({ batch_size: 100 }) }
  );
  const messages = Array.isArray(result?.messages) ? result.messages : [];
  const attribution = attributePeekedMessages(messages, target);
  const evidence = {
    pb8DlqAttribution: 'observed',
    merchant: MERCHANT.slice(0, 80),
    queue: 'detail-dlq',
    ...attribution,
    nonDestructivePeek: true,
    privateIdentifiersExposed: false
  };
  assertSafeEvidence(evidence);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  runPb8DlqAttribution().catch((error) => {
    console.error(String(error?.message || error).slice(0, 120));
    process.exitCode = 1;
  });
}
