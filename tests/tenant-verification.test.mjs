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
    result(0)
  ];
}

describe('tenant verification gate', () => {
  it('accepts a fully classified internally consistent catalog', () => {
    const report = verificationFindings(healthyResults(), { deferredDetailCount: 2 });
    expect(report).toEqual({
      products: 12,
      classified: 12,
      deferredDetailCount: 2,
      findings: []
    });
  });

  it('surfaces only stable safe finding codes for blocking catalog defects', () => {
    const rows = healthyResults(5);
    rows[1] = result(4);
    rows[2] = result(1);
    rows[4] = result(2);
    rows[6] = result(1);
    rows[7] = result(3);
    rows[12] = result(1);
    const report = verificationFindings(rows);
    expect(report.findings).toEqual(
      expect.arrayContaining([
        'classification_version_incomplete',
        'public_source_leak',
        'primary_media_missing',
        'product_media_count_mismatch',
        'team_count_mismatch'
      ])
    );
    expect(JSON.stringify(report.findings)).not.toMatch(/https?:\/\/|yupoo|token|secret/i);
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
