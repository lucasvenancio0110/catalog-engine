import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryD1Batch } from '../worker/cloudflare-platform.js';

const API_ORIGIN = 'https://api.cloudflare.com';
const MERCHANT = String(process.env.PB8_MERCHANT_DISPLAY_NAME || 'CROCCODILOS').trim();
const DETAIL_DLQ = 'catalog-engine-import-detail-dlq';
const DISPATCH_NAMESPACE = 'catalog-engine-production';
const SOURCE_KEY = 'primary';

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name}_missing`);
  return value;
}

function safeCode(value) {
  const code = String(value || '').trim().toLowerCase();
  return /^[a-z0-9_]{1,80}$/.test(code) ? code : code ? 'other' : 'none';
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
    batch: [{
      sql: `SELECT t.tenant_id,j.import_id,p.d1_database_id
              FROM catalog_tenants t
              JOIN tenant_import_jobs j ON j.tenant_id=t.tenant_id
              JOIN tenant_data_plane_provider_state p ON p.tenant_id=t.tenant_id
             WHERE UPPER(t.display_name)=UPPER(?1)
               AND t.status='active'
               AND j.source_key=?2
               AND j.mode='initial'
             ORDER BY j.created_at DESC
             LIMIT 2`,
      params: [MERCHANT, SOURCE_KEY]
    }]
  });
  const rows = result?.[0]?.results || [];
  if (rows.length !== 1) throw new Error('pb8_dlq_merchant_identity_ambiguous');
  const row = rows[0];
  if (!/^t_[a-f0-9]{20}$/.test(String(row.tenant_id || ''))) throw new Error('pb8_dlq_tenant_identity_invalid');
  if (!/^imp_[a-f0-9]{20}$/.test(String(row.import_id || ''))) throw new Error('pb8_dlq_import_identity_invalid');
  if (!/^[a-f0-9-]{32,40}$/i.test(String(row.d1_database_id || ''))) throw new Error('pb8_dlq_tenant_database_invalid');
  return { tenantId: row.tenant_id, importId: row.import_id, tenantDatabaseId: row.d1_database_id };
}

async function detailDlqId(accountId, apiToken) {
  const queues = await cfRequest(accountId, apiToken, `/client/v4/accounts/${accountId}/queues?per_page=100`, { method: 'GET' });
  const row = (Array.isArray(queues) ? queues : []).find((entry) => String(entry?.queue_name || entry?.name || '') === DETAIL_DLQ);
  const id = String(row?.queue_id || row?.id || '').trim();
  if (!id) throw new Error('pb8_dlq_queue_missing');
  return id;
}

function decodeBody(body) {
  if (body && typeof body === 'object') return body;
  try { return JSON.parse(String(body || '')); } catch { return null; }
}

export function collectTargetRefs(messages, target) {
  const refs = [];
  let malformedTargetRef = 0;
  for (const message of messages || []) {
    const body = decodeBody(message?.body);
    if (!body || typeof body !== 'object') continue;
    if (String(body.type || '') !== 'detail') continue;
    if (String(body.tenantId || '') !== target.tenantId || String(body.importId || '') !== target.importId) continue;
    const ref = String(body.albumSourceId || '').trim();
    if (!ref || ref.length > 500) { malformedTargetRef += 1; continue; }
    refs.push(ref);
  }
  return { refs: [...new Set(refs)].slice(0, 100), malformedTargetRef };
}

export function summarizeDurableRows(rows, expectedRefs = 0) {
  const states = {};
  const errors = {};
  let matched = 0;
  for (const row of rows || []) {
    const count = Math.max(0, Math.floor(Number(row.total || 0)));
    matched += count;
    const state = safeCode(row.state || 'unknown');
    const error = safeCode(row.last_error_code);
    states[state] = (states[state] || 0) + count;
    if (error !== 'none') errors[error] = (errors[error] || 0) + count;
  }
  return {
    expectedRefs,
    matched,
    missingDurableState: Math.max(0, expectedRefs - matched),
    states,
    errors
  };
}

async function durableDiagnosis({ accountId, apiToken, databaseId, target, refs }) {
  if (!refs.length) return summarizeDurableRows([], 0);
  const placeholders = refs.map((_, index) => `?${index + 4}`).join(',');
  const result = await queryD1Batch({
    accountId,
    apiToken,
    dispatchNamespace: DISPATCH_NAMESPACE,
    databaseId,
    batch: [{
      sql: `SELECT state,last_error_code,COUNT(*) AS total
              FROM supplier_album_detail_state
             WHERE tenant_id=?1 AND source_key=?2 AND import_id=?3
               AND album_source_id IN (${placeholders})
             GROUP BY state,last_error_code
             ORDER BY state,last_error_code`,
      params: [target.tenantId, SOURCE_KEY, target.importId, ...refs]
    }]
  });
  return summarizeDurableRows(result?.[0]?.results || [], refs.length);
}

function assertSafeEvidence(evidence) {
  const serialized = JSON.stringify(evidence);
  if (/t_[a-f0-9]{20}|imp_[a-f0-9]{20}|https?:\/\/|yupoo\.com|albumSourceId|\"ref\"|d1_database_id|worker_script|dispatch_namespace/i.test(serialized)) {
    throw new Error('pb8_dlq_private_evidence_leak');
  }
}

export async function runPb8DlqDurableDiagnosis() {
  const accountId = requiredEnv('CLOUDFLARE_ACCOUNT_ID');
  const apiToken = requiredEnv('CLOUDFLARE_API_TOKEN');
  const { databaseId } = await runtimeConfig();
  const target = await targetIdentity({ accountId, apiToken, databaseId });
  const queueId = await detailDlqId(accountId, apiToken);
  const result = await cfRequest(accountId, apiToken, `/client/v4/accounts/${accountId}/queues/${encodeURIComponent(queueId)}/messages/peek`, {
    method: 'POST',
    body: JSON.stringify({ batch_size: 100 })
  });
  const messages = Array.isArray(result?.messages) ? result.messages : [];
  const { refs, malformedTargetRef } = collectTargetRefs(messages, target);
  const durable = await durableDiagnosis({
    accountId,
    apiToken,
    databaseId: target.tenantDatabaseId,
    target,
    refs
  });
  const evidence = {
    pb8DlqDurableDiagnosis: 'observed',
    merchant: MERCHANT.slice(0, 80),
    queue: 'detail-dlq',
    peeked: messages.length,
    targetRefs: refs.length,
    malformedTargetRef,
    durable,
    nonDestructivePeek: true,
    privateIdentifiersExposed: false
  };
  assertSafeEvidence(evidence);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  runPb8DlqDurableDiagnosis().catch((error) => {
    console.error(String(error?.message || error).slice(0, 120));
    process.exitCode = 1;
  });
}
