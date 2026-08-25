import { handleTenantImportDetailMessage } from './ingestion/detail-consumer.js';
import { handleTenantImportFinalizeMessage } from './ingestion/finalize-consumer.js';
import { handleTenantIncrementalDetailMessage } from './ingestion/incremental-detail-consumer.js';
import { initialTenantImportId, parseTenantImportMessage } from './tenant-import-queue.js';

function retryDelay(result, fallback) {
  const value = Number(result?.delaySeconds || fallback);
  return Math.max(30, Math.min(900, Number.isFinite(value) ? value : fallback));
}

async function handleDetail(parsed, env) {
  const initialId = await initialTenantImportId({
    tenantId: parsed.tenantId,
    sourceKey: parsed.sourceKey
  });
  if (parsed.importId === initialId) {
    return handleTenantImportDetailMessage(parsed, env);
  }
  return handleTenantIncrementalDetailMessage(parsed, env);
}

export default {
  async queue(batch, env) {
    for (const message of batch.messages) {
      let parsed;
      try {
        parsed = parseTenantImportMessage(message.body);
      } catch {
        message.ack();
        continue;
      }

      let result;
      if (parsed.type === 'detail') {
        result = await handleDetail(parsed, env);
      } else if (parsed.type === 'finalize') {
        result = await handleTenantImportFinalizeMessage(parsed, env);
      } else {
        message.ack();
        continue;
      }

      if (['success', 'skipped', 'deferred'].includes(result.outcome)) {
        message.ack();
      } else {
        // Initial and incremental detail claims are idempotent. Queue delivery
        // may retry transient failures, while exhausted incremental candidates
        // remain durable private evidence and are acked as deferred.
        message.retry({
          delaySeconds: retryDelay(
            result,
            parsed.type === 'finalize' ? 90 : result.outcome === 'failed' ? 300 : 120
          )
        });
      }
    }
  }
};
