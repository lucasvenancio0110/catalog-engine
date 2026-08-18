import { describe, expect, it, vi } from 'vitest';
import detailWorker from '../worker/import-detail-entry.js';

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
  it('acks malformed payloads', async () => {
    const ack = vi.fn();
    const retry = vi.fn();
    await detailWorker.queue({ messages: [{ body: { invalid: true }, ack, retry }] }, {});
    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });

  it('retries a valid detail message instead of losing it when runtime state is unavailable', async () => {
    const ack = vi.fn();
    const retry = vi.fn();
    await detailWorker.queue({ messages: [{ body: detailMessage, ack, retry }] }, {});
    expect(ack).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledWith({ delaySeconds: 300 });
  });

  it('retries a valid finalize message until its durable completion barrier can run', async () => {
    const ack = vi.fn();
    const retry = vi.fn();
    await detailWorker.queue({ messages: [{ body: finalizeMessage, ack, retry }] }, {});
    expect(ack).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledWith({ delaySeconds: 90 });
  });
});
