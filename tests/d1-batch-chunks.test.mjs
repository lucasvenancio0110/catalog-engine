import { describe, expect, it } from 'vitest';
import { D1_BATCH_MAX_STATEMENTS, splitD1Batch } from '../scripts/d1-batch-chunks.mjs';

describe('bounded D1 batch chunking', () => {
  it('splits 101 ordered statements into a 100 + 1 sequence', () => {
    const batch = Array.from({ length: 101 }, (_, index) => ({ sql: `SELECT ${index}`, params: [] }));
    const chunks = splitD1Batch(batch);
    expect(D1_BATCH_MAX_STATEMENTS).toBe(100);
    expect(chunks.map((chunk) => chunk.length)).toEqual([100, 1]);
    expect(chunks.flat()).toEqual(batch);
  });

  it('keeps a legal batch as one chunk', () => {
    const batch = [{ sql: 'SELECT 1', params: [] }];
    expect(splitD1Batch(batch)).toEqual([batch]);
  });

  it('rejects empty input and limits above the platform boundary', () => {
    expect(() => splitD1Batch([])).toThrow('d1_batch_chunks_invalid_batch');
    expect(() => splitD1Batch([{ sql: 'SELECT 1', params: [] }], { maxStatements: 101 })).toThrow(
      'd1_batch_chunks_invalid_limit'
    );
  });
});
