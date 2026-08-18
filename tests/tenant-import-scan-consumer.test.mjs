import { describe, expect, it, vi } from 'vitest';
import importScanWorker from '../worker/import-scan-entry.js';
import { handleTenantImportScanMessage } from '../worker/ingestion/scan-consumer.js';

const scanMessage = {
  version: 1,
  type: 'scan',
  importId: 'imp_0123456789abcdefabcd',
  tenantId: 't_0123456789abcdefabcd',
  sourceKey: 'primary'
};

describe('tenant import scan consumer activation boundary', () => {
  it('does not read D1 when the detail fan-out queue is not bound', async () => {
    const prepare = vi.fn(() => {
      throw new Error('D1 should not be queried before detail queue activation');
    });
    const result = await handleTenantImportScanMessage(scanMessage, {
      CATALOG_DB: { prepare }
    });

    expect(result).toEqual({
      outcome: 'failed',
      error: 'tenant_import_detail_queue_unbound'
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it('acknowledges malformed queue payloads without touching tenant state', async () => {
    const ack = vi.fn();
    const retry = vi.fn();
    await importScanWorker.queue(
      { messages: [{ body: { hello: 'world' }, ack, retry }] },
      {}
    );
    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });

  it('acks non-scan message types because they belong on the separate detail queue', async () => {
    const ack = vi.fn();
    const retry = vi.fn();
    await importScanWorker.queue(
      {
        messages: [
          {
            body: {
              version: 1,
              type: 'detail',
              importId: 'imp_0123456789abcdefabcd',
              tenantId: 't_0123456789abcdefabcd',
              sourceKey: 'primary',
              albumSourceId: '123'
            },
            ack,
            retry
          }
        ]
      },
      {}
    );
    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });
});
