// IC4A is measurement-only. These values snapshot the production detail Queue
// boundary that must remain unchanged while the baseline is collected.
//
// Keeping this contract under worker/** intentionally makes the trusted application
// deploy run for the exact IC4A merge SHA without changing runtime behavior.
export const IC4A_DETAIL_BASELINE_CONTRACT_VERSION = 1;
export const IC4A_DETAIL_QUEUE_BASELINE = Object.freeze({
  maxBatchSize: 4,
  maxBatchTimeoutSeconds: 5,
  maxConcurrency: 2,
  maxRetries: 5
});
export const IC4A_MAX_REAL_SAMPLE_SIZE = 8;

export function assertIc4aConservativeDetailBaseline(config) {
  const input = config || {};
  if (
    Number(input.maxBatchSize) !== IC4A_DETAIL_QUEUE_BASELINE.maxBatchSize ||
    Number(input.maxBatchTimeoutSeconds) !== IC4A_DETAIL_QUEUE_BASELINE.maxBatchTimeoutSeconds ||
    Number(input.maxConcurrency) !== IC4A_DETAIL_QUEUE_BASELINE.maxConcurrency ||
    Number(input.maxRetries) !== IC4A_DETAIL_QUEUE_BASELINE.maxRetries
  ) {
    throw new Error('ic4a_detail_baseline_boundary_changed');
  }
  return true;
}
