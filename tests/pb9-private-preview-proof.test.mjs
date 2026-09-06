import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  evaluatePb9PrivatePreview,
  safePb9Evidence
} from '../scripts/cloudflare-pb9-private-preview-proof.mjs';

function readyFixture(overrides = {}) {
  return {
    target: {
      tenant_count: 1,
      is_default_tenant: 0,
      membership_status: 'active',
      role: 'owner',
      worker_status: 'active',
      runtime_kind: 'catalog',
      runtime_status: 'verified',
      runtime_version: 3,
      runtime_last_error_code: null,
      runtime_job_status: 'success',
      runtime_job_attempt_count: 1,
      runtime_job_error_code: null,
      verification_status: 'success',
      finding_count: 0
    },
    tenantCatalog: { productCount: 6097 },
    shell: {
      status: 200,
      cacheControl: 'private, no-store',
      robots: 'noindex, nofollow, noarchive'
    },
    meta: { status: 200, body: { stats: { products: 6097 } } },
    products: { status: 200, body: { items: [{ productId: 'public' }] } },
    productDetail: { status: 200 },
    media: { status: 200, contentType: 'image/webp' },
    anonymousStatus: 404,
    crossTenantStatus: 404,
    defaultSentinelStatus: 404,
    privateLeak: false,
    recurringSyncEnabled: false,
    ...overrides
  };
}

describe('PB9 trusted private preview proof', () => {
  it('passes only when tenant preview, privacy and isolation all hold', () => {
    const evaluation = evaluatePb9PrivatePreview(readyFixture());
    expect(evaluation.passed).toBe(true);
    expect(Object.values(evaluation.checks).every(Boolean)).toBe(true);
    expect(evaluation.merchantCatalogProducts).toBe(6097);
    expect(evaluation.runtimeDiagnostic).toEqual({
      runtimeStatus: 'verified',
      runtimeVersion: 3,
      runtimeLastErrorCode: 'none',
      jobStatus: 'success',
      jobAttemptCount: 1,
      jobLastErrorCode: 'none'
    });
  });

  it('fails closed for anonymous/cross-tenant/default leakage or recurring sync activation', () => {
    for (const override of [
      { anonymousStatus: 200 },
      { crossTenantStatus: 200 },
      { defaultSentinelStatus: 200 },
      { privateLeak: true },
      { recurringSyncEnabled: true }
    ]) {
      expect(evaluatePb9PrivatePreview(readyFixture(override)).passed).toBe(false);
    }
  });

  it('requires the effective tenant product count and real media response', () => {
    expect(
      evaluatePb9PrivatePreview(
        readyFixture({ meta: { status: 200, body: { stats: { products: 1 } } } })
      ).passed
    ).toBe(false);
    expect(
      evaluatePb9PrivatePreview(readyFixture({ media: { status: 502, contentType: 'text/plain' } }))
        .passed
    ).toBe(false);
  });

  it('emits safe production evidence without tenant/runtime identifiers', () => {
    const evidence = safePb9Evidence('CROCCODILOS', evaluatePb9PrivatePreview(readyFixture()));
    expect(evidence.pb9ProductionProof).toBe('passed');
    expect(evidence.privateIdentifiersExposed).toBe(false);
    expect(evidence.recurringIntelligentSyncEnabled).toBe(false);
    expect(evidence.runtimeDiagnostic.jobStatus).toBe('success');
    expect(JSON.stringify(evidence)).not.toMatch(
      /t_[a-f0-9]{20}|prn_[a-f0-9]{20}|worker_script|yupoo\.com|d1_database_id/i
    );
  });

  it('sanitizes runtime diagnostic codes before trusted evidence is emitted', () => {
    const fixture = readyFixture();
    fixture.target.runtime_status = 'error';
    fixture.target.runtime_last_error_code = 'unsafe value with spaces';
    fixture.target.runtime_job_status = 'failed';
    fixture.target.runtime_job_attempt_count = 4;
    fixture.target.runtime_job_error_code = 'tenant_runtime_smoke_failed';
    const evidence = safePb9Evidence('CROCCODILOS', evaluatePb9PrivatePreview(fixture));
    expect(evidence.pb9ProductionProof).toBe('failed');
    expect(evidence.runtimeDiagnostic).toEqual({
      runtimeStatus: 'error',
      runtimeVersion: 3,
      runtimeLastErrorCode: 'none',
      jobStatus: 'failed',
      jobAttemptCount: 4,
      jobLastErrorCode: 'tenant_runtime_smoke_failed'
    });
  });

  it('keeps production mutation bounded to disposable preview sessions and cleanup', async () => {
    const script = await readFile(
      new URL('../scripts/cloudflare-pb9-private-preview-proof.mjs', import.meta.url),
      'utf8'
    );
    expect(script).toContain('INSERT INTO tenant_private_preview_sessions');
    expect(script).toContain('DELETE FROM tenant_private_preview_sessions');
    expect(script).toContain('finally');
    expect(script).not.toMatch(
      /UPDATE\s+tenant_store_profiles|UPDATE\s+tenant_catalog_instances|INSERT\s+INTO\s+tenant_domains/i
    );
    expect(script).toContain(
      "const DEFAULT_ORIGIN = 'https://catalog-engine.lucassantanals0110.workers.dev'"
    );
    expect(script).toContain("const APP_ORIGIN = 'https://app.catalogoengine.com'");
  });
});
