import { parseTenantImportMessage } from './tenant-import-queue.js';
import { handleTenantImportScanMessage } from './ingestion/scan-consumer.js';

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

      if (parsed.type !== 'scan') {
        // Detail/finalize handlers are intentionally not activated in this milestone.
        // Retain these messages for the next consumer version instead of acknowledging them.
        message.retry({ delaySeconds: 300 });
        continue;
      }

      const result = await handleTenantImportScanMessage(parsed, env);
      if (result.outcome === 'success') {
        message.ack();
      } else if (result.outcome === 'busy') {
        message.retry({ delaySeconds: 60 });
      } else {
        // Failure state/retry timing is persisted in tenant_import_jobs. Ack this delivery;
        // the platform cron will dispatch a fresh scan message when the retry window opens.
        message.ack();
      }
    }
  }
};
