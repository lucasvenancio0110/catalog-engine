import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import {
  IC4B_DETAIL_FANOUT_CONTRACT_VERSION,
  IC4B_DETAIL_QUEUE_TARGET,
  IC4B_MIN_OBSERVED_WORKER_CONCURRENCY,
  IC4B_PROBE_MESSAGE_COUNT,
  evaluateIc4bFanoutProbe
} from '../worker/ingestion/ic4b-detail-fanout-contract.js';
import { queryD1Batch } from '../worker/cloudflare-platform.js';

const API_ORIGIN = 'https://api.cloudflare.com';
const PROD_DETAIL_QUEUE = 'catalog-engine-import-detail';
const PROD_DETAIL_DLQ = 'catalog-engine-import-detail-dlq';
const RUNTIME_PATH = '/tmp/ic4b-fanout-runtime.json';
const PROBE_CONFIG_PATH = '/tmp/ic4b-fanout-wrangler.json';
const CORE_EVIDENCE_PATH = '/tmp/ic4b-fanout-core.json';
const CLEANUP_EVIDENCE_PATH = '/tmp/ic4b-fanout-cleanup.json';
const FINAL_EVIDENCE_PATH = '/tmp/ic4b-fanout-evidence.json';
const POLL_MS = 1000;
const COMPLETION_TIMEOUT_MS = 120_000;
const DRAIN_TIMEOUT_MS = 45_000;
const PRIVATE_EVIDENCE_PATTERN =
  /https?:\/\/|authorization|api[_-]?token|secret|credential|database[_-]?id|queue[_-]?id|worker[_-]?(?:name|script)|t_[a-f0-9]{20}|imp_[a-f0-9]{20}/i;

const ACCOUNT_ID = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const API_TOKEN = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const DISPATCH_NAMESPACE = String(
  process.env.CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE || 'catalog-engine-production'
).trim();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeProviderCode(payload, status) {
  const candidate = Number(payload?.errors?.[0]?.code);
  return Number.isFinite(candidate) ? String(candidate) : String(status || 'unknown');
}

function requireCredentials() {
  if (!/^[a-f0-9]{32}$/i.test(ACCOUNT_ID)) throw new Error('ic4b_account_unconfigured');
  if (API_TOKEN.length < 20) throw new Error('ic4b_token_unconfigured');
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(DISPATCH_NAMESPACE)) {
    throw new Error('ic4b_dispatch_namespace_invalid');
  }
}

async function cloudflareRequest(pathname, { method = 'GET', body, allowNotFound = false } = {}) {
  const response = await fetch(new URL(pathname, API_ORIGIN), {
    method,
    redirect: 'error',
    headers: {
      authorization: `Bearer ${API_TOKEN}`,
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }).catch(() => null);
  if (!response) throw new Error('ic4b_cloudflare_unreachable');
  if (allowNotFound && response.status === 404) return null;
  const text = await response.text();
  let payload = null;
  if (text) payload = JSON.parse(text);
  if (!response.ok || payload?.success === false) {
    throw new Error(`ic4b_cloudflare_${safeProviderCode(payload, response.status)}`);
  }
  return payload?.result ?? payload ?? null;
}

function suffixForRun() {
  const seed = `${process.env.GITHUB_RUN_ID || Date.now()}:${process.env.GITHUB_RUN_ATTEMPT || '1'}:${process.env.TARGET_SHA || process.env.GITHUB_SHA || ''}`;
  return createHash('sha256').update(`ic4b:${seed}`).digest('hex').slice(0, 16);
}

function platformConfig() {
  return {
    accountId: ACCOUNT_ID,
    apiToken: API_TOKEN,
    dispatchNamespace: DISPATCH_NAMESPACE
  };
}

async function d1Batch(databaseId, batch) {
  return queryD1Batch({ ...platformConfig(), databaseId, batch });
}

async function loadAutomationBoundary() {
  const wrangler = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  const state = {
    initialImportEnabled: String(wrangler.vars?.TENANT_IMPORT_AUTOMATION_ENABLED || '') === '1',
    recurringSyncEnabled: String(wrangler.vars?.TENANT_SYNC_AUTOMATION_ENABLED || '') === '1',
    recurringSyncCohort: String(wrangler.vars?.TENANT_SYNC_ACTIVE_COHORT || ''),
    recurringSyncMaxJobs: String(wrangler.vars?.TENANT_SYNC_MAX_JOBS_PER_TICK || '')
  };
  if (!state.initialImportEnabled) throw new Error('ic4b_initial_import_must_remain_enabled');
  if (state.recurringSyncEnabled) throw new Error('ic4b_recurring_sync_must_remain_disabled');
  if (state.recurringSyncCohort !== '') throw new Error('ic4b_recurring_sync_cohort_must_remain_empty');
  if (state.recurringSyncMaxJobs !== '1') throw new Error('ic4b_recurring_sync_limit_changed');
  return state;
}

async function createProbeResources() {
  const suffix = suffixForRun();
  const runtime = {
    workerName: `ce-ic4b-probe-${suffix}`,
    queueName: `ce-ic4b-q-${suffix}`,
    dlqName: `ce-ic4b-dlq-${suffix}`,
    databaseName: `ceic4b-${suffix}`,
    queueId: null,
    dlqId: null,
    databaseId: null,
    workerCreated: false
  };

  try {
    const database = await cloudflareRequest(`/client/v4/accounts/${ACCOUNT_ID}/d1/database`, {
      method: 'POST',
      body: { name: runtime.databaseName, read_replication: { mode: 'disabled' } }
    });
    runtime.databaseId = String(database?.uuid || '').trim();
    if (!runtime.databaseId) throw new Error('ic4b_probe_database_create_failed');

    const queue = await cloudflareRequest(`/client/v4/accounts/${ACCOUNT_ID}/queues`, {
      method: 'POST',
      body: { queue_name: runtime.queueName }
    });
    runtime.queueId = String(queue?.queue_id || queue?.id || '').trim();
    if (!runtime.queueId) throw new Error('ic4b_probe_queue_create_failed');

    const dlq = await cloudflareRequest(`/client/v4/accounts/${ACCOUNT_ID}/queues`, {
      method: 'POST',
      body: { queue_name: runtime.dlqName }
    });
    runtime.dlqId = String(dlq?.queue_id || dlq?.id || '').trim();
    if (!runtime.dlqId) throw new Error('ic4b_probe_dlq_create_failed');

    await d1Batch(runtime.databaseId, [
      {
        sql: `CREATE TABLE IF NOT EXISTS probe_state (
          id INTEGER PRIMARY KEY CHECK (id=1),
          active INTEGER NOT NULL DEFAULT 0,
          max_active INTEGER NOT NULL DEFAULT 0,
          completed INTEGER NOT NULL DEFAULT 0,
          updated_at_ms INTEGER NOT NULL DEFAULT 0
        )`,
        params: []
      },
      {
        sql: `INSERT OR REPLACE INTO probe_state (id,active,max_active,completed,updated_at_ms)
              VALUES (1,0,0,0,?1)`,
        params: [Date.now()]
      },
      {
        sql: `CREATE TABLE IF NOT EXISTS probe_messages (
          message_id TEXT PRIMARY KEY,
          completed_at_ms INTEGER NOT NULL
        )`,
        params: []
      }
    ]);

    fs.writeFileSync(RUNTIME_PATH, JSON.stringify(runtime), { mode: 0o600 });
    const probeConfig = {
      name: runtime.workerName,
      main: './worker/ic4b-fanout-probe.js',
      compatibility_date: '2026-08-17',
      workers_dev: false,
      observability: { enabled: true },
      d1_databases: [
        {
          binding: 'PROBE_DB',
          database_name: runtime.databaseName,
          database_id: runtime.databaseId
        }
      ],
      queues: {
        consumers: [
          {
            queue: runtime.queueName,
            max_batch_size: IC4B_DETAIL_QUEUE_TARGET.maxBatchSize,
            max_batch_timeout: IC4B_DETAIL_QUEUE_TARGET.maxBatchTimeoutSeconds,
            max_retries: IC4B_DETAIL_QUEUE_TARGET.maxRetries,
            dead_letter_queue: runtime.dlqName,
            max_concurrency: IC4B_DETAIL_QUEUE_TARGET.maxConcurrency,
            retry_delay: IC4B_DETAIL_QUEUE_TARGET.retryDelaySeconds
          }
        ]
      }
    };
    fs.writeFileSync(PROBE_CONFIG_PATH, `${JSON.stringify(probeConfig, null, 2)}\n`, { mode: 0o600 });
    return runtime;
  } catch (error) {
    fs.writeFileSync(RUNTIME_PATH, JSON.stringify(runtime), { mode: 0o600 });
    throw error;
  }
}

function readRuntime() {
  return JSON.parse(fs.readFileSync(RUNTIME_PATH, 'utf8'));
}

async function queueMetrics(queueId) {
  const result = await cloudflareRequest(
    `/client/v4/accounts/${ACCOUNT_ID}/queues/${encodeURIComponent(queueId)}/metrics`
  );
  const metrics = result?.metrics || result || {};
  return {
    backlogCount: Number(metrics.backlog_count ?? metrics.backlogCount ?? 0),
    backlogBytes: Number(metrics.backlog_bytes ?? metrics.backlogBytes ?? 0)
  };
}

function consumerShape(row) {
  const settings = row?.settings || {};
  return {
    batchSize: Number(settings.batch_size ?? 0),
    maxConcurrency: Number(settings.max_concurrency ?? 0),
    maxRetries: Number(settings.max_retries ?? 0),
    maxWaitTimeMs: Number(settings.max_wait_time_ms ?? 0),
    retryDelaySeconds: Number(settings.retry_delay ?? 0),
    deadLetterConfigured: Boolean(String(row?.dead_letter_queue || '').trim())
  };
}

function assertTargetConsumer(shape) {
  if (shape.batchSize !== IC4B_DETAIL_QUEUE_TARGET.maxBatchSize) throw new Error('ic4b_runtime_batch_mismatch');
  if (shape.maxConcurrency !== IC4B_DETAIL_QUEUE_TARGET.maxConcurrency) {
    throw new Error('ic4b_runtime_concurrency_mismatch');
  }
  if (shape.maxRetries !== IC4B_DETAIL_QUEUE_TARGET.maxRetries) throw new Error('ic4b_runtime_retries_mismatch');
  if (shape.maxWaitTimeMs !== IC4B_DETAIL_QUEUE_TARGET.maxBatchTimeoutSeconds * 1000) {
    throw new Error('ic4b_runtime_wait_mismatch');
  }
  if (shape.retryDelaySeconds !== IC4B_DETAIL_QUEUE_TARGET.retryDelaySeconds) {
    throw new Error('ic4b_runtime_retry_delay_mismatch');
  }
  if (!shape.deadLetterConfigured) throw new Error('ic4b_runtime_dlq_missing');
}

async function queueByName(name) {
  const rows = await cloudflareRequest(`/client/v4/accounts/${ACCOUNT_ID}/queues?per_page=100`);
  const match = (Array.isArray(rows) ? rows : []).find(
    (row) => String(row?.queue_name || row?.name || '') === name
  );
  if (!match) throw new Error('ic4b_required_queue_missing');
  return {
    id: String(match.queue_id || match.id || '').trim(),
    name
  };
}

async function queueConsumer(queueId, expectedScript) {
  const rows = await cloudflareRequest(
    `/client/v4/accounts/${ACCOUNT_ID}/queues/${encodeURIComponent(queueId)}/consumers`
  );
  const list = Array.isArray(rows) ? rows : [];
  const row = list.find((entry) => String(entry?.script_name || '') === expectedScript) || list[0];
  if (!row) throw new Error('ic4b_queue_consumer_missing');
  return row;
}

async function verifyProductionRuntime() {
  const detail = await queueByName(PROD_DETAIL_QUEUE);
  const dlq = await queueByName(PROD_DETAIL_DLQ);
  const row = await queueConsumer(detail.id, PROD_DETAIL_QUEUE);
  const shape = consumerShape(row);
  assertTargetConsumer(shape);
  const [detailMetrics, dlqMetrics] = await Promise.all([queueMetrics(detail.id), queueMetrics(dlq.id)]);
  if (detailMetrics.backlogCount !== 0) throw new Error('ic4b_production_detail_backlog_not_clean');
  if (dlqMetrics.backlogCount !== 0) throw new Error('ic4b_production_dlq_backlog_not_clean');
  return {
    ...shape,
    backlogCount: detailMetrics.backlogCount,
    dlqBacklogCount: dlqMetrics.backlogCount
  };
}

async function verifyProbeConsumer(runtime) {
  const row = await queueConsumer(runtime.queueId, runtime.workerName);
  const shape = consumerShape(row);
  assertTargetConsumer(shape);
  return shape;
}

async function pushProbeMessages(runtime) {
  const messages = Array.from({ length: IC4B_PROBE_MESSAGE_COUNT }, (_, index) => ({
    body: { id: `m_${index + 1}` },
    content_type: 'json'
  }));
  await cloudflareRequest(
    `/client/v4/accounts/${ACCOUNT_ID}/queues/${encodeURIComponent(runtime.queueId)}/messages/batch`,
    { method: 'POST', body: { messages } }
  );
}

async function probeState(runtime) {
  const rows = await d1Batch(runtime.databaseId, [
    {
      sql: 'SELECT active,max_active,completed FROM probe_state WHERE id=1',
      params: []
    },
    {
      sql: 'SELECT COUNT(*) AS total FROM probe_messages',
      params: []
    }
  ]);
  const state = rows?.[0]?.results?.[0] || {};
  const messages = rows?.[1]?.results?.[0] || {};
  return {
    active: Number(state.active || 0),
    maxObservedActive: Number(state.max_active || 0),
    completed: Number(state.completed || 0),
    uniqueCompleted: Number(messages.total || 0)
  };
}

async function waitForProbe(runtime) {
  const started = Date.now();
  let state = await probeState(runtime);
  while (Date.now() - started < COMPLETION_TIMEOUT_MS) {
    if (
      state.completed === IC4B_PROBE_MESSAGE_COUNT &&
      state.uniqueCompleted === IC4B_PROBE_MESSAGE_COUNT &&
      state.active === 0
    ) {
      return state;
    }
    await sleep(POLL_MS);
    state = await probeState(runtime);
  }
  throw new Error('ic4b_probe_completion_timeout');
}

async function waitProbeQueuesClean(runtime) {
  const started = Date.now();
  let latest = null;
  while (Date.now() - started < DRAIN_TIMEOUT_MS) {
    const [queue, dlq] = await Promise.all([queueMetrics(runtime.queueId), queueMetrics(runtime.dlqId)]);
    latest = { queue, dlq };
    if (queue.backlogCount === 0 && dlq.backlogCount === 0) return latest;
    await sleep(POLL_MS);
  }
  throw new Error('ic4b_probe_queue_not_clean');
}

async function runProbe() {
  const runtime = readRuntime();
  const automation = await loadAutomationBoundary();
  const production = await verifyProductionRuntime();
  const probeConsumer = await verifyProbeConsumer(runtime);
  await pushProbeMessages(runtime);
  const state = await waitForProbe(runtime);
  const queues = await waitProbeQueuesClean(runtime);
  if (state.maxObservedActive < IC4B_MIN_OBSERVED_WORKER_CONCURRENCY) {
    throw new Error('ic4b_observed_worker_concurrency_below_baseline');
  }
  if (state.maxObservedActive > IC4B_DETAIL_QUEUE_TARGET.maxConcurrency) {
    throw new Error('ic4b_observed_worker_concurrency_above_ceiling');
  }
  const core = {
    contractVersion: IC4B_DETAIL_FANOUT_CONTRACT_VERSION,
    production,
    probe: {
      expectedMessages: IC4B_PROBE_MESSAGE_COUNT,
      completed: state.completed,
      uniqueCompleted: state.uniqueCompleted,
      maxObservedActive: state.maxObservedActive,
      minimumRequired: IC4B_MIN_OBSERVED_WORKER_CONCURRENCY,
      configuredMaxConcurrency: probeConsumer.maxConcurrency,
      backlogCount: queues.queue.backlogCount,
      dlqBacklogCount: queues.dlq.backlogCount
    },
    initialImportEnabled: automation.initialImportEnabled,
    recurringIntelligentSyncEnabled: automation.recurringSyncEnabled,
    providerRegressionGate: 'exact-sha-auto-canary-success',
    crossTenantRegressionGate: 'exact-sha-pb9-success',
    privateIdentifiersExposed: false
  };
  fs.writeFileSync(CORE_EVIDENCE_PATH, `${JSON.stringify(core, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ ic4bFanoutProbeCore: 'passed', ...core })}\n`);
}

async function deleteResource(pathname) {
  try {
    await cloudflareRequest(pathname, { method: 'DELETE', allowNotFound: true });
    return true;
  } catch {
    return false;
  }
}

async function cleanupProbe() {
  if (!fs.existsSync(RUNTIME_PATH)) {
    const empty = { workerCleaned: true, queueCleaned: true, dlqCleaned: true, databaseCleaned: true };
    fs.writeFileSync(CLEANUP_EVIDENCE_PATH, JSON.stringify(empty), { mode: 0o600 });
    process.stdout.write(`${JSON.stringify({ ic4bCleanup: 'passed', ...empty })}\n`);
    return;
  }
  const runtime = readRuntime();
  const workerCleaned = runtime.workerName
    ? await deleteResource(
        `/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${encodeURIComponent(runtime.workerName)}?force=true`
      )
    : true;
  const queueCleaned = runtime.queueId
    ? await deleteResource(`/client/v4/accounts/${ACCOUNT_ID}/queues/${encodeURIComponent(runtime.queueId)}`)
    : true;
  const dlqCleaned = runtime.dlqId
    ? await deleteResource(`/client/v4/accounts/${ACCOUNT_ID}/queues/${encodeURIComponent(runtime.dlqId)}`)
    : true;
  const databaseCleaned = runtime.databaseId
    ? await deleteResource(
        `/client/v4/accounts/${ACCOUNT_ID}/d1/database/${encodeURIComponent(runtime.databaseId)}`
      )
    : true;
  const cleanup = { workerCleaned, queueCleaned, dlqCleaned, databaseCleaned };
  fs.writeFileSync(CLEANUP_EVIDENCE_PATH, JSON.stringify(cleanup), { mode: 0o600 });
  if (!Object.values(cleanup).every(Boolean)) throw new Error('ic4b_probe_cleanup_failed');
  process.stdout.write(`${JSON.stringify({ ic4bCleanup: 'passed', ...cleanup })}\n`);
}

function finalizeEvidence() {
  const core = JSON.parse(fs.readFileSync(CORE_EVIDENCE_PATH, 'utf8'));
  const cleanup = JSON.parse(fs.readFileSync(CLEANUP_EVIDENCE_PATH, 'utf8'));
  const evaluation = evaluateIc4bFanoutProbe({
    completed: core.probe.completed,
    expectedMessages: core.probe.expectedMessages,
    maxObservedActive: core.probe.maxObservedActive,
    configuredMaxConcurrency: core.probe.configuredMaxConcurrency,
    workerCleaned: cleanup.workerCleaned,
    queueCleaned: cleanup.queueCleaned,
    dlqCleaned: cleanup.dlqCleaned,
    databaseCleaned: cleanup.databaseCleaned
  });
  if (!evaluation.passed) throw new Error('ic4b_final_evaluation_failed');
  const evidence = {
    ic4bProductionFanout: 'passed',
    ...core,
    cleanup,
    evaluation
  };
  const serialized = JSON.stringify(evidence);
  if (PRIVATE_EVIDENCE_PATTERN.test(serialized)) throw new Error('ic4b_safe_evidence_private_leak');
  fs.writeFileSync(FINAL_EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}

async function main() {
  requireCredentials();
  const command = String(process.argv[2] || '').trim();
  if (command === 'setup') {
    await loadAutomationBoundary();
    await createProbeResources();
    process.stdout.write(
      `${JSON.stringify({
        ic4bProbeSetup: 'passed',
        batchSize: IC4B_DETAIL_QUEUE_TARGET.maxBatchSize,
        maxConcurrency: IC4B_DETAIL_QUEUE_TARGET.maxConcurrency,
        probeMessages: IC4B_PROBE_MESSAGE_COUNT
      })}\n`
    );
    return;
  }
  if (command === 'run') {
    await runProbe();
    return;
  }
  if (command === 'cleanup') {
    await cleanupProbe();
    return;
  }
  if (command === 'finalize') {
    finalizeEvidence();
    return;
  }
  throw new Error('ic4b_command_invalid');
}

await main();
