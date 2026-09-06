import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  cleanupCandidates,
  selectTerminalSuccessRefs
} from '../scripts/cloudflare-pb8-terminal-dlq-cleanup.mjs';

const tenantId = 't_11111111111111111111';
const importId = 'imp_22222222222222222222';

function message(ref, overrides = {}) {
  return {
    ref,
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

describe('PB8 terminal-success detail DLQ cleanup', () => {
  it('accepts well-formed detail and finalize refs with valid authority identity', () => {
    const result = cleanupCandidates([
      message('ref-detail'),
      message('ref-finalize', { type: 'finalize', albumSourceId: undefined }),
      message('', {}),
      message('ref-scan', { type: 'scan' }),
      message('ref-bad-tenant', { tenantId: 'bad' }),
      { ref: 'ref-bad-json', body: 'not-json' }
    ]);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((candidate) => candidate.type)).toEqual(['detail', 'finalize']);
    expect(result.messageTypes).toEqual({ detail: 1, finalize: 1 });
    expect(result.malformed).toBe(4);
  });

  it('selects only success/complete import refs and obeys the bounded limit', () => {
    const candidates = [
      { ref: 'r1' }, { ref: 'r2' }, { ref: 'r3' }, { ref: 'r4' }
    ];
    const selected = selectTerminalSuccessRefs(candidates, [
      { status: 'success', phase: 'complete' },
      { status: 'details', phase: 'details' },
      null,
      { status: 'success', phase: 'complete' }
    ], 1);
    expect(selected.refs).toEqual(['r1']);
    expect(selected.counts).toEqual({
      terminalSuccess: 2,
      activeOrOther: 1,
      missingAuthority: 1
    });
  });

  it('uses only ref-scoped peeked-message purge and forbids global purge/replay paths', () => {
    const source = fs.readFileSync('scripts/cloudflare-pb8-terminal-dlq-cleanup.mjs', 'utf8');
    expect(source).toContain("new Set(['detail', 'finalize'])");
    expect(source).toContain('/messages/peek');
    expect(source).toContain('/messages/purge');
    expect(source).toContain('refs: selected.refs.map');
    expect(source).not.toContain('/messages/pull');
    expect(source).not.toContain('/messages/ack');
    expect(source).not.toMatch(/queues\/\$\{encodeURIComponent\(queueId\)\}\/purge`/);
    expect(source).not.toMatch(/\bINSERT\b/i);
    expect(source).not.toMatch(/\bUPDATE\b/i);
    expect(source).not.toMatch(/\bDELETE\b/i);
    expect(source).not.toContain('.send(');
    expect(source).not.toContain('.sendBatch(');
  });
});
