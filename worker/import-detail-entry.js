import { handleTenantImportDetailMessage } from './ingestion/detail-consumer.js';
import { handleTenantImportFinalizeMessage } from './ingestion/finalize-consumer.js';
import { handleTenantIncrementalDetailMessage } from './ingestion/incremental-detail-consumer.js';
import { recoverExhaustedInitialDetailLeases } from './ingestion/initial-detail-recovery.js';
import {
  ProviderDetailGovernor,
  createAdaptiveProviderFetch
} from './ingestion/provider-detail-governor.js';
import {
  TenantD1WriteGovernor,
  createTenantD1WriteGovernedEnv
} from './ingestion/tenant-d1-write-governor.js';
import {
  initialTenantImportId,
  parseTenantImportMessage,
  recordTenantImportDelivery,
  tenantImportMessageDisposition
} from './tenant-import-queue.js';

export { ProviderDetailGovernor, TenantD1WriteGovernor };

function retryDelay(result, fallback) {
  const value = Number(result?.delaySeconds || fallback);
  return Math.max(30, Math.min(900, Number.isFinite(value) ? value : fallback));
}

export function tenantImportQueueDeliveryAction(parsed, result) {
  const outcome = String(result?.outcome || '');
  if (['success', 'skipped', 'deferred'].includes(outcome)) {
    return { action: 'ack' };
  }

  // The five-minute platform cron owns finalize-barrier polling. A healthy
  // finalize probe that finds durable detail work still in flight is not a
  // failed Queue delivery and must not consume retries or poison the DLQ.
  // The next cron tick will enqueue a fresh bounded probe. Real execution
  // failures remain retryable through the normal Queue policy below.
  if (parsed?.type === 'finalize' && outcome === 'not_ready') {
    return { action: 'ack' };
  }

  return {
    action: 'retry',
    delaySeconds: retryDelay(
      result,
      parsed?.type === 'finalize' ? 90 : outcome === 'failed' ? 300 : 120
    )
  };
}

async function handleDetail(parsed, env) {
  const initialId = await initialTenantImportId({
    tenantId: parsed.tenantId,
    sourceKey: parsed.sourceKey
  });
  const fetchImpl = createAdaptiveProviderFetch(env, fetch);
  if (parsed.importId === initialId) {
    return handleTenantImportDetailMessage(parsed, env, { fetchImpl });
  }
  return handleTenantIncrementalDetailMessage(parsed, env, { fetchImpl });
}

export default {
  async queue(batch, env) {
    const governedEnv = createTenantD1WriteGovernedEnv(env);
    for (const message of batch.messages) {
      let parsed;
      try {
        parsed = parseTenantImportMessage(message.body);
      } catch {
        message.retry({ delaySeconds: 300 });
        continue;
      }

      let result;
      if (!['detail', 'finalize'].includes(parsed.type)) {
        message.retry({ delaySeconds: 300 });
        continue;
      }

      let disposition;
      try {
        disposition = await tenantImportMessageDisposition(env.CATALOG_DB, parsed);
      } catch {
        message.retry({ delaySeconds: 120 });
        continue;
      }
      if (disposition.disposition === 'stale') {
        message.ack();
        continue;
      }
      if (disposition.disposition !== 'admit') {
        message.retry({
          delaySeconds: retryDelay({}, parsed.type === 'finalize' ? 90 : 300)
        });
        continue;
      }
      await recordTenantImportDelivery(env.CATALOG_DB, parsed).catch(() => {});

      try {
        if (parsed.type === 'detail') {
          result = await handleDetail(parsed, governedEnv);
        } else {
          // Finalize delivery is also the liveness barrier for initial detail work:
          // expired claims that already exhausted the bounded detail attempt budget
          // become deferred before terminal-count evaluation. This is tenant/import
          // scoped and idempotent, so a DLQ-exhausted detail cannot strand onboarding.
          await recoverExhaustedInitialDetailLeases(parsed, governedEnv);
          result = await handleTenantImportFinalizeMessage(parsed, governedEnv);
        }
      } catch {
        result = { outcome: 'failed', error: 'tenant_import_delivery_failed' };
      }

      const delivery = tenantImportQueueDeliveryAction(parsed, result);
      if (delivery.action === 'ack') {
        message.ack();
      } else {
        // Initial and incremental detail claims are idempotent. Queue delivery
        // retries actual transient execution failures, while finalize barrier
        // polling is owned by the periodic scheduler rather than Queue retries.
        message.retry({ delaySeconds: delivery.delaySeconds });
      }
    }
  }
};
