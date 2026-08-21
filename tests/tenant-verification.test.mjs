import { describe, expect, it, vi } from 'vitest';
import {
  runDueTenantVerifications,
  verificationFindings
} from '../worker/tenant-verification-runner.js';

function result(total) {
  return { success: true, results: [{ total }] };
}

function healthyResults(products = 12) {
  return [
    result(products),
    result(products),
    result(0),
    result(0),
    result(0),
    result(0),
    result(0),
    result(0),
    result(0),
    result(0),
    result(0),
    result(0),
    result(0),
    result(0),
    result(0),
    result(products),
    result(0),
    result(0),
    result(3),
    result(2),
    result(1)
  ];
}

function emptySchedulerDb() {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        all: vi.fn(async () => ({ results: [] })),
        run: vi.fn(async () => ({ meta: { changes: 0 } }))
      })),
      run: vi.fn(async () => ({ meta: { changes: 0 } }))
    }))
  };
}

describe('tenant verification gate', () => {
  it('accepts a fully classified catalog with complete CEI state while surfacing non-blocking exception metrics', () => {
    const report = verificationFindings(healthyResults(), { deferredDetailCount: 2 });
    expect(report).toEqual({
      products: 12,
      classified: 12,
      intelligence: 12,
      deferredDetailCount: 2,
      reviewRequired: 3,
      researchRequired: 2,
      conflicts: 1,
      findings: []
    });
  });

  it('surfaces only stable safe finding codes for blocking catalog or CEI integrity defects', () => {
    const rows = healthyResults(5);
    rows[1] = result(4);
    rows[2] = result(1);
    rows[4] = result(2);
    rows[6] = result(1);
    rows[7] = result(3);
    rows[12] = result(1);
    rows[15] = result(4);
    rows[16] = result(1);
    rows[17] = result(1);
    const report = verificationFindings(rows);
    expect(report.findings).toEqual(
      expect.arrayContaining([
        'classification_version_incomplete',
        'public_source_leak',
        'primary_media_missing',
        'product_media_count_mismatch',
        'team_count_mismatch',
        'intelligence_state_incomplete',
        'intelligence_override_state_mismatch'
      ])
    );
    expect(JSON.stringify(report.findings)).not.toMatch(/https?:\/\/|yupoo|token|secret/i);
  });

  it('does not turn CEI review/research queues into whole-tenant verification failures', () => {
    const rows = healthyResults(7);
    rows[18] = result(6);
    rows[19] = result(5);
    rows[20] = result(4);
    const report = verificationFindings(rows);

    expect(report.findings).toEqual([]);
    expect(report.reviewRequired).toBe(6);
    expect(report.researchRequired).toBe(5);
    expect(report.conflicts).toBe(4);
  });

  it('runs scheduler discovery with tenant dispatch and no administrative Cloudflare token', async () => {
    const db = emptySchedulerDb();
    const tenantDispatch = { get: vi.fn() };
    const fetchImpl = vi.fn();
    const summary = await runDueTenantVerifications(
      { CATALOG_DB: db, TENANT_DISPATCH: tenantDispatch },
      { fetchImpl }
    );

    expect(summary).toMatchObject({
      enabled: true,
      discovered: 0,
      selected: 0,
      processed: 0,
      failed: 0
    });
    expect(db.prepare).toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed before reading control-plane jobs when provider runtime is absent', async () => {
    const db = { prepare: vi.fn() };
    const summary = await runDueTenantVerifications({ CATALOG_DB: db });
    expect(summary).toEqual({
      enabled: false,
      reason: 'cloudflare_platform_unconfigured',
      processed: 0
    });
    expect(db.prepare).not.toHaveBeenCalled();
  });
});
