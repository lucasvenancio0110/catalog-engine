export const IC4B_DETAIL_FANOUT_CONTRACT_VERSION = 1;

export const IC4B_DETAIL_QUEUE_TARGET = Object.freeze({
  maxBatchSize: 1,
  maxBatchTimeoutSeconds: 5,
  maxConcurrency: 4,
  maxRetries: 5,
  retryDelaySeconds: 120
});

export const IC4B_DETAIL_QUEUE_ROLLBACK = Object.freeze({
  maxBatchSize: 4,
  maxBatchTimeoutSeconds: 5,
  maxConcurrency: 2,
  maxRetries: 5,
  retryDelaySeconds: 120
});

export const IC4B_MIN_OBSERVED_WORKER_CONCURRENCY = 3;
export const IC4B_PROBE_MESSAGE_COUNT = 24;

function integer(value) {
  return Number.isInteger(Number(value)) ? Number(value) : null;
}

export function assertIc4bDetailQueueTarget(value) {
  const actual = {
    maxBatchSize: integer(value?.maxBatchSize),
    maxBatchTimeoutSeconds: integer(value?.maxBatchTimeoutSeconds),
    maxConcurrency: integer(value?.maxConcurrency),
    maxRetries: integer(value?.maxRetries),
    retryDelaySeconds: integer(value?.retryDelaySeconds)
  };
  for (const [key, expected] of Object.entries(IC4B_DETAIL_QUEUE_TARGET)) {
    if (actual[key] !== expected) throw new Error(`ic4b_detail_queue_target_mismatch_${key}`);
  }
  return true;
}

export function evaluateIc4bFanoutProbe({
  completed,
  expectedMessages = IC4B_PROBE_MESSAGE_COUNT,
  maxObservedActive,
  configuredMaxConcurrency = IC4B_DETAIL_QUEUE_TARGET.maxConcurrency,
  workerCleaned,
  queueCleaned,
  databaseCleaned
} = {}) {
  const observed = integer(maxObservedActive) ?? 0;
  const ceiling = integer(configuredMaxConcurrency) ?? 0;
  const expected = integer(expectedMessages) ?? 0;
  const done = integer(completed) ?? -1;
  const cleanupPassed = workerCleaned === true && queueCleaned === true && databaseCleaned === true;
  return {
    passed:
      expected > 0 &&
      done === expected &&
      observed >= IC4B_MIN_OBSERVED_WORKER_CONCURRENCY &&
      observed <= ceiling &&
      ceiling === IC4B_DETAIL_QUEUE_TARGET.maxConcurrency &&
      cleanupPassed,
    completed: done,
    expectedMessages: expected,
    maxObservedActive: observed,
    configuredMaxConcurrency: ceiling,
    cleanupPassed
  };
}
