export const D1_BATCH_MAX_STATEMENTS = 100;

export function splitD1Batch(batch, { maxStatements = D1_BATCH_MAX_STATEMENTS } = {}) {
  if (!Array.isArray(batch) || batch.length < 1) {
    throw new Error('d1_batch_chunks_invalid_batch');
  }
  if (!Number.isInteger(maxStatements) || maxStatements < 1 || maxStatements > D1_BATCH_MAX_STATEMENTS) {
    throw new Error('d1_batch_chunks_invalid_limit');
  }

  const chunks = [];
  for (let offset = 0; offset < batch.length; offset += maxStatements) {
    chunks.push(batch.slice(offset, offset + maxStatements));
  }
  return chunks;
}
