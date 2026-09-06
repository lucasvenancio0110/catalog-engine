import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  collectInventoryCandidates,
  summarizeInventory
} from '../scripts/cloudflare-pb8-dlq-global-inventory.mjs';

const tenantId = 't_11111111111111111111';
const importId = 'imp_22222222222222222222';

function detail(overrides = {}) {
  return {
    body: JSON.stringify({
      version: 1,
      type: 'detail',
      tenantId,
      importId,
      sourceKey: 'primary',
      albumSourceId: 'private-ref',
      ...overrides
    })
  };
}

describe('PB8 global detail DLQ inventory', () => {
  it('classifies safe candidate shapes without exposing private identities', () => {
    const result = collectInventoryCandidates([
      detail(),
      { body: 'not-json' },
      detail({ type: 'finalize' }),
      detail({ tenantId: 'invalid' })
    ]);
    expect(result.counters).toEqual({
      peeked: 4,
      malformedBody: 1,
      otherMessageType: 1,
      malformedIdentity: 1
    });
    expect(result.candidates).toHaveLength(1);
  });

  it('separates active, terminal and missing import authority', () => {
    const candidates = Array.from({ length: 5 }, (_, index) => ({ index }));
    const summary = summarizeInventory(candidates, [
      { status: 'details', phase: 'details', mode: 'initial' },
      { status: 'success', phase: 'complete', mode: 'initial' },
      { status: 'failed', phase: 'details', mode: 'incremental' },
      null,
      { status: 'success', phase: 'finalize', mode: 'recovery' }
    ]);
    expect(summary).toEqual({
      candidateMessages: 5,
      activeImport: 1,
      terminalSuccess: 1,
      terminalFailure: 1,
      missingImportJob: 1,
      inconsistentTerminal: 1,
      modes: { initial: 2, incremental: 1, recovery: 1, unknown: 0 }
    });
  });

  it('is strictly read-only and non-destructive', () => {
    const source = fs.readFileSync('scripts/cloudflare-pb8-dlq-global-inventory.mjs', 'utf8');
    expect(source).toContain('/messages/peek');
    expect(source).not.toContain('/messages/pull');
    expect(source).not.toContain('/messages/ack');
    expect(source).not.toContain('/messages/purge');
    expect(source).not.toMatch(/\bINSERT\b/i);
    expect(source).not.toMatch(/\bUPDATE\b/i);
    expect(source).not.toMatch(/\bDELETE\b/i);
  });
});
