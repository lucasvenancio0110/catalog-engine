import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { attributePeekedMessages } from '../scripts/cloudflare-pb8-dlq-attribution.mjs';

const target = {
  tenantId: 't_11111111111111111111',
  importId: 'imp_22222222222222222222'
};

describe('PB8 DLQ attribution', () => {
  it('attributes target and unrelated messages without emitting identities', () => {
    const summary = attributePeekedMessages(
      [
        {
          attempts: 6,
          body: JSON.stringify({
            type: 'detail',
            tenantId: target.tenantId,
            importId: target.importId,
            sourceKey: 'primary',
            albumSourceId: 'private-a'
          })
        },
        {
          attempts: 4,
          body: JSON.stringify({
            type: 'detail',
            tenantId: 't_33333333333333333333',
            importId: 'imp_44444444444444444444'
          })
        }
      ],
      target
    );
    expect(summary).toEqual({
      peeked: 2,
      targetMerchant: 1,
      otherTenantOrImport: 1,
      invalidBody: 0,
      detailMessages: 2,
      otherMessageTypes: 0,
      attempts: { '4': 1, '6': 1 }
    });
    expect(JSON.stringify(summary)).not.toContain(target.tenantId);
    expect(JSON.stringify(summary)).not.toContain(target.importId);
  });

  it('counts malformed and unexpected messages safely', () => {
    const summary = attributePeekedMessages(
      [
        { attempts: 2, body: 'not-json' },
        { attempts: 1, body: JSON.stringify({ type: 'finalize', tenantId: target.tenantId, importId: target.importId }) }
      ],
      target
    );
    expect(summary.invalidBody).toBe(1);
    expect(summary.otherMessageTypes).toBe(1);
    expect(summary.targetMerchant).toBe(1);
  });

  it('uses only the non-destructive Queue peek endpoint', () => {
    const script = fs.readFileSync('scripts/cloudflare-pb8-dlq-attribution.mjs', 'utf8');
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
