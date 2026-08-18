import { handleTenantImportDetailMessage } from './ingestion/detail-consumer.js';
import { handleTenantImportFinalizeMessage } from './ingestion/finalize-consumer.js';
import { parseTenantImportMessage } from './tenant-import-queue.js';

function retryDelay(result, fallback) {
  const value = Number(result?.delaySeconds || fallback);
  return Math.max(30, Math.min(900, Number.isFinite(value) ? value : fallback));
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
        result = await handleTenantImportDetailMessage(parsed, env);
      } else if (parsed.type === 'finalize') {
        result = await handleTenantImportFinalizeMessage(parsed, env);
      } else {
        message.ack();
        continue;
      }

      if (['success', 'skipped', 'deferred'].includes(result.outcome)) {
        message.ack();
      } else if (['busy', 'retry', 'not_ready'].includes(result.outcome)) {
        message.retry({ delaySeconds: retryDelay(result, parsed.type === 'finalize' ? 90 : 120) });
      } else {
        // Stable failures are acknowledged. Durable control-plane and tenant-D1 state
        // preserves the failure code; scheduler/future recovery tooling owns replay.
        message.ack();
      }
    }
  }
};
