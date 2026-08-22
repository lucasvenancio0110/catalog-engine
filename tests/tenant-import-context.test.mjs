import { describe, expect, it, vi } from 'vitest';
import {
  TenantImportContextError,
  loadTenantImportContext
} from '../worker/ingestion/context.js';

const message = {
  importId: 'imp_0123456789abcdefabcd',
  tenantId: 't_0123456789abcdefabcd',
  sourceKey: 'primary'
};

function row(overrides = {}) {
  return {
    import_id: message.importId,
    mode: 'initial',
    import_status: 'queued',
    phase: 'scan',
    detail_enqueue_cursor: 0,
    discovered_count: 0,
    provider: 'yupoo',
    source_url: 'https://supplier.x.yupoo.com/albums/',
    sync_strategy: 'incremental',
    removal_miss_threshold: 3,
    d1_database_id: '12ac414c-4aef-4668-a8f9-dc63d57d449f',
    database_status: 'active',
    worker_status: 'active',
    dispatch_namespace: 'catalog-engine-production',
    provisioning_id: 'p_example',
    provisioning_step: 'import',
    schema_version: 4,
    ...overrides
  };
}

function dbFor(result) {
  const first = vi.fn(async () => result);
  const bind = vi.fn(() => ({ first }));
  const prepare = vi.fn(() => ({ bind }));
  return { db: { prepare }, prepare, bind, first };
}

describe('tenant import context mode boundary', () => {
  it('keeps existing callers initial-only by default', async () => {
    const { db } = dbFor(row({ mode: 'incremental', provisioning_step: 'domain' }));
    await expect(loadTenantImportContext(db, message)).rejects.toMatchObject({
      code: 'tenant_import_mode_not_supported'
    });
  });

  it('allows incremental mode only when the caller opts in and ignores onboarding checkpoint state', async () => {
    const { db } = dbFor(row({ mode: 'incremental', provisioning_step: 'domain' }));
    const context = await loadTenantImportContext(db, message, {
      allowedModes: ['initial', 'incremental']
    });

    expect(context.mode).toBe('incremental');
    expect(context.provisioningId).toBeNull();
    expect(context.privateSource).toMatchObject({
      provider: 'yupoo',
      syncStrategy: 'incremental',
      removalMissThreshold: 3
    });
  });

  it('preserves the initial-import provisioning checkpoint invariant', async () => {
    const { db } = dbFor(row({ mode: 'initial', provisioning_step: 'classify' }));
    await expect(
      loadTenantImportContext(db, message, { allowedModes: ['initial', 'incremental'] })
    ).rejects.toEqual(
      expect.objectContaining({
        name: 'TenantImportContextError',
        code: 'tenant_import_checkpoint_mismatch'
      })
    );
  });

  it('returns initial provisioning identity only for the initial import path', async () => {
    const { db } = dbFor(row());
    const context = await loadTenantImportContext(db, message);
    expect(context.mode).toBe('initial');
    expect(context.provisioningId).toBe('p_example');
  });

  it('retains stable not-found behavior', async () => {
    const { db } = dbFor(null);
    await expect(loadTenantImportContext(db, message)).rejects.toEqual(
      expect.objectContaining({
        name: 'TenantImportContextError',
        code: 'tenant_import_not_found',
        status: 404
      })
    );
  });

  it('uses the same typed context error class for unsupported modes', async () => {
    const { db } = dbFor(row({ mode: 'recovery' }));
    try {
      await loadTenantImportContext(db, message);
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(TenantImportContextError);
      expect(error.code).toBe('tenant_import_mode_not_supported');
    }
  });
});
