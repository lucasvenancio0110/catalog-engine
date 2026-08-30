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

  it('retries instead of failing when Queue delivery wins the pending-to-queued scheduler race', async () => {
    const pendingContext = {
      import_id: scanMessage.importId,
      mode: 'initial',
      import_status: 'pending',
      phase: 'scan',
      detail_enqueue_cursor: 0,
      discovered_count: 0,
      provider: 'yupoo',
      source_url: 'https://supplier.x.yupoo.com/categories/99?isSubCate=true',
      sync_strategy: 'incremental',
      removal_miss_threshold: 3,
      d1_database_id: '12ac414c-4aef-4668-a8f9-dc63d57d449f',
      database_status: 'active',
      worker_status: 'active',
      dispatch_namespace: 'catalog-engine-production',
      provisioning_id: 'p_pending_race',
      provisioning_step: 'import',
      schema_version: 3
    };

    const prepare = vi.fn((sql) => {
      if (String(sql).includes('FROM tenant_import_jobs j')) {
        return {
          bind: vi.fn(() => ({
            first: vi.fn(async () => pendingContext)
          }))
        };
      }
      if (String(sql).includes("SET status='scanning'")) {
        return {
          bind: vi.fn(() => ({
            run: vi.fn(async () => ({ meta: { changes: 0 } }))
          }))
        };
      }
      throw new Error('unexpected D1 statement in pending dispatch race test');
    });

    const ack = vi.fn();
    const retry = vi.fn();
    await importScanWorker.queue(
      { messages: [{ body: scanMessage, ack, retry }] },
      {
        CATALOG_DB: { prepare },
        TENANT_IMPORT_DETAIL_QUEUE: { sendBatch: vi.fn() },
        TENANT_DISPATCH: { get: vi.fn() }
      }
    );

    expect(retry).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledWith({ delaySeconds: 60 });
    expect(ack).not.toHaveBeenCalled();
  });

  it('routes malformed queue payloads through bounded retries and the scan DLQ', async () => {
    const ack = vi.fn();
    const retry = vi.fn();
    await importScanWorker.queue(
      { messages: [{ body: { hello: 'world' }, ack, retry }] },
      {}
    );
    expect(ack).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledWith({ delaySeconds: 300 });
  });

  it('routes a message delivered to the wrong queue through poison-message handling', async () => {
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
    expect(ack).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledWith({ delaySeconds: 300 });
  });
});
