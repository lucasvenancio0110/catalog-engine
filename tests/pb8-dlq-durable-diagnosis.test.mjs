import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { collectTargetRefs, summarizeDurableRows } from '../scripts/cloudflare-pb8-dlq-durable-diagnosis.mjs';

const target = { tenantId: 't_11111111111111111111', importId: 'imp_22222222222222222222' };

describe('PB8 durable DLQ diagnosis', () => {
  it('collects only target detail refs and deduplicates them', () => {
    const input = [
      { body: JSON.stringify({ type: 'detail', tenantId: target.tenantId, importId: target.importId, albumSourceId: 'private-a' }) },
      { body: JSON.stringify({ type: 'detail', tenantId: target.tenantId, importId: target.importId, albumSourceId: 'private-a' }) },
      { body: JSON.stringify({ type: 'detail', tenantId: 't_33333333333333333333', importId: target.importId, albumSourceId: 'private-b' }) },
      { body: JSON.stringify({ type: 'finalize', tenantId: target.tenantId, importId: target.importId, albumSourceId: 'private-c' }) }
    ];
    expect(collectTargetRefs(input, target)).toEqual({ refs: ['private-a'], malformedTargetRef: 0 });
  });

  it('summarizes durable state without private refs', () => {
    const result = summarizeDurableRows([
      { state: 'failed', last_error_code: 'provider_timeout', total: 2 },
      { state: 'success', last_error_code: null, total: 1 }
    ], 4);
    expect(result).toEqual({
      expectedRefs: 4,
      matched: 3,
      missingDurableState: 1,
      states: { failed: 2, success: 1 },
      errors: { provider_timeout: 2 }
    });
    expect(JSON.stringify(result)).not.toContain('private-');
  });

  it('remains read-only and non-destructive', () => {
    const script = fs.readFileSync('scripts/cloudflare-pb8-dlq-durable-diagnosis.mjs', 'utf8');
    expect(script).toContain('/messages/peek');
    expect(script).not.toContain('/messages/pull');
    expect(script).not.toContain('/messages/ack');
    expect(script).not.toContain('/messages/purge');
    expect(script).not.toMatch(/\bINSERT\b/i);
    expect(script).not.toMatch(/\bUPDATE\b/i);
    expect(script).not.toMatch(/\bDELETE\b/i);
    expect(script).not.toContain('.send(');
    expect(script).not.toContain('.sendBatch(');
  });
});
