import { handleInstantSeedMessage } from './instant-seed-consumer.js';
import { parseInstantSeedMessage } from './instant-seed-queue.js';

export default {
  async queue(batch, env) {
    for (const delivery of batch.messages) {
      let parsed;
      try {
        parsed = parseInstantSeedMessage(delivery.body);
      } catch {
        delivery.retry({ delaySeconds: 60 });
        continue;
      }

      const result = await handleInstantSeedMessage(parsed, env).catch(() => ({
        outcome: 'retry',
        code: 'instant_seed_failed'
      }));

      if (result.outcome === 'success' || result.outcome === 'stale') {
        delivery.ack();
        continue;
      }

      console.error('instant_seed_delivery_retry', String(result.code || 'instant_seed_failed').slice(0, 112));
      delivery.retry({ delaySeconds: 15 });
    }
  }
};
