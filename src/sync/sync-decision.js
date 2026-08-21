import { z } from 'zod';

const SCOPE_ID_PATTERN = /^s_[a-f0-9]{20}$/;
const SCOPE_KINDS = ['catalog', 'category', 'source', 'legacy'];
const OUTCOMES = ['proceed', 'preserve_last_known_good', 'quarantine'];
const CURSOR_PROMOTION = ['after_verification', 'blocked'];

export const SYNC_DECISION_CONTRACT_VERSION = 1;
export const SYNC_SAFETY_POLICY_VERSION = 1;

const policySchema = z
  .object({
    version: z.literal(SYNC_SAFETY_POLICY_VERSION),
    minimumBaselineItems: z.number().int().min(1).max(1_000_000),
    minimumAbsoluteDrop: z.number().int().min(1).max(1_000_000),
    minimumRemainingRatio: z.number().min(0.01).max(0.99)
  })
  .strict();

const inputSchema = z
  .object({
    scope: z
      .object({
        id: z.string().regex(SCOPE_ID_PATTERN),
        kind: z.enum(SCOPE_KINDS)
      })
      .strict(),
    previous: z
      .object({
        knownGoodCount: z.number().int().min(0).max(10_000_000)
      })
      .strict(),
    scan: z
      .object({
        complete: z.boolean(),
        observedCount: z.number().int().min(0).max(10_000_000),
        disqualifyingFailureCount: z.number().int().min(0).max(10_000_000)
      })
      .strict()
  })
  .strict();

const decisionSchema = z
  .object({
    contractVersion: z.literal(SYNC_DECISION_CONTRACT_VERSION),
    policyVersion: z.literal(SYNC_SAFETY_POLICY_VERSION),
    scope: z
      .object({
        id: z.string().regex(SCOPE_ID_PATTERN),
        kind: z.enum(SCOPE_KINDS)
      })
      .strict(),
    outcome: z.enum(OUTCOMES),
    authoritative: z.boolean(),
    allowMissingInference: z.boolean(),
    allowRemovalProgression: z.boolean(),
    preserveLastKnownGood: z.boolean(),
    cursorPromotion: z.enum(CURSOR_PROMOTION),
    quarantine: z.boolean(),
    reasons: z.array(z.string().regex(/^sync_[a-z0-9_]+$/)).max(8),
    metrics: z
      .object({
        previousKnownGoodCount: z.number().int().min(0),
        observedCount: z.number().int().min(0),
        dropCount: z.number().int().min(0),
        remainingRatio: z.number().min(0).max(1).nullable()
      })
      .strict()
  })
  .strict();

export const DEFAULT_SYNC_SAFETY_POLICY = Object.freeze({
  version: SYNC_SAFETY_POLICY_VERSION,
  minimumBaselineItems: 100,
  minimumAbsoluteDrop: 100,
  minimumRemainingRatio: 0.5
});

export function defineSyncSafetyPolicy(value = DEFAULT_SYNC_SAFETY_POLICY) {
  return Object.freeze(policySchema.parse(value));
}

function metricsFor(previousKnownGoodCount, observedCount) {
  const dropCount = Math.max(0, previousKnownGoodCount - observedCount);
  const remainingRatio =
    previousKnownGoodCount > 0
      ? Math.max(0, Math.min(1, observedCount / previousKnownGoodCount))
      : null;
  return Object.freeze({
    previousKnownGoodCount,
    observedCount,
    dropCount,
    remainingRatio
  });
}

function isCatastrophicDrop(metrics, policy) {
  if (metrics.previousKnownGoodCount < policy.minimumBaselineItems) return false;
  if (metrics.dropCount < policy.minimumAbsoluteDrop) return false;
  return metrics.remainingRatio !== null && metrics.remainingRatio < policy.minimumRemainingRatio;
}

function freezeDecision(value) {
  const parsed = decisionSchema.parse(value);
  return Object.freeze({
    ...parsed,
    scope: Object.freeze({ ...parsed.scope }),
    reasons: Object.freeze([...parsed.reasons]),
    metrics: Object.freeze({ ...parsed.metrics })
  });
}

function blockedDecision(input, metrics, { outcome, reason, quarantine }) {
  return freezeDecision({
    contractVersion: SYNC_DECISION_CONTRACT_VERSION,
    policyVersion: SYNC_SAFETY_POLICY_VERSION,
    scope: input.scope,
    outcome,
    authoritative: false,
    allowMissingInference: false,
    allowRemovalProgression: false,
    preserveLastKnownGood: true,
    cursorPromotion: 'blocked',
    quarantine,
    reasons: [reason],
    metrics
  });
}

export function decideSyncRunSafety(inputValue, policyValue = DEFAULT_SYNC_SAFETY_POLICY) {
  const input = inputSchema.parse(inputValue);
  const policy = defineSyncSafetyPolicy(policyValue);
  const metrics = metricsFor(input.previous.knownGoodCount, input.scan.observedCount);

  if (!input.scan.complete) {
    return blockedDecision(input, metrics, {
      outcome: 'preserve_last_known_good',
      reason: 'sync_scan_incomplete',
      quarantine: false
    });
  }

  if (input.scan.disqualifyingFailureCount > 0) {
    return blockedDecision(input, metrics, {
      outcome: 'preserve_last_known_good',
      reason: 'sync_scan_has_disqualifying_failures',
      quarantine: false
    });
  }

  if (input.scan.observedCount === 0) {
    return blockedDecision(input, metrics, {
      outcome: 'quarantine',
      reason: 'sync_scan_empty',
      quarantine: true
    });
  }

  if (isCatastrophicDrop(metrics, policy)) {
    return blockedDecision(input, metrics, {
      outcome: 'quarantine',
      reason: 'sync_catastrophic_volume_drop',
      quarantine: true
    });
  }

  return freezeDecision({
    contractVersion: SYNC_DECISION_CONTRACT_VERSION,
    policyVersion: SYNC_SAFETY_POLICY_VERSION,
    scope: input.scope,
    outcome: 'proceed',
    authoritative: true,
    allowMissingInference: true,
    allowRemovalProgression: true,
    preserveLastKnownGood: false,
    cursorPromotion: 'after_verification',
    quarantine: false,
    reasons: [],
    metrics
  });
}
