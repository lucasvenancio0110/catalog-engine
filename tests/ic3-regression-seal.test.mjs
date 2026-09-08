import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  classifyIc3RegressionSeal,
  IC3_SEALED_PRODUCTION_EVIDENCE,
  IC3_SEALED_PRODUCTION_SHA,
  IC3_SEALED_RUNTIME_PATHS
} from '../scripts/cloudflare-ic3-regression-seal.mjs';

describe('IC3 sealed production regression gate', () => {
  it('pins the already-proven production implementation and permanent 5% evidence gate', () => {
    expect(IC3_SEALED_PRODUCTION_SHA).toBe('9cc5b3ef9757dc76266d1423e7056af8d332d8af');
    expect(IC3_SEALED_PRODUCTION_EVIDENCE).toMatchObject({
      improvementPct: 9.2,
      minimumImprovementPct: 5,
      productCount: 6111,
      identityMatch: true,
      taxonomyMatch: true,
      requestConcurrency: 4
    });
    expect(IC3_SEALED_PRODUCTION_EVIDENCE.improvementPct).toBeGreaterThanOrEqual(
      IC3_SEALED_PRODUCTION_EVIDENCE.minimumImprovementPct
    );
  });

  it('covers the production files that materially define IC3 listing behavior', () => {
    expect(IC3_SEALED_RUNTIME_PATHS).toEqual(
      expect.arrayContaining([
        'worker/import-scan-entry.js',
        'worker/ingestion/scan-consumer.js',
        'worker/ingestion/yupoo-listing.js',
        'worker/ingestion/providers/yupoo.js',
        'worker/ingestion/yupoo-preview-seed.js',
        'src/catalog-provider/provider-contract.js',
        'wrangler.import-scan.jsonc',
        'package-lock.json'
      ])
    );
  });

  it('reuses sealed evidence only when no governed runtime path drifted', () => {
    expect(classifyIc3RegressionSeal([])).toEqual({
      implementationSealed: true,
      changedPathCount: 0
    });
    expect(
      classifyIc3RegressionSeal([
        'worker/ingestion/yupoo-listing.js',
        'worker/ingestion/yupoo-listing.js'
      ])
    ).toEqual({ implementationSealed: false, changedPathCount: 1 });
  });

  it('keeps fresh measured A/B proof as the fail-closed fallback for any runtime drift', () => {
    const workflow = fs.readFileSync(
      '.github/workflows/cloudflare-ic3-listing-production-proof.yml',
      'utf8'
    );
    expect(workflow).toContain('scripts/cloudflare-ic3-regression-seal.mjs');
    expect(workflow).toContain('sealed-regression');
    expect(workflow).toContain('measured-regression');
    expect(workflow).toContain('.improvementPct >= .minimumImprovementPct');
    expect(workflow).toContain('node scripts/cloudflare-ic3-listing-proof.mjs');
  });
});
