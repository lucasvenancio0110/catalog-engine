import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { summarizeStuckDetailRows } from '../scripts/cloudflare-pb8-stuck-detail-lease-diagnosis.mjs';

describe('PB8 stuck detail lease diagnosis', () => {
  it('summarizes expired processing leases and attempt pressure without identities', () => {
    const summary = summarizeStuckDetailRows([
      { state: 'processing', attempt_count: 3, lease_expired: 1, last_error_code: null, total: 1 },
      { state: 'failed', attempt_count: 4, lease_expired: 0, last_error_code: 'supplier_timeout', total: 2 }
    ]);
    expect(summary).toEqual({
      nonTerminal: 3,
      processing: 1,
      pending: 0,
      failed: 2,
      expiredProcessingLease: 1,
      attemptsAtOrAboveDetailLimit: 2,
      attempts: { '3': 1, '4': 2 },
      errors: { supplier_timeout: 2 }
    });
    expect(JSON.stringify(summary)).not.toMatch(/t_[a-f0-9]{20}|imp_[a-f0-9]{20}/i);
  });

  it('handles an empty terminal import safely', () => {
    expect(summarizeStuckDetailRows([])).toEqual({
      nonTerminal: 0,
      processing: 0,
      pending: 0,
      failed: 0,
      expiredProcessingLease: 0,
      attemptsAtOrAboveDetailLimit: 0,
      attempts: {},
      errors: {}
    });
  });

  it('remains read-only and does not expose private fields', () => {
    const script = fs.readFileSync('scripts/cloudflare-pb8-stuck-detail-lease-diagnosis.mjs', 'utf8');
    expect(script).not.toMatch(/\bINSERT\b/i);
    expect(script).not.toMatch(/\bUPDATE\b/i);
    expect(script).not.toMatch(/\bDELETE\b/i);
    expect(script).not.toContain('.send(');
    expect(script).not.toContain('.sendBatch(');
    expect(script).not.toContain('/messages/ack');
    expect(script).toContain('lease_until<=CURRENT_TIMESTAMP');
  });
});
