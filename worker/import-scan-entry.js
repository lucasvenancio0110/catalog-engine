import {
  parseTenantImportMessage,
  recordTenantImportDelivery,
  tenantImportMessageDisposition
} from './tenant-import-queue.js';
import { handleTenantImportScanMessage } from './ingestion/scan-consumer.js';

export default {
  async queue(batch, env) {
    for (const message of batch.messages) {
      let parsed;
      try {
        parsed = parseTenantImportMessage(message.body);
      } catch {
        message.retry({ delaySeconds: 300 });
        continue;
      }

      if (parsed.type !== 'scan') {
        message.retry({ delaySeconds: 300 });
        continue;
      }

      let disposition;
      try {
        disposition = await tenantImportMessageDisposition(env.CATALOG_DB, parsed);
      } catch {
        message.retry({ delaySeconds: 60 });
        continue;
      }
      if (disposition.disposition === 'stale') {
        message.ack();
        continue;
      }
      if (disposition.disposition !== 'admit') {
        message.retry({ delaySeconds: 60 });
        continue;
      }
      await recordTenantImportDelivery(env.CATALOG_DB, parsed).catch(() => {});

      let result;
      try {
        result = await handleTenantImportScanMessage(parsed, env);
      } catch {
        message.retry({ delaySeconds: 60 });
        continue;
      }
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
