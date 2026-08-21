import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SYNC_SAFETY_POLICY,
  SYNC_DECISION_CONTRACT_VERSION,
  SYNC_SAFETY_POLICY_VERSION,
  decideSyncRunSafety,
  defineSyncSafetyPolicy
} from '../src/sync/sync-decision.js';
import {
  listingFingerprint,
  planIncrementalDelta
} from '../scripts/incremental-sync-core.mjs';

const scope = Object.freeze({
  id: 's_aaaaaaaaaaaaaaaaaaaa',
  kind: 'catalog'
});

function decision({ previous = 1_000, observed = 900, complete = true, failures = 0 } = {}, policy) {
  return decideSyncRunSafety(
    {
      scope,
      previous: { knownGoodCount: previous },
      scan: {
        complete,
        observedCount: observed,
        disqualifyingFailureCount: failures
      }
    },
    policy
  );
}

function entry(sourceId) {
  const value = {
    sourceId,
    title: `Product ${sourceId}`,
    categoryId: '10',
    categoryPathIds: ['1', '10'],
    coverUrl: `https://img.example/${sourceId}.jpg`,
    listingSignal: `Product ${sourceId}`,
    imageCountHint: 4
  };
  return { ...value, listingFingerprint: listingFingerprint(value) };
}

function previous(current, overrides = {}) {
  return {
    album_source_id: current.sourceId,
    public_product_id: `p_${current.sourceId.padStart(20, '0').slice(-20)}`,
    source_title: current.title,
    source_category_id: current.categoryId,
    source_category_path_json: JSON.stringify(current.categoryPathIds),
    cover_source_url: current.coverUrl,
    image_count_hint: current.imageCountHint,
    listing_fingerprint: current.listingFingerprint,
    detail_fingerprint: 'detail-known',
    status: 'active',
    miss_count: 0,
    ...overrides
  };
}

const compactPolicy = Object.freeze({
  version: SYNC_SAFETY_POLICY_VERSION,
  minimumBaselineItems: 2,
  minimumAbsoluteDrop: 2,
  minimumRemainingRatio: 0.5
});

describe('M7 sync decision contract v1', () => {
  it('allows a healthy complete scan with a plausible volume change', () => {
    const result = decision({ previous: 1_000, observed: 900 });

    expect(result.contractVersion).toBe(SYNC_DECISION_CONTRACT_VERSION);
    expect(result.policyVersion).toBe(SYNC_SAFETY_POLICY_VERSION);
    expect(result.outcome).toBe('proceed');
    expect(result.authoritative).toBe(true);
    expect(result.allowMissingInference).toBe(true);
    expect(result.allowRemovalProgression).toBe(true);
    expect(result.cursorPromotion).toBe('after_verification');
    expect(result.preserveLastKnownGood).toBe(false);
    expect(result.quarantine).toBe(false);
    expect(result.metrics.remainingRatio).toBe(0.9);
  });

  it('preserves last-known-good and forbids absence inference for a partial scan', () => {
    const result = decision({ previous: 17_018, observed: 300, complete: false });

    expect(result.outcome).toBe('preserve_last_known_good');
    expect(result.authoritative).toBe(false);
    expect(result.allowMissingInference).toBe(false);
    expect(result.allowRemovalProgression).toBe(false);
    expect(result.cursorPromotion).toBe('blocked');
    expect(result.preserveLastKnownGood).toBe(true);
    expect(result.quarantine).toBe(false);
    expect(result.reasons).toEqual(['sync_scan_incomplete']);
  });

  it('quarantines an implausible complete scan collapse instead of trusting complete=true', () => {
    const result = decision({ previous: 17_018, observed: 300, complete: true });

    expect(result.outcome).toBe('quarantine');
    expect(result.quarantine).toBe(true);
    expect(result.allowMissingInference).toBe(false);
    expect(result.allowRemovalProgression).toBe(false);
    expect(result.preserveLastKnownGood).toBe(true);
    expect(result.cursorPromotion).toBe('blocked');
    expect(result.reasons).toEqual(['sync_catastrophic_volume_drop']);
    expect(result.metrics.dropCount).toBe(16_718);
    expect(result.metrics.remainingRatio).toBeCloseTo(300 / 17_018, 8);
  });

  it('fails closed when a complete scan has disqualifying failures or no observed items', () => {
    const failed = decision({ previous: 1_000, observed: 950, failures: 1 });
    expect(failed.outcome).toBe('preserve_last_known_good');
    expect(failed.reasons).toEqual(['sync_scan_has_disqualifying_failures']);
    expect(failed.allowMissingInference).toBe(false);

    const empty = decision({ previous: 1_000, observed: 0 });
    expect(empty.outcome).toBe('quarantine');
    expect(empty.reasons).toEqual(['sync_scan_empty']);
    expect(empty.allowRemovalProgression).toBe(false);
  });

  it('does not falsely quarantine a first healthy non-empty complete scan without a baseline', () => {
    const result = decision({ previous: 0, observed: 25 });

    expect(result.outcome).toBe('proceed');
    expect(result.metrics.dropCount).toBe(0);
    expect(result.metrics.remainingRatio).toBeNull();
    expect(result.cursorPromotion).toBe('after_verification');
  });

  it('keeps the catastrophic thresholds versioned, validated and injectable', () => {
    expect(DEFAULT_SYNC_SAFETY_POLICY).toEqual({
      version: 1,
      minimumBaselineItems: 100,
      minimumAbsoluteDrop: 100,
      minimumRemainingRatio: 0.5
    });
    expect(Object.isFrozen(DEFAULT_SYNC_SAFETY_POLICY)).toBe(true);
    expect(defineSyncSafetyPolicy(compactPolicy)).toEqual(compactPolicy);
    expect(() =>
      defineSyncSafetyPolicy({
        version: 1,
        minimumBaselineItems: 0,
        minimumAbsoluteDrop: 1,
        minimumRemainingRatio: 0.5
      })
    ).toThrow();
  });

  it('prevents the existing delta planner from advancing missing/removal after a catastrophic scan', () => {
    const current1 = entry('1');
    const current2 = entry('2');
    const current3 = entry('3');
    const current4 = entry('4');
    const previousRows = [current1, current2, current3, current4].map((item) => previous(item));
    const safety = decision({ previous: 4, observed: 1 }, compactPolicy);

    expect(safety.outcome).toBe('quarantine');
    const plan = planIncrementalDelta(previousRows, [current1], {
      removalMissThreshold: 3,
      inferMissing: safety.allowMissingInference
    });

    expect(plan.events).toEqual([]);
    expect(plan.summary.MISSING).toBeUndefined();
    expect(plan.summary.REMOVED).toBeUndefined();
  });

  it('allows the existing repeated-miss planner only after a safe authoritative decision', () => {
    const current1 = entry('1');
    const current2 = entry('2');
    const current3 = entry('3');
    const current4 = entry('4');
    const previousRows = [current1, current2, current3, current4].map((item) => previous(item));
    const safety = decision({ previous: 4, observed: 3 }, compactPolicy);

    expect(safety.outcome).toBe('proceed');
    const plan = planIncrementalDelta(previousRows, [current1, current2, current3], {
      removalMissThreshold: 3,
      inferMissing: safety.allowMissingInference
    });

    expect(plan.summary.MISSING).toBe(1);
    expect(plan.summary.REMOVED).toBeUndefined();
    expect(plan.events[0]).toMatchObject({
      type: 'MISSING',
      sourceId: '4',
      missCount: 1
    });
  });

  it('keeps the sync safety Core free of launch-provider and retail-domain vocabulary', () => {
    const source = fs.readFileSync('src/sync/sync-decision.js', 'utf8');
    expect(source).not.toMatch(/yupoo|sports|football|jersey|shopify/i);

    const result = decision();
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.scope)).toBe(true);
    expect(Object.isFrozen(result.metrics)).toBe(true);
    expect(Object.isFrozen(result.reasons)).toBe(true);
  });
});
