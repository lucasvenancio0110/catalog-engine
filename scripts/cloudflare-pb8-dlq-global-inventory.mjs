import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryD1Batch } from '../worker/cloudflare-platform.js';

const API_ORIGIN = 'https://api.cloudflare.com';
const DETAIL_DLQ = 'catalog-engine-import-detail-dlq';
const DISPATCH_NAMESPACE = 'catalog-engine-production';
const ACTIVE_IMPORT_STATUSES = new Set(['pending', 'queued', 'scanning', 'details', 'finalizing']);
const TERMINAL_FAILURE_STATUSES = new Set(['failed', 'cancelled']);

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name}_missing`);
  return value;
}

async function runtimeConfig() {
  const raw = await fs.readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const config = JSON.parse(raw);
  const database = (config.d1_databases || []).find((entry) => entry?.binding === 'CATALOG_DB');
  if (!database?.database_id) throw new Error('pb8_dlq_inventory_control_database_missing');
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
  if (!response) throw new Error('pb8_dlq_inventory_cloudflare_unreachable');
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) throw new Error('pb8_dlq_inventory_query_failed');
  return payload.result ?? null;
}

async function detailDlqId(accountId, apiToken) {
  const queues = await cfRequest(accountId, apiToken, `/client/v4/accounts/${accountId}/queues?per_page=100`, { method: 'GET' });
  const row = (Array.isArray(queues) ? queues : []).find(
    (entry) => String(entry?.queue_name || entry?.name || '') === DETAIL_DLQ
  );
  const id = String(row?.queue_id || row?.id || '').trim();
  if (!id) throw new Error('pb8_dlq_inventory_queue_missing');
  return id;
}

function decodeBody(body) {
  if (body && typeof body === 'object') return body;
  try {
    return JSON.parse(String(body || ''));
  } catch {
    return null;
  }
}

function validIdentity(body) {
  return (
    /^t_[a-f0-9]{20}$/.test(String(body?.tenantId || '')) &&
    /^imp_[a-f0-9]{20}$/.test(String(body?.importId || '')) &&
    /^[a-z0-9][a-z0-9-]{0,39}$/.test(String(body?.sourceKey || ''))
  );
}

export function collectInventoryCandidates(messages = []) {
  const counters = {
    peeked: messages.length,
    malformedBody: 0,
    otherMessageType: 0,
    malformedIdentity: 0
  };
  const candidates = [];
  for (let index = 0; index < messages.length; index += 1) {
    const body = decodeBody(messages[index]?.body);
    if (!body || typeof body !== 'object') {
      counters.malformedBody += 1;
      continue;
    }
    if (String(body.type || '') !== 'detail') {
      counters.otherMessageType += 1;
      continue;
    }
    if (!validIdentity(body)) {
      counters.malformedIdentity += 1;
      continue;
    }
    candidates.push({
      index,
      tenantId: String(body.tenantId),
      importId: String(body.importId),
      sourceKey: String(body.sourceKey)
    });
  }
  return { counters, candidates };
}

export function summarizeInventory(candidates = [], rows = []) {
  const summary = {
    candidateMessages: candidates.length,
    activeImport: 0,
    terminalSuccess: 0,
    terminalFailure: 0,
    missingImportJob: 0,
    inconsistentTerminal: 0,
    modes: { initial: 0, incremental: 0, recovery: 0, unknown: 0 }
  };
  for (let index = 0; index < candidates.length; index += 1) {
    const row = rows[index] || null;
    if (!row) {
      summary.missingImportJob += 1;
      continue;
    }
    const mode = ['initial', 'incremental', 'recovery'].includes(String(row.mode || ''))
      ? String(row.mode)
      : 'unknown';
    summary.modes[mode] += 1;
    const status = String(row.status || '');
    const phase = String(row.phase || '');
    if (ACTIVE_IMPORT_STATUSES.has(status)) summary.activeImport += 1;
    else if (status === 'success' && phase === 'complete') summary.terminalSuccess += 1;
    else if (TERMINAL_FAILURE_STATUSES.has(status)) summary.terminalFailure += 1;
    else summary.inconsistentTerminal += 1;
  }
  return summary;
}

async function readImportRows({ accountId, apiToken, databaseId, candidates }) {
  if (!candidates.length) return [];
  const batch = candidates.map((candidate) => ({
    sql: `SELECT status,phase,mode
            FROM tenant_import_jobs
           WHERE tenant_id=?1 AND import_id=?2 AND source_key=?3
           LIMIT 1`,
    params: [candidate.tenantId, candidate.importId, candidate.sourceKey]
  }));
  const result = await queryD1Batch({
    accountId,
    apiToken,
    dispatchNamespace: DISPATCH_NAMESPACE,
    databaseId,
    batch
  });
  return batch.map((_, index) => result?.[index]?.results?.[0] || null);
}

function assertSafeEvidence(evidence) {
  const serialized = JSON.stringify(evidence);
  if (/t_[a-f0-9]{20}|imp_[a-f0-9]{20}|https?:\/\/|yupoo\.com|albumSourceId|sourceKey|tenantId|importId|d1_database_id|worker_script|dispatch_namespace/i.test(serialized)) {
    throw new Error('pb8_dlq_inventory_private_evidence_leak');
  }
}

export async function runPb8DlqGlobalInventory() {
  const accountId = requiredEnv('CLOUDFLARE_ACCOUNT_ID');
  const apiToken = requiredEnv('CLOUDFLARE_API_TOKEN');
  const { databaseId } = await runtimeConfig();
  const queueId = await detailDlqId(accountId, apiToken);
  const result = await cfRequest(
    accountId,
    apiToken,
    `/client/v4/accounts/${accountId}/queues/${encodeURIComponent(queueId)}/messages/peek`,
    { method: 'POST', body: JSON.stringify({ batch_size: 100 }) }
  );
  const messages = Array.isArray(result?.messages) ? result.messages : [];
  const { counters, candidates } = collectInventoryCandidates(messages);
  const rows = await readImportRows({ accountId, apiToken, databaseId, candidates });
  const evidence = {
    pb8DlqGlobalInventory: 'observed',
    queue: 'detail-dlq',
    ...counters,
    ...summarizeInventory(candidates, rows),
    nonDestructivePeek: true,
    privateIdentifiersExposed: false
  };
  assertSafeEvidence(evidence);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  runPb8DlqGlobalInventory().catch((error) => {
    console.error(String(error?.message || error).slice(0, 120));
    process.exitCode = 1;
  });
}
