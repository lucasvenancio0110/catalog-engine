import { describe, expect, it, vi } from 'vitest';
import {
  assertPublicSafeImportMessage,
  buildTenantImportDetailMessage,
  buildTenantImportFinalizeMessage,
  buildTenantImportScanMessage,
  parseTenantImportMessage
} from '../worker/tenant-import-queue.js';
import {
  runDueTenantImportDispatches,
  tenantImportAutomationEnabled,
  tenantImportQueueConfigured
} from '../worker/tenant-import-dispatcher.js';

const tenantId = 't_0123456789abcdefabcd';

describe('tenant import queue foundation', () => {
  it('creates a deterministic initial scan message containing only opaque routing identifiers', async () => {
    const first = await buildTenantImportScanMessage({ tenantId, sourceKey: 'primary' });
    const retry = await buildTenantImportScanMessage({ tenantId, sourceKey: 'primary' });

    expect(retry).toEqual(first);
    expect(first).toMatchObject({
      version: 1,
      type: 'scan',
      tenantId,
      sourceKey: 'primary'
    });
    expect(first.importId).toMatch(/^imp_[a-f0-9]{20}$/);
    expect(JSON.stringify(first)).not.toMatch(/https?:\/\/|yupoo|sourceUrl|databaseId|credential|secret/i);
    expect(assertPublicSafeImportMessage(first)).toEqual(first);
  });

  it('keeps raw album identifiers only inside a private detail queue message, without URLs', () => {
    const message = buildTenantImportDetailMessage({
      importId: 'imp_0123456789abcdefabcd',
      tenantId,
      sourceKey: 'primary',
      albumSourceId: '123456789'
    });

    expect(message).toEqual({
      version: 1,
      type: 'detail',
      importId: 'imp_0123456789abcdefabcd',
      tenantId,
      sourceKey: 'primary',
      albumSourceId: '123456789'
    });
    expect(assertPublicSafeImportMessage(message)).toEqual(message);
  });

  it('supports a finalize message without copying catalog or provider payloads through the queue', () => {
    const message = buildTenantImportFinalizeMessage({
      importId: 'imp_0123456789abcdefabcd',
      tenantId,
      sourceKey: 'primary'
    });
    expect(parseTenantImportMessage(message)).toEqual(message);
    expect(assertPublicSafeImportMessage(message)).toEqual(message);
  });

  it('rejects queue messages that attempt to carry supplier or infrastructure secrets', () => {
    expect(() =>
      assertPublicSafeImportMessage({
        version: 1,
        type: 'scan',
        importId: 'imp_0123456789abcdefabcd',
        tenantId,
        sourceKey: 'primary',
        sourceUrl: 'https://supplier.x.yupoo.com/albums/'
      })
    ).toThrow('tenant_import_message_contains_private_state');
  });

  it('keeps automatic discovery inert by default even when queue bindings exist', async () => {
    const prepare = vi.fn(() => {
      throw new Error('control-plane D1 should not be queried while automation is disabled');
    });
    const send = vi.fn();
    const sendBatch = vi.fn();
    const env = {
      CATALOG_DB: { prepare },
      TENANT_IMPORT_QUEUE: { send },
      TENANT_IMPORT_DETAIL_QUEUE: { send, sendBatch }
    };

    expect(tenantImportAutomationEnabled(env)).toBe(false);
    expect(tenantImportQueueConfigured(env)).toBe(true);
    expect(await runDueTenantImportDispatches(env)).toEqual({
      enabled: false,
      reason: 'tenant_import_automation_disabled',
      dispatched: 0
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(sendBatch).not.toHaveBeenCalled();
  });

  it('requires the explicit value 1 before automatic import dispatch can run', () => {
    expect(tenantImportAutomationEnabled({ TENANT_IMPORT_AUTOMATION_ENABLED: '1' })).toBe(true);
    expect(tenantImportAutomationEnabled({ TENANT_IMPORT_AUTOMATION_ENABLED: 'true' })).toBe(false);
    expect(tenantImportAutomationEnabled({ TENANT_IMPORT_AUTOMATION_ENABLED: '0' })).toBe(false);
  });

  it('still fails closed when automation is enabled but queue bindings are incomplete', async () => {
    const prepare = vi.fn(() => {
      throw new Error('control-plane D1 should not be queried without complete queue bindings');
    });
    const env = {
      CATALOG_DB: { prepare },
      TENANT_IMPORT_AUTOMATION_ENABLED: '1'
    };

    expect(tenantImportQueueConfigured(env)).toBe(false);
    expect(await runDueTenantImportDispatches(env)).toEqual({
      enabled: false,
      reason: 'tenant_import_queue_unbound',
      dispatched: 0
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it('fails closed before queue work when the control-plane D1 binding is absent', async () => {
    const send = vi.fn();
    const env = {
      TENANT_IMPORT_AUTOMATION_ENABLED: '1',
      TENANT_IMPORT_QUEUE: { send }
    };
    expect(await runDueTenantImportDispatches(env)).toEqual({
      enabled: false,
      reason: 'database_unbound',
      dispatched: 0
    });
    expect(send).not.toHaveBeenCalled();
  });
});
