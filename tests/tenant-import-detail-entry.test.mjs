import { describe, expect, it, vi } from 'vitest';
import detailWorker, { tenantImportQueueDeliveryAction } from '../worker/import-detail-entry.js';

const detailMessage = {
  version: 1,
  type: 'detail',
  importId: 'imp_0123456789abcdefabcd',
  tenantId: 't_0123456789abcdefabcd',
  sourceKey: 'primary',
  albumSourceId: '123'
};

const finalizeMessage = {
  version: 1,
  type: 'finalize',
  importId: 'imp_0123456789abcdefabcd',
  tenantId: 't_0123456789abcdefabcd',
  sourceKey: 'primary'
};

describe('tenant detail queue entrypoint', () => {
  it('retries malformed payloads into the bounded poison-message/DLQ policy', async () => {
    const ack = vi.fn();
    const retry = vi.fn();
    await detailWorker.queue({ messages: [{ body: { invalid: true }, ack, retry }] }, {});
    expect(ack).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledWith({ delaySeconds: 300 });
  });

  it('retries a valid detail message instead of losing it when runtime state is unavailable', async () => {
    const ack = vi.fn();
    const retry = vi.fn();
    await detailWorker.queue({ messages: [{ body: detailMessage, ack, retry }] }, {});
    expect(ack).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledWith({ delaySeconds: 300 });
  });

  it('retries a valid finalize message when runtime state is unavailable', async () => {
    const ack = vi.fn();
    const retry = vi.fn();
    await detailWorker.queue({ messages: [{ body: finalizeMessage, ack, retry }] }, {});
    expect(ack).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledWith({ delaySeconds: 90 });
  });

  it('acks a healthy finalize barrier probe that is not ready so cron owns the next probe', () => {
    expect(
      tenantImportQueueDeliveryAction(finalizeMessage, {
        outcome: 'not_ready',
        terminal: 128,
        discovered: 6112,
        delaySeconds: 90
      })
    ).toEqual({ action: 'ack' });
  });

  it('keeps actual finalize execution failures retryable', () => {
    expect(
      tenantImportQueueDeliveryAction(finalizeMessage, {
        outcome: 'failed',
        error: 'tenant_import_finalize_failed'
      })
    ).toEqual({ action: 'retry', delaySeconds: 90 });
  });
});
