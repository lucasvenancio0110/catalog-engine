import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { summarizeEnvelopeClasses } from '../scripts/cloudflare-pb8-dlq-envelope-classifier.mjs';

describe('PB8 DLQ envelope classifier', () => {
  it('classifies only known structural shapes without retaining private values', () => {
    const summary = summarizeEnvelopeClasses([
      { body: JSON.stringify({ type: 'detail', tenantId: 'private-a', importId: 'private-b', sourceKey: 'private-c' }) },
      { body: JSON.stringify({ body: { type: 'detail', tenantId: 'private-d' } }) },
      { body: JSON.stringify({ message: { type: 'finalize' } }) },
      { body: JSON.stringify({ payload: { type: 'scan' } }) },
      { body: JSON.stringify({ type: 'unexpected-private-value' }) },
      { body: JSON.stringify({ other: true }) },
      { body: 'bad-json' }
    ]);
    expect(summary).toEqual({
      peeked: 7,
      invalidJson: 1,
      classes: {
        'top-detail': 1,
        'nested-body-detail': 1,
        'nested-message-finalize': 1,
        'nested-payload-scan': 1,
        'top-unknown-type': 1,
        'top-missing-type': 1
      },
      hasTopLevelIdentityFields: 1
    });
    expect(JSON.stringify(summary)).not.toContain('private-');
    expect(JSON.stringify(summary)).not.toContain('unexpected-private-value');
  });

  it('uses peek only and contains no destructive Queue endpoint', () => {
    const source = fs.readFileSync('scripts/cloudflare-pb8-dlq-envelope-classifier.mjs', 'utf8');
    expect(source).toContain('/messages/peek');
    expect(source).not.toContain('/messages/pull');
    expect(source).not.toContain('/messages/ack');
    expect(source).not.toContain('/messages/purge');
  });
});
