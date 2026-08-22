import { describe, expect, it } from 'vitest';
import {
  assertPublicSafeImportMessage,
  buildTenantImportScanMessageForJob,
  incrementalTenantImportId,
  parseTenantImportMessage
} from '../worker/tenant-import-queue.js';

const tenantId = 't_0123456789abcdefabcd';

describe('incremental tenant scan Queue identity', () => {
  it('carries the scheduler-owned opaque import id without exposing mode or source data', async () => {
    const importId = await incrementalTenantImportId({
      tenantId,
      sourceKey: 'primary',
      scheduledFor: '2026-08-22 03:00:00'
    });
    const message = buildTenantImportScanMessageForJob({
      importId,
      tenantId,
      sourceKey: 'primary'
    });

    expect(message).toEqual({
      version: 1,
      type: 'scan',
      importId,
      tenantId,
      sourceKey: 'primary'
    });
    expect(message).not.toHaveProperty('mode');
    expect(parseTenantImportMessage(message)).toEqual(message);
    expect(assertPublicSafeImportMessage(message)).toEqual(message);
    expect(JSON.stringify(message)).not.toMatch(/https?:\/\/|yupoo|sourceUrl|databaseId|secret|token/i);
  });

  it('fails closed instead of accepting an arbitrary non-opaque import identity', () => {
    expect(() =>
      buildTenantImportScanMessageForJob({
        importId: 'incremental-2026-08-22',
        tenantId,
        sourceKey: 'primary'
      })
    ).toThrow();
  });
});
