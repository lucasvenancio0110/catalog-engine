import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  IC4B_DETAIL_QUEUE_ROLLBACK,
  IC4B_DETAIL_QUEUE_TARGET,
  assertIc4bDetailQueueTarget
} from '../worker/ingestion/ic4b-detail-fanout-contract.js';

const DETAIL_QUEUE = 'catalog-engine-import-detail';
const DETAIL_DLQ = 'catalog-engine-import-detail-dlq';

function integer(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

export function detailConsumerShape(config) {
  const consumer = config?.queues?.consumers?.find((entry) => entry?.queue === DETAIL_QUEUE);
  if (!consumer) throw new Error('ic4b_detail_consumer_missing');
  return {
    maxBatchSize: integer(consumer.max_batch_size),
    maxBatchTimeoutSeconds: integer(consumer.max_batch_timeout),
    maxConcurrency: integer(consumer.max_concurrency),
    maxRetries: integer(consumer.max_retries),
    retryDelaySeconds: integer(consumer.retry_delay),
    deadLetterQueue: String(consumer.dead_letter_queue || '')
  };
}

function assertRollbackTemplate(config) {
  const shape = detailConsumerShape(config);
  for (const [key, expected] of Object.entries(IC4B_DETAIL_QUEUE_ROLLBACK)) {
    if (shape[key] !== expected) throw new Error(`ic4b_rollback_template_mismatch_${key}`);
  }
  if (shape.deadLetterQueue !== DETAIL_DLQ) throw new Error('ic4b_rollback_template_dlq_mismatch');
  return true;
}

function infrastructureSnapshot(config) {
  const clone = structuredClone(config);
  const consumer = clone?.queues?.consumers?.find((entry) => entry?.queue === DETAIL_QUEUE);
  if (consumer) {
    consumer.max_batch_size = '__DETAIL_BATCH__';
    consumer.max_batch_timeout = '__DETAIL_TIMEOUT__';
    consumer.max_concurrency = '__DETAIL_CONCURRENCY__';
    consumer.max_retries = '__DETAIL_RETRIES__';
    consumer.retry_delay = '__DETAIL_RETRY_DELAY__';
  }
  return JSON.stringify(clone);
}

export function buildIc4bDetailConfig(sourceConfig) {
  assertRollbackTemplate(sourceConfig);
  const output = structuredClone(sourceConfig);
  const consumer = output.queues.consumers.find((entry) => entry.queue === DETAIL_QUEUE);
  consumer.max_batch_size = IC4B_DETAIL_QUEUE_TARGET.maxBatchSize;
  consumer.max_batch_timeout = IC4B_DETAIL_QUEUE_TARGET.maxBatchTimeoutSeconds;
  consumer.max_concurrency = IC4B_DETAIL_QUEUE_TARGET.maxConcurrency;
  consumer.max_retries = IC4B_DETAIL_QUEUE_TARGET.maxRetries;
  consumer.retry_delay = IC4B_DETAIL_QUEUE_TARGET.retryDelaySeconds;

  assertIc4bDetailQueueTarget(detailConsumerShape(output));
  if (detailConsumerShape(output).deadLetterQueue !== DETAIL_DLQ) {
    throw new Error('ic4b_target_dlq_changed');
  }
  if (infrastructureSnapshot(sourceConfig) !== infrastructureSnapshot(output)) {
    throw new Error('ic4b_non_queue_infrastructure_changed');
  }
  return output;
}

export function safeIc4bConfigSummary(config) {
  const shape = detailConsumerShape(config);
  return {
    batchSize: shape.maxBatchSize,
    batchTimeoutSeconds: shape.maxBatchTimeoutSeconds,
    maxConcurrency: shape.maxConcurrency,
    maxRetries: shape.maxRetries,
    retryDelaySeconds: shape.retryDelaySeconds,
    dlqConfigured: shape.deadLetterQueue === DETAIL_DLQ
  };
}

function isCli() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

if (isCli()) {
  const sourcePath = path.resolve(process.argv[2] || 'wrangler.import-detail.jsonc');
  const outputPath = path.resolve(process.argv[3] || '/tmp/wrangler.import-detail.ic4b.json');
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const output = buildIc4bDetailConfig(source);
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(
    `${JSON.stringify({ ic4bDetailConfigBuild: 'passed', ...safeIc4bConfigSummary(output) })}\n`
  );
}
