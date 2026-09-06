import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryD1Batch } from '../worker/cloudflare-platform.js';

const API_ORIGIN = 'https://api.cloudflare.com';
const DETAIL_DLQ = 'catalog-engine-import-detail-dlq';
const DISPATCH_NAMESPACE = 'catalog-engine-production';
const MAX_PURGED_PER_RUN = 10;
const PEEK_BATCH_SIZE = 20;
const MAX_ROUNDS = 10;
const CLEANABLE_MESSAGE_TYPES = new Set(['detail', 'finalize']);

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name}_missing`);
  return value;
}

async function runtimeConfig() {
  const raw = await fs.readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const config = JSON.parse(raw);
  const database = (config.d1_databases || []).find((entry) => entry?.binding === 'CATALOG_DB');
  if (!database?.database_id) throw new Error('pb8_dlq_cleanup_control_database_missing');
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
  if (!response) throw new Error('pb8_dlq_cleanup_cloudflare_unreachable');
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) throw new Error('pb8_dlq_cleanup_cloudflare_query_failed');
  return payload.result ?? null;
}

async function detailDlqId(accountId, apiToken) {
  const queues = await cfRequest(accountId, apiToken, `/client/v4/accounts/${accountId}/queues?per_page=100`, { method: 'GET' });
  const row = (Array.isArray(queues) ? queues : []).find(
    (entry) => String(entry?.queue_name || entry?.name || '') === DETAIL_DLQ
  );
  const id = String(row?.queue_id || row?.id || '').trim();
  if (!id) throw new Error('pb8_dlq_cleanup_queue_missing');
  return id;
}

function decodeBody(body) {
  if (body && typeof body === 'object') return body;
  try { return JSON.parse(String(body || '')); } catch { return null; }
}

function validIdentity(body) {
  return (
    /^t_[a-f0-9]{20}$/.test(String(body?.tenantId || '')) &&
    /^imp_[a-f0-9]{20}$/.test(String(body?.importId || '')) &&
    /^[a-z0-9][a-z0-9-]{0,39}$/.test(String(body?.sourceKey || ''))
  );
}

export function cleanupCandidates(messages = []) {
  const candidates = [];
  let malformed = 0;
  const messageTypes = { detail: 0, finalize: 0 };
  for (const message of messages) {
    const body = decodeBody(message?.body);
    const ref = String(message?.ref || '').trim();
    const type = String(body?.type || '');
    if (
      !body || typeof body !== 'object' || !CLEANABLE_MESSAGE_TYPES.has(type) ||
      !validIdentity(body) || !ref
    ) {
      malformed += 1;
      continue;
    }
    messageTypes[type] += 1;
    candidates.push({
      tenantId: String(body.tenantId),
      importId: String(body.importId),
      sourceKey: String(body.sourceKey),
      type,
      ref
    });
  }
  return { candidates, malformed, messageTypes };
}

export function selectTerminalSuccessRefs(candidates = [], rows = [], limit = MAX_PURGED_PER_RUN) {
  const refs = [];
  const counts = {
    terminalSuccess: 0,
    activeOrOther: 0,
    missingAuthority: 0
  };
  const bounded = Math.max(0, Math.min(MAX_PURGED_PER_RUN, Number(limit) || 0));
  for (let index = 0; index < candidates.length; index += 1) {
    const row = rows[index] || null;
    if (!row) {
      counts.missingAuthority += 1;
      continue;
    }
    if (String(row.status || '') === 'success' && String(row.phase || '') === 'complete') {
      counts.terminalSuccess += 1;
      if (refs.length < bounded) refs.push(candidates[index].ref);
    } else {
      counts.activeOrOther += 1;
    }
  }
  return { refs, counts };
}

async function authorityRows({ accountId, apiToken, databaseId, candidates }) {
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

function safeEvidence(evidence) {
  const serialized = JSON.stringify(evidence);
  if (/t_[a-f0-9]{20}|imp_[a-f0-9]{20}|https?:\/\/|yupoo\.com|albumSourceId|sourceKey|tenantId|importId|\"ref\"|d1_database_id|worker_script|dispatch_namespace/i.test(serialized)) {
    throw new Error('pb8_dlq_cleanup_private_evidence_leak');
  }
  return evidence;
}

export async function runPb8TerminalDlqCleanup() {
  const accountId = requiredEnv('CLOUDFLARE_ACCOUNT_ID');
  const apiToken = requiredEnv('CLOUDFLARE_API_TOKEN');
  const { databaseId } = await runtimeConfig();
  const queueId = await detailDlqId(accountId, apiToken);

  let purged = 0;
  let rounds = 0;
  let peeked = 0;
  let malformed = 0;
  let detailSeen = 0;
  let finalizeSeen = 0;
  let terminalSuccessSeen = 0;
  let activeOrOtherSeen = 0;
  let missingAuthoritySeen = 0;
  let stoppedBecauseNoSafeRefs = false;

  while (rounds < MAX_ROUNDS && purged < MAX_PURGED_PER_RUN) {
    rounds += 1;
    const peek = await cfRequest(
      accountId,
      apiToken,
      `/client/v4/accounts/${accountId}/queues/${encodeURIComponent(queueId)}/messages/peek`,
      { method: 'POST', body: JSON.stringify({ batch_size: PEEK_BATCH_SIZE }) }
    );
    const messages = Array.isArray(peek?.messages) ? peek.messages : [];
    peeked += messages.length;
    if (!messages.length) break;

    const parsed = cleanupCandidates(messages);
    malformed += parsed.malformed;
    detailSeen += parsed.messageTypes.detail;
    finalizeSeen += parsed.messageTypes.finalize;
    const rows = await authorityRows({ accountId, apiToken, databaseId, candidates: parsed.candidates });
    const selected = selectTerminalSuccessRefs(
      parsed.candidates,
      rows,
      MAX_PURGED_PER_RUN - purged
    );
    terminalSuccessSeen += selected.counts.terminalSuccess;
    activeOrOtherSeen += selected.counts.activeOrOther;
    missingAuthoritySeen += selected.counts.missingAuthority;

    if (!selected.refs.length) {
      stoppedBecauseNoSafeRefs = true;
      break;
    }

    const purge = await cfRequest(
      accountId,
      apiToken,
      `/client/v4/accounts/${accountId}/queues/${encodeURIComponent(queueId)}/messages/purge`,
      {
        method: 'POST',
        body: JSON.stringify({ refs: selected.refs.map((ref) => ({ ref })) })
      }
    );
    const errors = Array.isArray(purge?.errors) ? purge.errors : [];
    const warnings = purge?.warnings && typeof purge.warnings === 'object'
      ? Object.keys(purge.warnings)
      : [];
    if (errors.length || warnings.length) throw new Error('pb8_dlq_cleanup_partial_purge');
    purged += selected.refs.length;
  }

  const evidence = safeEvidence({
    pb8TerminalDlqCleanup: 'completed',
    queue: 'detail-dlq',
    rounds,
    peeked,
    purged,
    maxPurgedPerRun: MAX_PURGED_PER_RUN,
    detailSeen,
    finalizeSeen,
    terminalSuccessSeen,
    activeOrOtherSeen,
    missingAuthoritySeen,
    malformedSeen: malformed,
    stoppedBecauseNoSafeRefs,
    refScopedPurgeOnly: true,
    privateIdentifiersExposed: false
  });
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  runPb8TerminalDlqCleanup().catch((error) => {
    console.error(String(error?.message || error).slice(0, 120));
    process.exitCode = 1;
  });
}
