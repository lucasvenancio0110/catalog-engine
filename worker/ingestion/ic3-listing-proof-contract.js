export const IC3_LISTING_PROOF_CONTRACT_VERSION = 1;

// Exact pre-IC3 main used as the production scanner baseline. This is intentionally
// pinned so the proof compares the merged fan-out implementation against the
// immediately preceding scanner instead of an invented synthetic baseline.
export const IC3_LISTING_PROOF_BASELINE_SHA = 'c8450ac306af455977f899047e6fafec9600eebf';

// Both sides of the A/B proof use the same supplier-pressure ceiling. The old
// scanner uses this as category concurrency; the IC3 scanner uses one shared
// request queue with the same ceiling across category/page work.
export const IC3_LISTING_PROOF_REQUEST_CONCURRENCY = 4;

// Small positive margin keeps ordinary request jitter from being called an
// engineering improvement. A lower result remains valid diagnostic evidence but
// does not satisfy the IC3 production proof.
export const IC3_LISTING_PROOF_MIN_IMPROVEMENT_PCT = 5;
