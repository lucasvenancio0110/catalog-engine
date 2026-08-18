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
        message.ack();
        continue;
      }

      const result = await handleTenantImportScanMessage(parsed, env);
      if (result.outcome === 'success') {
        message.ack();
      } else if (result.outcome === 'busy') {
        message.retry({ delaySeconds: 60 });
      } else {
        // The durable import job owns retry timing. Ack this delivery and let the
        // platform cron dispatch a fresh scan message after next_attempt_at.
        message.ack();
      }
    }
  }
};
