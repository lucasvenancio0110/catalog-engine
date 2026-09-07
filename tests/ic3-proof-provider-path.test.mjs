import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('IC3 production proof execution path', () => {
  it('measures the same Yupoo Provider Engine entry point used by ingestion', () => {
    const source = fs.readFileSync('scripts/cloudflare-ic3-listing-proof.mjs', 'utf8');
    expect(source).toContain("from '../worker/ingestion/providers/yupoo.js'");
    expect(source).toContain('yupooIngestionProvider.scanListingIndex');
    expect(source).not.toContain('scanYupooListingIndex as scanCurrentListing');
    expect(source).toContain('IC3_LISTING_PROOF_REQUEST_CONCURRENCY');
    expect(source).toContain('IC3_LISTING_PROOF_MIN_IMPROVEMENT_PCT');
  });
});
