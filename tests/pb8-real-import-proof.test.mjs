import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  evaluatePb8RealImport,
  safePb8Evidence
} from '../scripts/cloudflare-pb8-real-import-proof.mjs';

function baseState() {
  return {
    control: {
      target: {
        tenant_count: 1,
        is_default_tenant: 0,
        database_status: 'active',
        worker_status: 'active',
        schema_version: 8
      },
      importJob: {
        status: 'success',
        phase: 'complete',
        discovered_count: 4,
        queued_detail_count: 4,
        completed_detail_count: 4,
        failed_detail_count: 0,
        deferred_detail_count: 0,
        published_product_count: 4
      },
      classificationJob: {
        status: 'success',
        product_count: 4,
        automatic_count: 4,
        review_count: 0,
        unknown_count: 0
      },
      verificationJob: {
        status: 'success',
        product_count: 4,
        finding_count: 0
      },
      defaultCatalogProductCount: 1500
    },
    tenant: {
      detailRows: [{ state: 'success', last_error_code: null, total: 4 }],
      productCount: 4,
      productMediaCount: 8
    },
    queues: {
      'catalog-engine-import-scan': 0,
      'catalog-engine-import-detail': 0,
      'catalog-engine-import-scan-dlq': 0,
      'catalog-engine-import-detail-dlq': 0
    },
    runtime: {
      initialImportEnabled: true,
      recurringSyncEnabled: false
    }
  };
}

describe('PB8 real import production proof', () => {
  it('passes only after isolated import, classification and clean verification complete', () => {
    const evaluation = evaluatePb8RealImport(baseState());
    expect(evaluation.passed).toBe(true);
    expect(evaluation.diagnosis).toBe('ready');
    expect(evaluation.tenantCatalog.products).toBe(4);
    expect(evaluation.queues.detailDlq).toBe(0);
  });

  it('diagnoses a real detail DLQ without pretending the import is green', () => {
    const state = baseState();
    state.control.importJob.status = 'details';
    state.control.importJob.phase = 'details';
    state.tenant.detailRows = [
      { state: 'success', last_error_code: null, total: 2 },
      { state: 'failed', last_error_code: 'supplier_source_unavailable', total: 1 }
    ];
    state.queues['catalog-engine-import-detail'] = 1;
    state.queues['catalog-engine-import-detail-dlq'] = 1;
    const evaluation = evaluatePb8RealImport(state);
    expect(evaluation.passed).toBe(false);
    expect(evaluation.diagnosis).toBe('import_dlq_present');
    expect(evaluation.details.errors).toEqual([
      { code: 'supplier_source_unavailable', count: 1 }
    ]);
  });

  it('distinguishes a draining detail queue from a delivery gap', () => {
    const draining = baseState();
    draining.control.importJob.status = 'details';
    draining.control.importJob.phase = 'details';
    draining.control.importJob.discovered_count = 100;
    draining.tenant.detailRows = [{ state: 'success', total: 25 }];
    draining.queues['catalog-engine-import-detail'] = 75;
    expect(evaluatePb8RealImport(draining).diagnosis).toBe('detail_queue_draining');

    const gap = structuredClone(draining);
    gap.queues['catalog-engine-import-detail'] = 0;
    expect(evaluatePb8RealImport(gap).diagnosis).toBe('detail_delivery_gap');
  });

  it('refuses green when recurring Intelligent Sync is enabled or a DLQ is nonzero', () => {
    const syncOn = baseState();
    syncOn.runtime.recurringSyncEnabled = true;
    expect(evaluatePb8RealImport(syncOn).passed).toBe(false);

    const dlq = baseState();
    dlq.queues['catalog-engine-import-detail-dlq'] = 2;
    const evaluation = evaluatePb8RealImport(dlq);
    expect(evaluation.passed).toBe(false);
    expect(evaluation.diagnosis).toBe('queue_hygiene_not_clean');
  });

  it('emits merchant-safe aggregate evidence only', () => {
    const evidence = safePb8Evidence('CROCCODILOS', evaluatePb8RealImport(baseState()));
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toMatch(/t_[a-f0-9]{20}/i);
    expect(serialized).not.toMatch(/imp_[a-f0-9]{20}/i);
    expect(serialized).not.toMatch(/https?:\/\//i);
    expect(serialized).not.toMatch(/yupoo\.com/i);
    expect(serialized).not.toContain('databaseId');
    expect(serialized).not.toContain('workerScript');
    expect(evidence.privateIdentifiersExposed).toBe(false);
  });

  it('keeps the proof script read-only and free of Queue injection', () => {
    const script = fs.readFileSync('scripts/cloudflare-pb8-real-import-proof.mjs', 'utf8');
    expect(script).not.toMatch(/\bINSERT\b/i);
    expect(script).not.toMatch(/\bUPDATE\b/i);
    expect(script).not.toMatch(/\bDELETE\b/i);
    expect(script).not.toContain('.send(');
    expect(script).not.toContain('.sendBatch(');
    expect(script).not.toContain('/messages/ack');
    expect(script).toContain('/metrics');
  });
});
